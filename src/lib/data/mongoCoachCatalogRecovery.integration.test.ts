import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoOperationStore } from "./mongoOperationStore";
import { prepareMongoCoachSchedulingGuard } from "./mongoCoachSchedulingGuard";
import { recoverMongoCoachCatalog, recoverMongoInternalStructures } from "./mongoCoachCatalogRecovery";

const uri = process.env.MONGODB_CALENDAR_TEST_URI;
test("catalog recovery is read-only by default, additive, repeatable and rejects invalid existing state", { skip: !uri }, async () => {
  assert.equal(uri, "mongodb://127.0.0.1:27849/?replicaSet=calendarboundary20260930");
  const client = new MongoClient(uri!);
  const databaseName = `hub_om_shadow_recovery_${randomBytes(6).toString("hex")}`;
  const options = { client, databaseName, namespace: "shadow_recovery" };
  try {
    await client.connect();
    const store = new MongoOperationStore(options);
    await assert.rejects(recoverMongoCoachCatalog(options, true), /COACH_SCHEDULING_GUARD_NOT_READY/);
    assert.equal(await store.db.listCollections().hasNext(), false);
    await prepareMongoCoachSchedulingGuard(store, true);
    for (const model of ["Coach", "CoachContentEntry", "CoachEngagement"]) await store.db.createCollection(`${options.namespace}_${model}`);
    const before = await store.db.listCollections().toArray();
    assert.deepEqual(await recoverMongoCoachCatalog(options), { ready: false, missing: true, created: false });
    assert.deepEqual(await store.db.listCollections().toArray(), before);
    assert.deepEqual(await recoverMongoCoachCatalog(options, true), { ready: true, missing: true, created: true });
    const collection = store.db.collection(`${options.namespace}_CoachCatalogGuard`);
    assert.equal(await collection.countDocuments(), 0);
    assert.deepEqual(await recoverMongoCoachCatalog(options, true), { ready: true, missing: false, created: false });
    await assert.rejects(collection.insertOne({ _id: "invalid" } as never));
    await collection.createIndex({ nonce: 1 }, { expireAfterSeconds: 60 });
    const indexes = await collection.listIndexes().toArray();
    await assert.rejects(recoverMongoCoachCatalog(options, true), /COACH_CATALOG_GUARD_NOT_READY/);
    assert.deepEqual(await collection.listIndexes().toArray(), indexes);
  } finally { await client.db(databaseName).dropDatabase(); await client.close(); }
});
test("internal structure recovery creates only missing lecture sent log and team import guard", { skip: !uri }, async () => {
  const client = new MongoClient(uri!);
  const databaseName = `hub_om_shadow_recovery_${randomBytes(6).toString("hex")}`;
  const options = { client, databaseName, namespace: "shadow_recovery" };
  try {
    await client.connect();
    const store = new MongoOperationStore(options);
    const missing = [{ name: "LectureFollowUpSentLog", ready: false, missing: true, created: false }, { name: "TeamMemberImportGuard", ready: false, missing: true, created: false }];
    assert.deepEqual(await recoverMongoInternalStructures(options), missing);
    assert.equal(await store.db.listCollections().hasNext(), false);
    assert.deepEqual(await recoverMongoInternalStructures(options, true), missing.map(item => ({ ...item, ready: true, created: true })));
    assert.deepEqual(await recoverMongoInternalStructures(options, true), missing.map(item => ({ ...item, ready: true, missing: false })));
    for (const name of ["LectureFollowUpSentLog", "TeamMemberImportGuard"]) assert.equal(await store.db.collection(`${options.namespace}_${name}`).countDocuments(), 0);
    await store.db.collection(`${options.namespace}_TeamMemberImportGuard`).createIndex({ nonce: 1 }, { expireAfterSeconds: 60 });
    await assert.rejects(recoverMongoInternalStructures(options, true), /TEAM_MEMBER_IMPORT_GUARD_NOT_READY/);
  } finally { await client.db(databaseName).dropDatabase(); await client.close(); }
});
