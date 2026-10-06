import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient, type Document } from "mongodb";
import { randomBytes } from "node:crypto";
import { MongoNamespaceRecoveryError, recoverMongoNamespace } from "./mongoNamespaceRecovery";

const uri = process.env.MONGODB_NAMESPACE_RECOVERY_TEST_URI;

test("namespace recovery requires explicit frozen, distinct shadow namespaces", async () => {
  const client = { db() { throw new Error("unexpected IO"); } } as unknown as MongoClient;
  const base = { client, databaseName: "fixture", sourceNamespace: "shadow_source", targetNamespace: "shadow_target" };
  await assert.rejects(recoverMongoNamespace({ ...base, sourceWritesFrozen: false as true }), (error: unknown) => error instanceof MongoNamespaceRecoveryError && error.code === "SOURCE_FREEZE_REQUIRED");
  await assert.rejects(recoverMongoNamespace({ ...base, sourceNamespace: "bad", sourceWritesFrozen: true }), (error: unknown) => error instanceof MongoNamespaceRecoveryError && error.code === "NAMESPACE");
  await assert.rejects(recoverMongoNamespace({ ...base, targetNamespace: "shadow_source", sourceWritesFrozen: true }), (error: unknown) => error instanceof MongoNamespaceRecoveryError && error.code === "NAMESPACE");
});

test("native namespace recovery preserves documents, validators, indexes and rejects reuse", { skip: !uri, timeout: 120_000 }, async () => {
  const client = new MongoClient(uri!);
  const databaseName = `hub_om_shadow_recovery_${randomBytes(6).toString("hex")}`;
  const sourceNamespace = `shadow_source_${randomBytes(6).toString("hex")}`;
  const targetNamespace = `shadow_target_${randomBytes(6).toString("hex")}`;
  try {
    await client.connect();
    const db = client.db(databaseName);
    await db.createCollection(`${sourceNamespace}_Rows`, { validator: { value: { $type: "string" } }, validationLevel: "strict", validationAction: "error", collation: { locale: "simple" } });
    const rows = db.collection<Document & { _id: string }>(`${sourceNamespace}_Rows`);
    await rows.createIndex({ value: 1 }, { name: "value_unique", unique: true });
    await rows.insertMany([{ _id: "a", value: "one" }, { _id: "b", value: "two" }]);
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
    await client.db(databaseName).dropDatabase().catch(() => undefined);
    await client.close();
  }
});
