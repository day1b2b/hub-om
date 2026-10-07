import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient, type Document } from "mongodb";
import { randomBytes } from "node:crypto";
import { createEncryptedMongoNamespace, MongoNamespaceRecoveryError, recoverMongoNamespace } from "./mongoNamespaceRecovery";

const uri = process.env.MONGODB_NAMESPACE_RECOVERY_TEST_URI;

test("namespace recovery requires explicit frozen, distinct shadow namespaces", async () => {
  const client = { db() { throw new Error("unexpected IO"); } } as unknown as MongoClient;
  const base = { client, databaseName: "fixture", sourceNamespace: "shadow_source", targetNamespace: "shadow_target" };
  await assert.rejects(recoverMongoNamespace({ ...base, sourceWritesFrozen: false as true }), (error: unknown) => error instanceof MongoNamespaceRecoveryError && error.code === "SOURCE_FREEZE_REQUIRED");
  await assert.rejects(recoverMongoNamespace({ ...base, sourceNamespace: "bad", sourceWritesFrozen: true }), (error: unknown) => error instanceof MongoNamespaceRecoveryError && error.code === "NAMESPACE");
  await assert.rejects(recoverMongoNamespace({ ...base, targetNamespace: "shadow_source", sourceWritesFrozen: true }), (error: unknown) => error instanceof MongoNamespaceRecoveryError && error.code === "NAMESPACE");
});

test("encrypted namespace creation requires explicit frozen, distinct shadow namespaces", async () => {
  const client = { db() { throw new Error("unexpected IO"); } } as unknown as MongoClient;
  const base = { client, databaseName: "fixture", sourceNamespace: "shadow_source", targetNamespace: "shadow_target" };
  await assert.rejects(createEncryptedMongoNamespace({ ...base, sourceWritesFrozen: false as true }), (error: unknown) => error instanceof MongoNamespaceRecoveryError && error.code === "SOURCE_FREEZE_REQUIRED");
  await assert.rejects(createEncryptedMongoNamespace({ ...base, sourceNamespace: "bad", sourceWritesFrozen: true }), (error: unknown) => error instanceof MongoNamespaceRecoveryError && error.code === "NAMESPACE");
});

test("native namespace recovery preserves documents, validators, indexes and rejects reuse", { skip: !uri, timeout: 120_000 }, async () => {
  const client = new MongoClient(uri!);
  const databaseName = process.env.MONGODB_DB_NAME ?? decodeURIComponent(new URL(uri!).pathname.slice(1));
  const sourceNamespace = `shadow_source_${randomBytes(6).toString("hex")}`;
  const targetNamespace = `shadow_target_${randomBytes(6).toString("hex")}`;
  assert.ok(databaseName, "native recovery test requires a database name in MONGODB_DB_NAME or the URI path");
  try {
    await client.connect();
    const db = client.db(databaseName);
    await db.createCollection(`${sourceNamespace}_Rows`, { validator: { value: { $type: "string" } }, validationLevel: "strict", validationAction: "error", collation: { locale: "simple" } });
    const rows = db.collection<Document & { _id: string }>(`${sourceNamespace}_Rows`);
    await rows.createIndex({ value: 1 }, { name: "value_unique", unique: true });
    await rows.insertMany([{ _id: "a", value: "one" }, { _id: "b", value: "two" }, { _id: "c", value: "deleted-before-recovery" }]);
    await rows.updateOne({ _id: "b" }, { $set: { value: "two-updated" } });
    await rows.deleteOne({ _id: "c" });
    await db.createCollection(`${sourceNamespace}___counter`, { validator: { value: { $type: "int" } }, validationLevel: "strict", validationAction: "error" });
    await db.collection<Document & { _id: string }>(`${sourceNamespace}___counter`).insertOne({ _id: "Course.processSeq", value: 42 });
    const result = await recoverMongoNamespace({ client, databaseName, sourceNamespace, targetNamespace, sourceWritesFrozen: true });
    assert.equal(result.collectionCount, 2); assert.equal(result.documentCount, 3); assert.equal(result.sourceUnchanged, true); assert.equal(result.targetVerified, true);
    assert.deepEqual(await db.collection(`${targetNamespace}_Rows`).find({}).sort({ _id: 1 }).toArray(), await rows.find({}).sort({ _id: 1 }).toArray());
    const targetInfo = await db.listCollections({ name: `${targetNamespace}_Rows` }, { nameOnly: false }).next();
    assert.equal(targetInfo?.options?.validationLevel, "strict");
    assert.ok((await db.collection(`${targetNamespace}_Rows`).listIndexes().toArray()).some(index => index.name === "value_unique" && index.unique));
    await assert.rejects(recoverMongoNamespace({ client, databaseName, sourceNamespace, targetNamespace, sourceWritesFrozen: true }), (error: unknown) => error instanceof MongoNamespaceRecoveryError && error.code === "TARGET_NOT_EMPTY");
  } finally {
    const db = client.db(databaseName);
    const names = await db.listCollections({}, { nameOnly: true }).toArray().catch(() => []);
    await Promise.all(names.filter(({ name }) => name.startsWith(`${sourceNamespace}_`) || name.startsWith(`${targetNamespace}_`)).map(({ name }) => db.collection(name).drop().catch(() => undefined)));
    await client.close();
  }
});

