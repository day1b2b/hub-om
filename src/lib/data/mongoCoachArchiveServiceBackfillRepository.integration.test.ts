import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { Collection, MongoClient, MongoServerError } from "mongodb";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { COACH_ARCHIVE_SERVICE_BACKFILL_MODELS, MongoCoachArchiveServiceBackfillRepository, prepareMongoCoachArchiveServiceBackfillStore } from "./mongoCoachArchiveServiceBackfillRepository";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { isEncrypted } from "../privacy/crypto";
import { openMongoCoachArchiveServiceBackfillRuntime } from "./mongoCoachArchiveServiceBackfillRuntime";
import { runCoachArchiveServiceBackfillCommand } from "./coachArchiveServiceBackfillCommand";

const uri = process.env.MONGODB_COACH_ARCHIVE_SERVICE_BACKFILL_TEST_URI;
test("coach archive service backfill on an isolated Mongo replica set", { skip: !uri, timeout: 180_000 }, async () => {
  const url = new URL(uri!); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, "");
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_archive_service_${randomBytes(8).toString("hex")}`;
  const namespace = `shadow_archive_service_${randomBytes(8).toString("hex")}`;
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoCoachArchiveServiceBackfillStore(options);
    const store = new MongoOperationStore(options, COACH_ARCHIVE_SERVICE_BACKFILL_MODELS);
    const insert = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
    };
    const oldSnapshot = await insert("CoachdbArchiveSnapshot", { status: "completed", startedAt: new Date("2098-01-01") });
    const latestSnapshot = await insert("CoachdbArchiveSnapshot", { status: "completed", startedAt: new Date("2099-01-01") });
    const failedSnapshot = await insert("CoachdbArchiveSnapshot", { status: "failed", startedAt: new Date("2100-01-01") });
    const sourceCoachId = "synthetic:archive-service", coachId = randomUUID();
    await insert("Coach", { id: coachId, sourceCoachId, name: "Synthetic Archive Coach", normalizedName: "synthetic archive coach", accessToken: "old-token", statusNote: "old-note", managerNote: "old-manager" });
    const oldData = { access_token: "older-token", status_note: "older", manager_note: "older manager" };
    const latestData = { access_token: "new-token", status_note: "new status", return_date: "2099-02-03T09:00:00Z", self_note: "new self", portfolio_url: "https://example.invalid/private", availability_detail: "new availability", manager_note: "new manager", dx_tag: "new dx", deleted_by: "synthetic-admin@example.invalid" };
    await insert("CoachdbArchiveRow", { snapshotId: oldSnapshot.id, tableSchema: "public", tableName: "coaches", rowKey: sourceCoachId, rowData: oldData });
    await insert("CoachdbArchiveRow", { snapshotId: latestSnapshot.id, tableSchema: "public", tableName: "coaches", rowKey: sourceCoachId, rowData: latestData });
    await insert("CoachdbArchiveRow", { snapshotId: failedSnapshot.id, tableSchema: "public", tableName: "coaches", rowKey: sourceCoachId, rowData: { access_token: "failed-token" } });
    await insert("CoachdbArchiveRow", { snapshotId: latestSnapshot.id, tableSchema: "public", tableName: "schedule_access_logs", rowKey: "synthetic:access-log", rowData: { coach_id: sourceCoachId, year_month: "2099-02", accessed_at: "2099-02-04T01:02:03Z", last_edited_at: "2099-02-05T01:02:03Z" } });
    const repo = await MongoCoachArchiveServiceBackfillRepository.open(options);
    const before = await store.collection("Coach").findOne({ _id: coachId }); assert.ok(before);
    assert.deepEqual(await repo.backfill({ apply: false }), { coachRows: 1, changedCoaches: 1, accessLogRows: 1, updatedCoaches: 0, upsertedAccessLogs: 0 });
    assert.deepEqual(await store.collection("Coach").findOne({ _id: coachId }), before); assert.equal(await store.collection("CoachScheduleAccessLog").countDocuments(), 0);
    const malformed = await insert("CoachdbArchiveRow", { snapshotId: latestSnapshot.id, tableSchema: "public", tableName: "schedule_access_logs", rowKey: "synthetic:malformed-log", rowData: { coach_id: sourceCoachId, year_month: "2099-03", accessed_at: "private malformed timestamp" } });
    await assert.rejects(repo.backfill({ apply: true }), error => !String(error).includes("private malformed timestamp"));
    assert.deepEqual(await store.collection("Coach").findOne({ _id: coachId }), before, "late access-log failure rolls back the coach update");
    assert.equal(await store.collection("CoachScheduleAccessLog").countDocuments(), 0);
    await store.collection("CoachdbArchiveRow").deleteOne({ _id: malformed.id as string });
    assert.deepEqual(await repo.backfill({ apply: true }), { coachRows: 1, changedCoaches: 1, accessLogRows: 1, updatedCoaches: 1, upsertedAccessLogs: 1 });
    const logical = await store.one("Coach", { _id: coachId }); assert.ok(logical); assert.equal(logical.accessToken, "new-token"); assert.equal(logical.managerNote, "new manager"); assert.deepEqual(logical.returnDate, new Date("2099-02-03T00:00:00Z"));
    const raw = await store.collection("Coach").findOne({ _id: coachId }); assert.ok(raw); assert.ok(isEncrypted(raw.accessToken)); assert.ok(isEncrypted(raw.managerNote));
    const stored = JSON.stringify(raw); for (const secret of Object.values(latestData).filter(value => typeof value === "string")) assert.ok(!stored.includes(secret));
    const appliedCoach = await store.collection("Coach").findOne({ _id: coachId }), appliedLog = await store.collection("CoachScheduleAccessLog").findOne({ coachId, yearMonth: "2099-02" }); assert.ok(appliedLog);
    assert.deepEqual(await repo.backfill({ apply: true }), { coachRows: 1, changedCoaches: 0, accessLogRows: 1, updatedCoaches: 0, upsertedAccessLogs: 1 });
    assert.deepEqual(await store.collection("Coach").findOne({ _id: coachId }), appliedCoach);
    assert.equal((await store.collection("CoachScheduleAccessLog").findOne({ coachId, yearMonth: "2099-02" }))?._id, appliedLog._id);

    await insert("CoachdbArchiveRow", { snapshotId: latestSnapshot.id, tableSchema: "public", tableName: "schedule_access_logs", rowKey: "synthetic:retry-log", rowData: { coach_id: sourceCoachId, year_month: "2099-04", accessed_at: "2099-04-01T00:00:00Z" } });
    const originalInsert = Collection.prototype.insertOne; let attempts = 0;
    const duplicate = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
      const document = args[0] as Record<string, unknown>;
      if (this.collectionName === `${namespace}_CoachScheduleAccessLog` && document.yearMonth === "2099-04" && attempts++ === 0) {
        throw new MongoServerError({ message: "synthetic first-upsert race", code: 11000 });
      }
      return originalInsert.apply(this, args);
    });
    try {
      assert.deepEqual(await repo.backfill({ apply: true }), { coachRows: 1, changedCoaches: 0, accessLogRows: 2, updatedCoaches: 0, upsertedAccessLogs: 2 });
    } finally { duplicate.mock.restore(); }
    assert.equal(attempts, 2); assert.equal(await store.collection("CoachScheduleAccessLog").countDocuments({ coachId }), 2);
    const runtime = await openMongoCoachArchiveServiceBackfillRuntime(options);
    assert.deepEqual(await runtime.run(() => runCoachArchiveServiceBackfillCommand(["--dry-run"], () => { throw new Error("default environment must stay closed"); })), {
      options: { apply: false }, summary: { coachRows: 1, changedCoaches: 0, accessLogRows: 2, updatedCoaches: 0, upsertedAccessLogs: 0 },
    });

    const pagedOptions = { ...options, namespace: `${namespace}_paged` };
    await prepareMongoCoachArchiveServiceBackfillStore(pagedOptions);
    const pagedStore = new MongoOperationStore(pagedOptions, COACH_ARCHIVE_SERVICE_BACKFILL_MODELS);
    const pagedSnapshot = coachFixtureRow("CoachdbArchiveSnapshot", { status: "completed", startedAt: new Date("2099-01-01") });
    await pagedStore.collection("CoachdbArchiveSnapshot").insertOne(encodeMongoRuntimeDocument("CoachdbArchiveSnapshot", pagedSnapshot));
    const pagedCoaches: MongoRow[] = [], pagedArchives: MongoRow[] = [];
    for (let index = 0; index < 251; index++) {
      const id = randomUUID(), source = `synthetic:paged:${index}`;
      pagedCoaches.push(coachFixtureRow("Coach", { id, sourceCoachId: source, name: `Synthetic Paged ${index}`, normalizedName: `synthetic paged ${index}`, statusNote: "old" }));
      pagedArchives.push(coachFixtureRow("CoachdbArchiveRow", { snapshotId: pagedSnapshot.id, tableSchema: "public", tableName: "coaches", rowKey: source, rowData: { status_note: "new" } }));
      pagedArchives.push(coachFixtureRow("CoachdbArchiveRow", { snapshotId: pagedSnapshot.id, tableSchema: "public", tableName: "schedule_access_logs", rowKey: `synthetic:paged-log:${index}`, rowData: { coach_id: source, year_month: "2099-05", accessed_at: "2099-05-01T00:00:00Z", ...(index < 3 ? { padding: "x".repeat(5 * 1024 * 1024) } : {}) } }));
    }
    await pagedStore.collection("Coach").insertMany(pagedCoaches.map(row => encodeMongoRuntimeDocument("Coach", row)));
    await pagedStore.collection("CoachdbArchiveRow").insertMany(pagedArchives.map(row => encodeMongoRuntimeDocument("CoachdbArchiveRow", row)));
    const pagedRepo = await MongoCoachArchiveServiceBackfillRepository.open(pagedOptions);
    assert.deepEqual(await pagedRepo.backfill({ apply: false }), { coachRows: 251, changedCoaches: 251, accessLogRows: 251, updatedCoaches: 0, upsertedAccessLogs: 0 });
    assert.equal(await pagedStore.collection("CoachScheduleAccessLog").countDocuments(), 0);

    const partialOptions = { ...options, namespace: `${namespace}_partial` };
    await client.db(databaseName).createCollection(`${partialOptions.namespace}_Coach`);
    const collectionsBefore = await client.db(databaseName).listCollections({ name: { $regex: `^${partialOptions.namespace}_` } }, { nameOnly: true }).toArray();
    await assert.rejects(MongoCoachArchiveServiceBackfillRepository.open(partialOptions));
    assert.deepEqual(await client.db(databaseName).listCollections({ name: { $regex: `^${partialOptions.namespace}_` } }, { nameOnly: true }).toArray(), collectionsBefore);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } finally { await client.close(); for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
  }
});
