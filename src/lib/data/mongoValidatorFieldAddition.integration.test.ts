import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MongoClient, type Document } from "mongodb";
import { operationMongoIndexes, operationMongoValidator } from "./mongoOperationStore";
import { mongoFailureCode, stableMongoValue } from "./mongoOperationPrimitives";
import { applyFieldAddition, encodeFieldAdditionTarget, inspectFieldAddition, parseFieldAdditionTarget, restoreFieldAddition, storedValidatorIsFieldAddition } from "./mongoValidatorFieldAddition";

// Run against a throwaway loopback mongod only (docs/operations/mongodb-operation-validator-change.md "도구 검증").
type Row = Document & { _id: string };
const URI = process.env.FIELD_ADDITION_TEST_MONGO_URI ?? "";
const DATABASE = "hub_om_shadow_field_addition_fixture";
const ENVELOPE = "^pii:v1:[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$";
const ADDED = ["businessType", "businessNumber", "businessNumberPiiIndex"];

/** The shape #762 gives Company: a plain nullable field plus a private field with its blind index and null pairing. */
function nextCompany(): { validator: Document; indexes: ReturnType<typeof operationMongoIndexes> } {
  const deployed = structuredClone(operationMongoValidator("Company")) as { $jsonSchema: { required: string[]; properties: Record<string, unknown> } };
  const schema = deployed.$jsonSchema;
  schema.properties.businessType = { bsonType: ["string", "null"] };
  schema.properties.businessNumber = { bsonType: ["string", "null"], pattern: ENVELOPE };
  schema.properties.businessNumberPiiIndex = { bsonType: ["string", "null"], pattern: "^[a-f0-9]{64}$" };
  schema.required.push(...ADDED);
  const validator = { $and: [{ $jsonSchema: schema }, { $expr: { $eq: [{ $eq: ["$businessNumber", null] }, { $eq: ["$businessNumberPiiIndex", null] }] } }] };
  return { validator, indexes: [...operationMongoIndexes("Company"), { name: "runtime_pii_businessNumberPiiIndex", key: { businessNumberPiiIndex: 1 } }] };
}

const code = (expected: string) => (error: unknown) => mongoFailureCode(error) === expected;