test("native encrypted namespace preserves metadata and replaces legacy plaintext", { skip: !uri, timeout: 120_000 }, async () => {
  const client = new MongoClient(uri!);
  const databaseName = process.env.MONGODB_DB_NAME ?? decodeURIComponent(new URL(uri!).pathname.slice(1));
  const sourceNamespace = `shadow_source_${randomBytes(6).toString("hex")}`;
  const targetNamespace = `shadow_encrypted_${randomBytes(6).toString("hex")}`;
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ALLOW_PLAINTEXT_READS: "false",
  });
  try {
    await client.connect();
    const db = client.db(databaseName);
    await db.createCollection(`${sourceNamespace}_TeamUser`, { validator: { name: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    const source = db.collection<Document & { _id: string }>(`${sourceNamespace}_TeamUser`);
    await source.createIndex({ name: 1 }, { name: "name_lookup" });
    await source.insertOne({ _id: "user-1", name: "legacy fixture", unrelated: "preserved" });
    const sourceBefore = await source.findOne({ _id: "user-1" });
    const result = await createEncryptedMongoNamespace({ client, databaseName, sourceNamespace, targetNamespace, sourceWritesFrozen: true });
    assert.equal(result.collectionCount, 1); assert.equal(result.documentCount, 1); assert.equal(result.changedDocuments, 1); assert.equal(result.changedFields, 1);
    assert.equal(result.sourceUnchanged, true); assert.equal(result.targetVerified, true); assert.equal(result.privacyReady, true); assert.equal(result.cutoverAuthorized, false);
    assert.deepEqual(await source.findOne({ _id: "user-1" }), sourceBefore);
    const target = await db.collection<Document & { _id: string }>(`${targetNamespace}_TeamUser`).findOne({ _id: "user-1" });
    assert.equal(target?.unrelated, "preserved"); assert.notEqual(target?.name, "legacy fixture"); assert.match(String(target?.name), /^v1:/);
    const targetInfo = await db.listCollections({ name: `${targetNamespace}_TeamUser` }, { nameOnly: false }).next();
    assert.equal(targetInfo?.options?.validationLevel, "strict");
    assert.ok((await db.collection(`${targetNamespace}_TeamUser`).listIndexes().toArray()).some(index => index.name === "name_lookup"));
  } finally {
    const db = client.db(databaseName);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray().catch(() => []);
    await Promise.all(collections.filter(({ name }) => name.startsWith(`${sourceNamespace}_`) || name.startsWith(`${targetNamespace}_`)).map(({ name }) => db.collection(name).drop().catch(() => undefined)));
    await client.close().catch(() => undefined);
    for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
