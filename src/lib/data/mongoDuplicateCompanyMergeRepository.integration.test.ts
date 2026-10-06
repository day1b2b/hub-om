import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mock, test } from "node:test";
import { Collection, MongoClient, MongoServerError } from "mongodb";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { DUPLICATE_COMPANY_MERGE_MODELS, MongoDuplicateCompanyMergeRepository } from "./mongoDuplicateCompanyMergeRepository";
import { MongoOperationStore, prepareMongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { lockMongoCourseNameRestore } from "./mongoCourseNameRestoreGuard";
import { MongoOperationRepository } from "./mongoOperationRepository";

const uri = process.env.MONGODB_DUPLICATE_COMPANY_MERGE_TEST_URI;
test("duplicate company merge uses a native Mongo transaction and is repeatable", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port); assert.equal(url.username, "");
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_company_merge_${randomBytes(6).toString("hex")}`, namespace = `shadow_company_merge_${randomBytes(6).toString("hex")}`;
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"], saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoOperationStore({ ...options, processSequenceHighWater: 1003 }); const store = new MongoOperationStore(options, DUPLICATE_COMPANY_MERGE_MODELS);
    const insert = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    const source = await insert("Company", { name: "Synthetic Typo", normalizedName: "synthetic typo" });
    const target = await insert("Company", { name: "Synthetic Correct", normalizedName: "synthetic correct" });
    const move = await insert("Course", { companyId: source.id, courseId: "MOVE", name: "Move course", processSeq: 1001 });
    const merge = await insert("Course", { companyId: source.id, courseId: "MERGE", name: "Merge course", processSeq: 1002 });
    const destination = await insert("Course", { companyId: target.id, courseId: "MERGE", name: "Merge course", processSeq: 1003 });
    await insert("OperationSession", { courseRecordId: move.id, operationId: "synthetic-move" });
    await insert("OperationSession", { courseRecordId: merge.id, operationId: "synthetic-merge" });
    await insert("CourseIdLabel", { companyId: source.id, courseId: "MOVE", label: "Move label" });
    await insert("CourseIdLabel", { companyId: source.id, courseId: "MERGE", label: "Discard label" });
    await insert("CourseIdLabel", { companyId: target.id, courseId: "MERGE", label: "Keep label" });
    const repository = await MongoDuplicateCompanyMergeRepository.open(options);
    const operations = await MongoOperationRepository.open(options);
    const held = client.startSession(); held.startTransaction(); await lockMongoCourseNameRestore(new MongoOperationStore(options), held);
    let finished = false, entered!: () => void;
    const guardEntered = new Promise<void>(resolve => { entered = resolve; });
    const originalGuardUpdate = Collection.prototype.updateOne;
    const guardUpdate = mock.method(Collection.prototype, "updateOne", async function(this: Collection, ...args: Parameters<Collection["updateOne"]>) {
      if (this.collectionName === `${namespace}_CourseNameRestoreGuard`) entered();
      return originalGuardUpdate.apply(this, args);
    });
    const competing = operations.updateOperation("synthetic-move", { courseId: "MERGE", courseName: "Merge course" }).then(() => { finished = true; });
    try {
      await Promise.race([guardEntered, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("guard was not reached")), 2_000))]);
      assert.equal(finished, false, "ordinary course reassignment waits for the shared catalog guard");
      await held.abortTransaction(); await competing;
    } finally { guardUpdate.mock.restore(); await held.endSession(); }
    await store.collection("OperationSession").updateOne({ operationId: "synthetic-move" }, { $set: { courseRecordId: move.id } });
    await store.collection("OperationSession").updateOne({ operationId: "synthetic-merge" }, { $set: { updatedAt: new Date("2020-01-01T00:00:00.000Z") } });
    const mergedBefore = await store.one("OperationSession", { operationId: "synthetic-merge" }); assert.ok(mergedBefore);
    const before = await Promise.all(DUPLICATE_COMPANY_MERGE_MODELS.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray()));
    const dry = await repository.merge({ sourceName: "Synthetic Typo", targetName: "Synthetic Correct", apply: false });
    assert.deepEqual(dry.courses.map(row => row.action).sort(), ["merge-into-existing", "reassign"]); assert.equal(dry.remainingCourses, 2);
    assert.deepEqual(await Promise.all(DUPLICATE_COMPANY_MERGE_MODELS.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray())), before);
    const originalReplace = Collection.prototype.replaceOne;
    const late = mock.method(Collection.prototype, "replaceOne", async function(this: Collection, ...args: Parameters<Collection["replaceOne"]>) {
      if (this.collectionName === `${namespace}_CourseIdLabel`) throw new Error("synthetic private late failure");
      return originalReplace.apply(this, args);
    });
    try { await assert.rejects(repository.merge({ sourceName: "Synthetic Typo", targetName: "Synthetic Correct", apply: true }), error => !String(error).includes("private")); }
    finally { late.mock.restore(); }
    assert.deepEqual(await Promise.all(DUPLICATE_COMPANY_MERGE_MODELS.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray())), before, "late label failure rolls back course and session changes");
    const applied = await repository.merge({ sourceName: "Synthetic Typo", targetName: "Synthetic Correct", apply: true });
    assert.deepEqual([applied.reassignedCourses, applied.mergedCourses, applied.updatedSessions, applied.reassignedLabels, applied.discardedLabels, applied.remainingCourses], [1, 1, 1, 1, 1, 0]);
    assert.equal(await store.collection("Company").countDocuments({ _id: source.id as string }), 1);
    assert.equal((await store.one("Course", { _id: move.id as string }))?.companyId, target.id);
    assert.equal(await store.collection("Course").countDocuments({ _id: merge.id as string }), 0);
    assert.equal((await store.one("OperationSession", { operationId: "synthetic-merge" }))?.courseRecordId, destination.id);
    assert.ok(((await store.one("OperationSession", { operationId: "synthetic-merge" }))?.updatedAt as Date) > (mergedBefore.updatedAt as Date));
    assert.equal(await store.collection("CourseIdLabel").countDocuments({ companyId: source.id as string }), 0);
    const replay = await repository.merge({ sourceName: "Synthetic Typo", targetName: "Synthetic Correct", apply: true });
    assert.equal(replay.courses.length, 0); assert.equal(replay.updatedSessions, 0);
    const originalUpdate = Collection.prototype.updateOne; let attempts = 0;
    const race = mock.method(Collection.prototype, "updateOne", async function(this: Collection, ...args: Parameters<Collection["updateOne"]>) {
      if (this.collectionName === `${namespace}_CourseNameRestoreGuard` && attempts++ === 0) throw new MongoServerError({ message: "synthetic first guard race", code: 11000 });
      return originalUpdate.apply(this, args);
    });
    try { await repository.merge({ sourceName: "Synthetic Typo", targetName: "Synthetic Correct", apply: true }); } finally { race.mock.restore(); }
    assert.equal(attempts, 2);
    const partial = { ...options, namespace: `${namespace}_partial` };
    await client.db(databaseName).createCollection(`${partial.namespace}_Company`); const collection = client.db(databaseName).collection<{ _id: string }>(`${partial.namespace}_Company`);
    await collection.insertOne({ _id: "sentinel" }); const partialBefore = await collection.find({}).toArray();
    await assert.rejects(MongoDuplicateCompanyMergeRepository.open(partial)); assert.deepEqual(await collection.find({}).toArray(), partialBefore);
  } finally { try { await client.db(databaseName).dropDatabase(); } finally { await client.close(); for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
});
