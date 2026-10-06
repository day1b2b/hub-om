import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test, { mock } from "node:test";
import { Collection, MongoClient, MongoServerError } from "mongodb";
import { runCoachOperationBackfillCommand, runCoachOperationDiagnoseCommand } from "./coachOperationMatchCommand";
import { runCoachOperationMatchCli } from "./coachOperationMatchCliRuntime";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MONGO_COACH_OPERATION_MATCH_RUNTIME_MODELS, prepareMongoCoachOperationMatchRuntime } from "./mongoCoachOperationMatchRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoCoachOperationMatchRepository } from "./mongoCoachOperationMatchRepository";

const uri = process.env.MONGODB_COACH_OPERATION_MATCH_CLI_URI;
test("coach operation match CLIs diagnose and idempotently apply on an isolated Mongo replica set", { skip: !uri, timeout: 120_000 }, async () => {
  const parsed = new URL(uri!); assert.equal(parsed.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.ok(parsed.port); assert.equal(parsed.username, ""); assert.equal(parsed.password, "");
  const keys = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  process.env.PII_ACTIVE_KEY_ID = "match-cli"; process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ "match-cli": randomBytes(32).toString("base64") });
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const databaseName = `hub_om_shadow_match_${randomBytes(5).toString("hex")}`, namespace = "shadow_match_cli";
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 }); let connected = false, owns = false;
  try {
    await client.connect(); connected = true;
    assert.equal((await client.db("admin").admin().listDatabases({ nameOnly: true })).databases.some(item => item.name === databaseName), false);
    owns = true;
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoCoachOperationMatchRuntime(options);
    const store = new MongoOperationStore(options, MONGO_COACH_OPERATION_MATCH_RUNTIME_MODELS), now = new Date("2099-06-01T00:00:00.000Z");
    const company = coachFixtureRow("Company", { id: randomUUID(), name: "합성 회사", normalizedName: "합성 회사", createdAt: now, updatedAt: now });
    const course = coachFixtureRow("Course", { id: randomUUID(), companyId: company.id, processSeq: 7001, courseId: "SYN-7001", name: "합성 매칭 과정", createdAt: now, updatedAt: now });
    const operation = coachFixtureRow("OperationSession", { id: randomUUID(), operationId: "SYN-OP-7001", courseRecordId: course.id,
      startDate: now, endDate: now, educationDates: [now], deletedAt: null, createdAt: now, updatedAt: now });
    const coach = coachFixtureRow("Coach", { id: randomUUID(), sourceCoachId: "synthetic-coach-match", name: "합성 코치", normalizedName: "합성코치",
      status: "ACTIVE", isActive: true, createdAt: now, updatedAt: now, deletedAt: null });
    const engagement = coachFixtureRow("CoachEngagement", { id: randomUUID(), sourceEngagementId: "synthetic-engagement-match", coachId: coach.id,
      operationSessionId: null, courseName: "합성 매칭 과정", source: "SHEET", status: "SCHEDULED", startDate: now, endDate: now, createdAt: now });
    const schedule = coachFixtureRow("CoachEngagementSchedule", { id: randomUUID(), sourceEngagementScheduleId: "synthetic-schedule-match",
      engagementId: engagement.id, coachId: coach.id, date: now, startTime: "09:00", endTime: "10:00", cancelledAt: null });
    for (const [model, row] of [["Company", company], ["Course", course], ["OperationSession", operation], ["Coach", coach], ["CoachEngagement", engagement], ["CoachEngagementSchedule", schedule]] as const)
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row));
    const env = { MONGODB_URI: uri, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace };
    let loaded = 0; const before = await store.collection("CoachEngagement").findOne({ _id: engagement.id as string }); assert.ok(before);
    const diagnostic = await runCoachOperationMatchCli(["--backend=mongodb-shadow"], env, runCoachOperationDiagnoseCommand, () => { loaded++; });
    assert.deepEqual(diagnostic.counts, { total: 1, matched: 0, unmatched: 1 }); assert.equal(diagnostic.rows[0].bestOperation, "SYN-OP-7001");
    const dry = await runCoachOperationMatchCli(["--backend=mongodb-shadow"], env, runCoachOperationBackfillCommand, () => { loaded++; });
    assert.deepEqual(dry, { checked: 1, matched: 1, unmatched: 0, updated: 0, apply: false });
    const applied = await runCoachOperationMatchCli(["--apply", "--backend=mongodb-shadow"], env, runCoachOperationBackfillCommand, () => { loaded++; });
    assert.deepEqual(applied, { checked: 1, matched: 1, unmatched: 0, updated: 1, apply: true });
    const after = await store.collection("CoachEngagement").findOne({ _id: engagement.id as string }); assert.ok(after); assert.equal(after.operationSessionId, operation.id);
    for (const key of Object.keys(before)) if (key !== "operationSessionId") assert.deepEqual(after[key], before[key], `unchanged ${key}`);
    assert.doesNotMatch(JSON.stringify(after), /합성 코치|synthetic-engagement-match/);
    const replay = await runCoachOperationMatchCli(["--apply", "--backend=mongodb-shadow"], env, runCoachOperationBackfillCommand, () => { loaded++; });
    assert.deepEqual(replay, { checked: 0, matched: 0, unmatched: 0, updated: 0, apply: true }); assert.equal(loaded, 0);
    const partialNamespace = "shadow_match_partial", partial = client.db(databaseName).collection<{ _id: string; operationSessionId: null }>(`${partialNamespace}_CoachEngagement`);
    await partial.insertOne({ _id: "private-canary", operationSessionId: null });
    const partialBefore = { info: await client.db(databaseName).listCollections({ name: partial.collectionName }, { nameOnly: false }).next(),
      indexes: await partial.listIndexes().toArray(), documents: await partial.find({}).toArray() };
    await assert.rejects(runCoachOperationMatchCli(["--apply", "--backend=mongodb-shadow"], { ...env, MONGODB_SHADOW_NAMESPACE: partialNamespace }, runCoachOperationBackfillCommand, () => { loaded++; }), /^Error: COACH_OPERATION_MATCH_FAILED$/);
    assert.deepEqual({ info: await client.db(databaseName).listCollections({ name: partial.collectionName }, { nameOnly: false }).next(),
      indexes: await partial.listIndexes().toArray(), documents: await partial.find({}).toArray() }, partialBefore);
    assert.equal((await client.db(databaseName).listCollections({ name: new RegExp(`^${partialNamespace}_`) }).toArray()).length, 1);
    const native = await MongoCoachOperationMatchRepository.open(options), target = { engagementId: engagement.id as string, operationSessionId: operation.id as string };
    await store.collection("CoachEngagement").updateOne({ _id: engagement.id as string }, { $set: { operationSessionId: null } });
    await client.db(databaseName).collection(`${namespace}_CoachCatalogGuard`).deleteMany({});
    const originalUpdate = Collection.prototype.updateOne; let injectedAttempts = 0;
    const injected = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
      if (this.collectionName === `${namespace}_CoachCatalogGuard` && injectedAttempts++ === 0)
        throw new MongoServerError({ code: 11000, message: "synthetic-private-guard-collision" });
      return originalUpdate.apply(this, args);
    });
    try { assert.equal(await native.applyMatches([target]), 1); }
    finally { injected.mock.restore(); }
    assert.equal(injectedAttempts, 2);
    await store.collection("CoachEngagement").updateOne({ _id: engagement.id as string }, { $set: { operationSessionId: null } });
    await client.db(databaseName).collection(`${namespace}_CoachCatalogGuard`).deleteMany({});
    assert.deepEqual((await Promise.all([native.applyMatches([target]), native.applyMatches([target])])).sort(), [0, 1]);
    await store.collection("CoachEngagement").updateOne({ _id: engagement.id as string }, { $set: { operationSessionId: null } });
    const competingOperationId = randomUUID();
    await store.collection("CoachEngagement").updateOne({ _id: engagement.id as string }, { $set: { operationSessionId: competingOperationId } });
    assert.equal(await native.applyMatches([target]), 0);
    assert.equal((await store.collection("CoachEngagement").findOne({ _id: engagement.id as string }))?.operationSessionId, competingOperationId);
  } finally {
    try { if (connected && owns) await client.db(databaseName).dropDatabase(); }
    finally { if (connected) await client.close(); for (const key of keys) { const value = saved.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  }
});
