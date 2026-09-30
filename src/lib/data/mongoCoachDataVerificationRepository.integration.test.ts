import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { coachFixtureRow, mongoCoachFixtures } from "./mongoCoachFixtures";
import { COACH_DATA_VERIFICATION_MODELS, MongoCoachDataVerificationRepository, prepareMongoCoachDataVerificationStore } from "./mongoCoachDataVerificationRepository";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_COACH_DATA_VERIFICATION_TEST_URI;
test("coach data verification reads one private Mongo snapshot without writes", { skip: !uri, timeout: 120_000 }, async () => {
  const parsed = new URL(uri!); assert.equal(parsed.hostname, "127.0.0.1"); assert.ok(parsed.port); assert.equal(parsed.username, "");
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const databaseName = `hub_om_shadow_verify_${randomBytes(6).toString("hex")}`, namespace = `shadow_verify_${randomBytes(6).toString("hex")}`;
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoCoachDataVerificationStore(options); const store = new MongoOperationStore(options, COACH_DATA_VERIFICATION_MODELS);
    const fixtures = mongoCoachFixtures();
    for (const model of COACH_DATA_VERIFICATION_MODELS) for (const row of fixtures.data.get(model) ?? [])
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row));
    const tiedAt = new Date("2100-01-01");
    for (const [id, mode, coachCount] of [["00000000-0000-4000-8000-000000000001", "lower", 1], ["00000000-0000-4000-8000-000000000002", "higher", 4]] as const)
      await store.collection("CoachImportRun").insertOne(encodeMongoRuntimeDocument("CoachImportRun", coachFixtureRow("CoachImportRun", {
        id, mode, status: "COMPLETED", coachCount, engagementCount: 3, scheduleCount: 5, matchedOperationCount: 0, errorCount: 0, startedAt: tiedAt, finishedAt: new Date("2100-01-02") })));
    for (const [id, status] of [["00000000-0000-4000-8000-000000000011", "old-tie"], ["00000000-0000-4000-8000-000000000012", "new-tie"]] as const)
      await store.collection("CoachdbArchiveSnapshot").insertOne(encodeMongoRuntimeDocument("CoachdbArchiveSnapshot", coachFixtureRow("CoachdbArchiveSnapshot", { id, status, startedAt: tiedAt })));
    await store.collection("CoachdbArchiveRow").insertOne(encodeMongoRuntimeDocument("CoachdbArchiveRow", coachFixtureRow("CoachdbArchiveRow", {
      snapshotId: "00000000-0000-4000-8000-000000000012", tableSchema: "public", tableName: "engagements", rowKey: "tie-row", rowData: {} })));
    const before = await Promise.all(COACH_DATA_VERIFICATION_MODELS.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray()));
    const commands: string[] = [], listener = (event: CommandStartedEvent) => { if (event.databaseName === databaseName) commands.push(event.commandName); };
    client.on("commandStarted", listener); let report;
    try { report = await (await MongoCoachDataVerificationRepository.open(options)).readReport(); } finally { client.off("commandStarted", listener); }
    assert.deepEqual(Object.fromEntries(report.serviceCounts.map(row => [row.label, row.count])), { coaches_total: 4, coaches_visible: 3, coaches_deleted: 1,
      private_profiles: 1, engagements: 3, schedules: 5, engagement_schedules: 3, matched_engagements: 0, unmatched_engagements: 3 });
    assert.equal(report.latestImport?.mode, "higher"); assert.equal(report.latestArchive?.status, "new-tie");
    assert.deepEqual(report.archiveCounts, [{ label: "engagements", count: 1 }]);
    assert.ok(!commands.some(name => ["insert", "update", "delete", "findAndModify", "create", "createIndexes", "collMod"].includes(name)));
    assert.deepEqual(await Promise.all(COACH_DATA_VERIFICATION_MODELS.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray())), before);
    assert.doesNotMatch(JSON.stringify(before), /가상 가|Synthetic private|synthetic-profile@example/);
    const partial = { ...options, namespace: `${namespace}_partial` };
    await client.db(databaseName).createCollection(`${partial.namespace}_Coach`); const sentinel = client.db(databaseName).collection<{ _id: string }>(`${partial.namespace}_Coach`);
    await sentinel.insertOne({ _id: "sentinel" }); const partialBefore = await sentinel.find({}).toArray();
    await assert.rejects(MongoCoachDataVerificationRepository.open(partial)); assert.deepEqual(await sentinel.find({}).toArray(), partialBefore);
  } finally { try { await client.db(databaseName).dropDatabase(); } finally { await client.close(); for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
});
