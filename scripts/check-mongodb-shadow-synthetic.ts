/** Explicit opt-in only. Never reads application collections or uses real PII encryption keys. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MongoClient, MongoServerError } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../src/lib/mongodb/connection";
import { NativeMongoShadowTarget } from "../src/lib/mongodb/shadowTarget";
import { encodeMongoDocument, hashMongoDocument, mongoModelContracts, mongoModelNames } from "../src/lib/migration/mongoDocumentCodec";
import { verifyMongoShadowRelations } from "../src/lib/migration/mongoShadowImport";
import { privacyFields } from "../src/lib/privacy/fields";

function syntheticRow(model: string): Record<string, unknown> {
  const companions = new Set(Object.values(privacyFields[model]?.fields ?? {}).flatMap(policy => [policy.index, policy.storage]));
  const values: Record<string, unknown> = {
    String: "synthetic-fixture-only", Int: 1, Boolean: true,
    Decimal: "999999999999.99", Bytes: Buffer.from([0, 255, 1]),
    DateTime: new Date("2026-09-22T00:00:00.000Z"),
    Json: { synthetic: true, nested: [null, 1], $date: "ordinary user JSON" },
  };
  return Object.fromEntries(Object.entries(mongoModelContracts[model].fields).filter(([field]) => !companions.has(field)).map(([field, contract]) => {
    const value = contract.values?.[0] ?? (contract.uuid ? "00000000-0000-4000-8000-000000000001" : values[contract.type]);
    assert.notEqual(value, undefined);
    return [field, contract.list ? [value] : value];
  }));
}

let stage = "ARGUMENTS";
async function main() {
  const flags = process.argv.slice(2);
  if (!flags.includes("--allow-synthetic-shadow-writes") || new Set(flags).size !== flags.length || flags.some(flag => !["--allow-synthetic-shadow-writes", "--cleanup-synthetic-db"].includes(flag))) throw new Error("EXPLICIT_SYNTHETIC_WRITE_FLAG_REQUIRED");
  const cleanup = flags.includes("--cleanup-synthetic-db");
  // The URI default DB is ignored. An explicit shadow DB uses only random owned collections.
  stage = "URI_CONFIGURATION";
  const uri = configuredMongoUri({ MONGODB_URI: process.env.MONGODB_URI });
  stage = "SYNTHETIC_DATABASE_NAME";
  const explicitDatabase = process.env.MONGODB_SHADOW_DATABASE !== undefined;
  const databaseName = explicitDatabase ? shadowDatabaseName({ MONGODB_SHADOW_DATABASE: process.env.MONGODB_SHADOW_DATABASE }) : `hub_om_shadow_synthetic_${randomBytes(12).toString("hex")}`;
  const namespace = `shadow_synthetic_${randomBytes(12).toString("hex")}`;
  const probeName = `${namespace}_transaction_probe`;
  const candidateNames = [...mongoModelNames.map(model => `${namespace}_${model}`), probeName];
  shadowDatabaseName({ MONGODB_SHADOW_DATABASE: databaseName });
  stage = "SYNTHETIC_KEYS";
  const keyVariables = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const previous = keyVariables.map(key => process.env[key]);
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ synthetic: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "synthetic";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  stage = "CLIENT_CONSTRUCTION";
  const client = new MongoClient(uri, mongoConnectionOptions());
  const createdCollections = new Set<string>();
  let cleanupVerified = false;
  async function cleanupOwned() {
    const db = client.db(databaseName);
    assert.equal(db.databaseName, databaseName);
    if (!explicitDatabase) {
      assert.match(databaseName, /^hub_om_shadow_synthetic_[a-f0-9]{24}$/);
      assert.equal(await db.dropDatabase(), true);
      createdCollections.clear();
      return;
    }
    // A caller-specified DB is never dropped, even if its name looks synthetic.
    for (const name of [...createdCollections]) {
      assert.ok(candidateNames.includes(name) && name.startsWith(`${namespace}_`));
      assert.equal(await db.collection(name).drop(), true);
      createdCollections.delete(name);
    }
  }
  try {
    // Build and authenticate fixtures before connecting or writing.
    stage = "FIXTURE_ENCODING";
    const documents = new Map(mongoModelNames.map(model => [model, encodeMongoDocument(model, syntheticRow(model), { sourceMode: "plaintext" })]));
    stage = "CONNECT";
    await client.connect();
    stage = "ISOLATED_DATABASE_CHECK";
    const db = client.db(databaseName);
    assert.equal(db.databaseName, databaseName);
    const target = new NativeMongoShadowTarget(db);
    // Inspect only exact randomly generated candidates, never enumerate existing collections.
    assert.equal((await db.listCollections({ name: { $in: candidateNames } }, { nameOnly: true }).toArray()).length, 0);
    for (const name of candidateNames) {
      // Raw create command must succeed before the collection enters our cleanup ownership set.
      await db.command({ create: name, writeConcern: { w: "majority" } });
      createdCollections.add(name);
    }
    stage = "BSON_ROUNDTRIP";
    for (const [model, document] of documents) {
      const expected = hashMongoDocument(model, document);
      assert.equal(await target.insertOnly(namespace, model, document), true);
      assert.equal(await target.insertOnly(namespace, model, document), false);
      const readback = await target.get(namespace, model, document._id);
      assert.ok(readback);
      assert.equal(hashMongoDocument(model, readback as typeof document), expected);
      const page = await target.page(namespace, model, null, 2);
      assert.equal(page.length, 1);
      assert.equal(hashMongoDocument(model, page[0] as typeof document), expected);
      assert.equal((await target.page(namespace, model, document._id, 2)).length, 0);
      assert.equal(await target.count(namespace, model), 1);
    }
    stage = "RELATION_VERIFICATION";
    const relations = await verifyMongoShadowRelations(target, namespace);
    assert.equal(relations.verified, true);
    stage = "TRANSACTION_PROBE";
    const probe = db.collection(probeName);
    const session = client.startSession();
    try {
      session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      await probe.insertOne({ marker: "synthetic-rollback-only" }, { session });
      assert.equal(await probe.countDocuments({}, { session }), 1);
      await session.abortTransaction();
      assert.equal(await probe.countDocuments({}, { readConcern: { level: "majority" }, maxTimeMS: 15000 }), 0);
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
    if (cleanup) {
      stage = "SYNTHETIC_CLEANUP";
      await cleanupOwned();
      cleanupVerified = true;
    }
    console.log(JSON.stringify({ syntheticOnly: true, modelsVerified: documents.size, rowsVerified: documents.size,
      bsonRoundtripVerified: true, insertOnlyRetryVerified: true, referencesVerified: true,
      transactionRollbackVerified: true, syntheticCollectionsCleaned: cleanupVerified, syntheticDatabaseCleaned: cleanupVerified && !explicitDatabase, readyForCutover: false }));
  } finally {
    // Cleanup requires the flag and owns only this invocation's generated collections/DB.
    try {
      if (cleanup && createdCollections.size > 0 && !cleanupVerified) await cleanupOwned();
    } finally {
      await client.close().catch(() => {});
      keyVariables.forEach((key, index) => { const value = previous[index]; if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    }
  }
}
main().catch((error: unknown) => {
  const category = error instanceof MongoServerError && error.code === 13 ? "AUTHORIZATION_DENIED" : error instanceof MongoServerError && error.code === 18 ? "AUTHENTICATION_FAILED" : "CHECK_FAILED";
  console.error(JSON.stringify({ code: "SYNTHETIC_SHADOW_CHECK_FAILED", stage, category, readyForCutover: false }));
  process.exitCode = 1;
});