test("field addition fills, indexes, switches and restores a real Company collection", {
  skip: process.env.FIELD_ADDITION_DATABASE_TESTS !== "1", timeout: 120_000
}, async () => {
  assert.match(URI, /^mongodb:\/\/127\.0\.0\.1:\d+\/?(\?.*)?$/, "Loopback mongod required");
  const client = new MongoClient(URI, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const namespace = `shadow_fa_${randomUUID().slice(0, 8)}`;
  const options = { client, databaseName: DATABASE, namespace };
  const writable = { ...options, allowShadowWrites: true as const };
  const db = client.db(DATABASE);
  const name = `${namespace}_Company`;
  const collection = db.collection<Row>(name);
  const stored = async () => (await db.listCollections({ name }, { nameOnly: false }).next())?.options?.validator;
  const deployed = operationMongoValidator("Company");
  const next = nextCompany();
  const target = parseFieldAdditionTarget(encodeFieldAdditionTarget("Company", next.validator, next.indexes).token);
  const company = (label: string) => ({ _id: randomUUID(), name: label, normalizedName: label, createdAt: new Date(), updatedAt: new Date() });
  const reset = async (rows: Row[]) => {
    await collection.drop().catch(() => undefined);
    await db.createCollection(name, { validator: deployed, validationLevel: "strict", validationAction: "error", collation: { locale: "simple" } });
    await collection.createIndexes(operationMongoIndexes("Company"), { collation: { locale: "simple" } });
    if (rows.length) await collection.insertMany(rows);
  };
  try {
    await reset([company("a"), company("b"), company("c")]);

    // Plan is read-only and reports the work.
    const plan = await inspectFieldAddition(options, target);
    assert.deepEqual({ ...plan, digest: undefined }, { model: "Company", digest: undefined, state: "ready", fields: ADDED, documentsToFill: 3, indexesToCreate: ["runtime_pii_businessNumberPiiIndex"], nonconformingSample: false });
    assert.equal(stableMongoValue(await stored()), stableMongoValue(deployed));

    await assert.rejects(applyFieldAddition({ ...options, allowShadowWrites: false as unknown as true }, target), code("SHADOW_WRITE_GATE"));

    // Apply: validator equals the next build's, every row carries null for every added field, the index exists.
    assert.deepEqual(await applyFieldAddition(writable, target), { outcome: "applied", filled: 3, indexesCreated: ["runtime_pii_businessNumberPiiIndex"] });
    assert.equal(stableMongoValue(await stored()), stableMongoValue(next.validator));
    for (const row of await collection.find().toArray()) for (const field of ADDED) assert.equal(row[field], null, field);
    assert.ok((await collection.listIndexes().toArray()).some(index => index.name === "runtime_pii_businessNumberPiiIndex"));
    await assert.rejects(collection.insertOne(company("missing fields")));
    await collection.insertOne({ ...company("d"), businessType: "service", businessNumber: null, businessNumberPiiIndex: null });
    assert.deepEqual(await applyFieldAddition(writable, target), { outcome: "already-applied", filled: 0, indexesCreated: [] });
    assert.equal(await storedValidatorIsFieldAddition(options, "Company"), true);

    // Restore refuses while an added field holds data, and never deletes it.
    await assert.rejects(restoreFieldAddition(writable, "Company"), code("FIELD_ADDITION_HAS_VALUES"));
    assert.equal(stableMongoValue(await stored()), stableMongoValue(next.validator));
    assert.equal((await collection.findOne({ name: "d" }))?.businessType, "service");
    await collection.updateOne({ name: "d" }, { $set: { businessType: null } });
    assert.deepEqual(await restoreFieldAddition(writable, "Company"), { outcome: "restored", fields: ADDED, cleared: 4 });
    assert.equal(stableMongoValue(await stored()), stableMongoValue(deployed));
    assert.equal(await collection.countDocuments({ $or: ADDED.map(field => ({ [field]: { $exists: true } })) }), 0);
    assert.equal(await collection.countDocuments({ $nor: [deployed] }), 0);
    assert.deepEqual(await restoreFieldAddition(writable, "Company"), { outcome: "already-deployed", fields: [], cleared: 0 });

    // A run that stopped after the validator switch is completed by running apply again.
    await db.command({ collMod: name, validator: next.validator, validationLevel: "strict", validationAction: "error" });
    assert.equal((await inspectFieldAddition(options, target)).state, "partially-applied");
    assert.deepEqual(await applyFieldAddition(writable, target), { outcome: "applied", filled: 4, indexesCreated: [] });
    assert.equal(await collection.countDocuments({ $nor: [next.validator] }), 0);

    // A restore that stopped after removing the fields still shows the addition and finishes on the next run.
    await collection.updateMany({}, { $unset: Object.fromEntries(ADDED.map(field => [field, ""])) }, { bypassDocumentValidation: true });
    assert.equal(await storedValidatorIsFieldAddition(options, "Company"), true);
    assert.deepEqual(await restoreFieldAddition(writable, "Company"), { outcome: "restored", fields: ADDED, cleared: 0 });
    assert.equal(stableMongoValue(await stored()), stableMongoValue(deployed));
    // Rows the deployed build cannot read are never reported as restored.
    await collection.updateOne({ name: "a" }, { $set: { businessType: null } }, { bypassDocumentValidation: true });
    await assert.rejects(restoreFieldAddition(writable, "Company"), code("EXISTING_DOCUMENTS_POLICY_MISMATCH"));

    // A row the target would reject even after the fill stops apply before any write.
    await reset([company("f")]);
    await db.command({ collMod: name, validator: next.validator, validationLevel: "strict", validationAction: "error" });
    await collection.insertOne({ ...company("g"), businessType: 7 }, { bypassDocumentValidation: true });
    assert.equal((await inspectFieldAddition(options, target)).nonconformingSample, true);
    await assert.rejects(applyFieldAddition(writable, target), code("EXISTING_DOCUMENTS_POLICY_MISMATCH"));
    assert.equal(await collection.countDocuments({ name: "f", businessType: { $exists: true } }), 0);

    // Added indexes may only key added fields, and every deployed index must stay as it is.
    await reset([]);
    const extraOn = (key: Record<string, 1>) => ({ ...target, indexes: [...target.indexes, { name: "runtime_lookup_x", key }] });
    await assert.rejects(inspectFieldAddition(options, extraOn({ createdAt: 1 })), code("FIELD_ADDITION_INDEX_NOT_ALLOWED"));
    await assert.rejects(inspectFieldAddition(options, { ...target, indexes: target.indexes.filter(index => index.name !== "runtime_unique_normalizedName") }), code("FIELD_ADDITION_INDEX_NOT_ALLOWED"));
    assert.deepEqual((await inspectFieldAddition(options, extraOn({ businessType: 1 }))).indexesToCreate, ["runtime_pii_businessNumberPiiIndex", "runtime_lookup_x"]);

    // A row the deployed validator already rejects stops apply before any write.
    await reset([company("e")]);
    await collection.insertOne({ _id: randomUUID(), name: "broken" }, { bypassDocumentValidation: true });
    assert.equal((await inspectFieldAddition(options, target)).nonconformingSample, true);
    await assert.rejects(applyFieldAddition(writable, target), code("EXISTING_DOCUMENTS_POLICY_MISMATCH"));
    assert.equal(stableMongoValue(await stored()), stableMongoValue(deployed));
    assert.equal(await collection.countDocuments({ businessType: { $exists: true } }), 0);

    // Only an addition on top of the deployed contract is accepted.
    await reset([]);
    await db.command({ collMod: name, validator: { $jsonSchema: { bsonType: "object" } }, validationLevel: "strict", validationAction: "error" });
    await assert.rejects(inspectFieldAddition(options, target), code("STORED_VALIDATOR_NOT_DEPLOYED_CONTRACT"));
    await assert.rejects(inspectFieldAddition(options, { ...target, validator: deployed }), code("VALIDATOR_CHANGE_NOT_FIELD_ADDITION"));
  } finally {
    await collection.drop().catch(() => undefined);
    await client.close();
  }
});
