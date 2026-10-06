import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import type { CreateOperationInput } from "./operationTypes";

const pgUrl = process.env.TEST_POSTGRES_URL, mongoUri = process.env.MONGODB_RUNTIME_TEST_URI;
function input(suffix: string): CreateOperationInput { return { companyName: "Synthetic company", courseName: `Synthetic course ${suffix}`, courseId: `SYN-SAT-${suffix}`, startDate: "2099-02-03", endDate: "2099-02-03", educationDates: ["2099-02-03"], archiveStatus: "아카이빙전", operationStatus: "배정필요", operationType: "단기", educationFormat: "오프라인", onsiteRequired: "N", revenue: null, totalCost: null, instructorCost: null, operationCost: null, coach: "", companyWikiLink: "", costRaw: "", driveLink: "", educationDays: "1", instructorWikiLink: "", instructors: "Synthetic instructor", ld: "", lectureManagementLink: "", om: "Synthetic owner", operationDetail: "Synthetic satisfaction", operationIssue: "", padletLink: "", region: "", resultReportLink: "", roundNo: "1", specialNotes: "", timeText: "09:00-10:00", createdBy: "synthetic@example.invalid" }; }

test("satisfaction dry-run reads encrypted PostgreSQL and native Mongo without writes", { skip: !pgUrl || !mongoUri, timeout: 180_000 }, async () => {
  const pg = new URL(pgUrl!), mongo = new URL(mongoUri!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(pg.hostname)); assert.ok(pg.port);
  assert.equal(mongo.protocol, "mongodb:"); assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(mongo.hostname)); assert.ok(mongo.port); assert.equal(mongo.username, ""); assert.equal(mongo.password, "");
  const names = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: pgUrl, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ satisfaction_fixture: Buffer.alloc(32, 7).toString("base64") }), PII_ACTIVE_KEY_ID: "satisfaction_fixture", PII_INDEX_KEY: Buffer.alloc(32, 11).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const client = new MongoClient(mongoUri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  const databaseName = `hub_om_shadow_satisfaction_${randomBytes(12).toString("hex")}`, namespace = `shadow_satisfaction_${randomBytes(8).toString("hex")}`;
  const suffix = randomBytes(6).toString("hex"), fixtureCsv = `record_id,courseId,client,course,date,instructor,n,overall,pos_pct\nsynthetic-row,SYN-SAT-${suffix},Synthetic company,Synthetic course ${suffix},2099-02-03,Synthetic instructor,10,4.5,90\n`;
  try {
    const [{ PrismaOperationRepository }, { getPrismaClient, disconnectPrismaClient }, { runSatisfactionDryRunCommand }, { MongoOperationRepository }, { prepareMongoOperationStore, MongoOperationStore }, { openMongoSatisfactionDryRunRuntime }] = await Promise.all([
      import("./prismaOperationRepository"), import("./prisma"), import("./satisfactionDryRunCommand"), import("./mongoOperationRepository"), import("./mongoOperationStore"), import("./mongoSatisfactionDryRunRuntime")
    ]);
    const pgRepository = new PrismaOperationRepository(); await pgRepository.createOperation(input(suffix));
    const db = getPrismaClient(), pgBefore = { operations: await db.operationSession.count(), changes: await db.activityChange.count() };
    const pgResult = await runSatisfactionDryRunCommand(["--csv=synthetic.csv"], () => {}, { readSource: async () => fixtureCsv, getDefaultRepository: () => pgRepository, closeDefaultRepository: async () => {} });
    assert.deepEqual(pgResult.stats, { total: 1, matched: 1, ambiguous: 0, unmatched: 0 });
    assert.deepEqual({ operations: await db.operationSession.count(), changes: await db.activityChange.count() }, pgBefore);
    await client.connect(); const options = { client, databaseName, namespace };
    await prepareMongoOperationStore({ ...options, allowShadowWrites: true, processSequenceHighWater: 0 });
    const mongoRepository = await MongoOperationRepository.open(options); await mongoRepository.createOperation(input(suffix));
    const store = new MongoOperationStore(options), before = await snapshot(store);
    const runtime = await openMongoSatisfactionDryRunRuntime(options);
    const mongoResult = await runtime.run(() => runSatisfactionDryRunCommand(["--csv=synthetic.csv"], () => { throw new Error("unexpected env load"); }, { readSource: async () => fixtureCsv, getDefaultRepository: () => { throw new Error("unexpected pg fallback"); }, closeDefaultRepository: async () => { throw new Error("unexpected close"); } }));
    assert.deepEqual(mongoResult.stats, pgResult.stats); assert.ok(mongoResult.results[0].operationId); assert.ok(pgResult.results[0].operationId);
    assert.deepEqual(await snapshot(store), before);
    await disconnectPrismaClient();
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

async function snapshot(store: import("./mongoOperationStore").MongoOperationStore) {
  const collections = await store.db.listCollections({}, { nameOnly: true }).toArray(), result: Record<string, unknown> = {};
  for (const item of collections.sort((a, b) => a.name.localeCompare(b.name))) result[item.name] = await store.db.collection(item.name).find({}).sort({ _id: 1 }).toArray();
  return result;
}
