import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { MongoClient } from "mongodb";
import { disconnectPrismaClient, getPrismaClient } from "./prisma";
import { PrismaCoachDataVerificationRepository } from "./prismaCoachDataVerificationRepository";
import { COACH_DATA_VERIFICATION_MODELS, MongoCoachDataVerificationRepository, prepareMongoCoachDataVerificationStore } from "./mongoCoachDataVerificationRepository";
import { MongoOperationStore } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const pgUrl = process.env.POSTGRES_COACH_DATA_VERIFICATION_PARITY_TEST_URL, mongoUri = process.env.MONGODB_COACH_DATA_VERIFICATION_TEST_URI;
const ids = { coach: "10000000-0000-4000-8000-000000000001", deleted: "10000000-0000-4000-8000-000000000002",
  engagement: "20000000-0000-4000-8000-000000000001", schedule: "30000000-0000-4000-8000-000000000001",
  engagementSchedule: "40000000-0000-4000-8000-000000000001", importLow: "50000000-0000-4000-8000-000000000001",
  importHigh: "50000000-0000-4000-8000-000000000002", archiveLow: "60000000-0000-4000-8000-000000000001",
  archiveHigh: "60000000-0000-4000-8000-000000000002" };
test("coach data verification returns identical reports on PostgreSQL and Mongo", { skip: !pgUrl || !mongoUri, timeout: 120_000 }, async () => {
  const parsed = new URL(pgUrl!); assert.equal(parsed.hostname, "127.0.0.1"); assert.equal(parsed.pathname, "/hub_om_coach_verify_parity_test"); assert.equal(parsed.password, "");
  const mongoParsed = new URL(mongoUri!); assert.equal(mongoParsed.hostname, "127.0.0.1"); assert.equal(mongoParsed.username, "");
  const names = ["DATABASE_URL", "PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const saved = new Map(names.map(name => [name, process.env[name]])); Object.assign(process.env, { DATABASE_URL: pgUrl, PII_ACTIVE_KEY_ID: "verify-parity",
    PII_ENCRYPTION_KEYS: JSON.stringify({ "verify-parity": randomBytes(32).toString("base64") }), PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: pgUrl }), client = new MongoClient(mongoUri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  const databaseName = `hub_om_shadow_verify_parity_${randomBytes(5).toString("hex")}`, namespace = `shadow_verify_parity_${randomBytes(5).toString("hex")}`;
  const at = new Date("2099-05-01T00:00:00.000Z"), finishedAt = new Date("2099-05-02T00:00:00.000Z");
  try {
    await sql.connect(); await sql.query("TRUNCATE coaches, coach_import_runs, coachdb_archive_snapshots CASCADE"); await client.connect(); const db = getPrismaClient();
    await db.coach.createMany({ data: [
      { id: ids.coach, sourceCoachId: "parity-coach", name: "Parity Coach", normalizedName: "paritycoach", status: "ACTIVE", isActive: true },
      { id: ids.deleted, sourceCoachId: "parity-deleted", name: "Parity Deleted", normalizedName: "paritydeleted", status: "ACTIVE", isActive: true, deletedAt: at },
    ] });
    await db.coachPrivateProfile.create({ data: { coachId: ids.coach, email: "parity@example.invalid" } });
    await db.coachEngagement.create({ data: { id: ids.engagement, sourceEngagementId: "parity-engagement", coachId: ids.coach, courseName: "Parity Course", startDate: at, endDate: at } });
    await db.coachSchedule.create({ data: { id: ids.schedule, sourceScheduleId: "parity-schedule", coachId: ids.coach, date: at, startTime: "09:00", endTime: "18:00" } });
    await db.coachEngagementSchedule.create({ data: { id: ids.engagementSchedule, sourceEngagementScheduleId: "parity-engagement-schedule", engagementId: ids.engagement, coachId: ids.coach, date: at, startTime: "09:00", endTime: "18:00" } });
    await db.coachImportRun.createMany({ data: [
      { id: ids.importLow, mode: "low", status: "COMPLETED", startedAt: at },
      { id: ids.importHigh, mode: "high", status: "COMPLETED", coachCount: 2, engagementCount: 1, scheduleCount: 1, startedAt: at, finishedAt },
    ] });
    await db.coachdbArchiveSnapshot.createMany({ data: [
      { id: ids.archiveLow, sourceDatabase: "parity", status: "low", startedAt: at },
      { id: ids.archiveHigh, sourceDatabase: "parity", status: "high", tableCount: 2, rowCount: 2, startedAt: at, finishedAt },
    ] });
    await db.coachdbArchiveRow.createMany({ data: [
      { snapshotId: ids.archiveHigh, tableSchema: "public", tableName: "coaches", rowKey: "coach", rowData: {} },
      { snapshotId: ids.archiveHigh, tableSchema: "public", tableName: "engagements", rowKey: "engagement", rowData: {} },
    ] });
    const options = { client, databaseName, namespace, allowShadowWrites: true as const }; await prepareMongoCoachDataVerificationStore(options);
    const store = new MongoOperationStore(options, COACH_DATA_VERIFICATION_MODELS);
    const add = async (model: string, row: Record<string, unknown>) => store.collection(model).insertOne(encodeMongoRuntimeDocument(model, coachFixtureRow(model, row)));
    await add("Coach", { id: ids.coach, sourceCoachId: "parity-coach", name: "Parity Coach", normalizedName: "paritycoach", status: "ACTIVE", isActive: true, deletedAt: null });
    await add("Coach", { id: ids.deleted, sourceCoachId: "parity-deleted", name: "Parity Deleted", normalizedName: "paritydeleted", status: "ACTIVE", isActive: true, deletedAt: at });
    await add("CoachPrivateProfile", { coachId: ids.coach, email: "parity@example.invalid" });
    await add("CoachEngagement", { id: ids.engagement, sourceEngagementId: "parity-engagement", coachId: ids.coach, courseName: "Parity Course", startDate: at, endDate: at, operationSessionId: null });
    await add("CoachSchedule", { id: ids.schedule, sourceScheduleId: "parity-schedule", coachId: ids.coach, date: at, startTime: "09:00", endTime: "18:00" });
    await add("CoachEngagementSchedule", { id: ids.engagementSchedule, sourceEngagementScheduleId: "parity-engagement-schedule", engagementId: ids.engagement, coachId: ids.coach, date: at, startTime: "09:00", endTime: "18:00" });
    await add("CoachImportRun", { id: ids.importLow, mode: "low", status: "COMPLETED", startedAt: at });
    await add("CoachImportRun", { id: ids.importHigh, mode: "high", status: "COMPLETED", coachCount: 2, engagementCount: 1, scheduleCount: 1, startedAt: at, finishedAt });
    await add("CoachdbArchiveSnapshot", { id: ids.archiveLow, sourceDatabase: "parity", status: "low", startedAt: at });
    await add("CoachdbArchiveSnapshot", { id: ids.archiveHigh, sourceDatabase: "parity", status: "high", tableCount: 2, rowCount: 2, startedAt: at, finishedAt });
    await add("CoachdbArchiveRow", { snapshotId: ids.archiveHigh, tableSchema: "public", tableName: "coaches", rowKey: "coach", rowData: {} });
    await add("CoachdbArchiveRow", { snapshotId: ids.archiveHigh, tableSchema: "public", tableName: "engagements", rowKey: "engagement", rowData: {} });
    const pgReport = await new PrismaCoachDataVerificationRepository(db).readReport();
    const mongoReport = await (await MongoCoachDataVerificationRepository.open(options)).readReport(); assert.deepEqual(mongoReport, pgReport);
  } finally {
    try {
      await Promise.allSettled([
        disconnectPrismaClient(),
        (async () => { await sql.query("TRUNCATE coaches, coach_import_runs, coachdb_archive_snapshots CASCADE").catch(() => {}); await sql.end().catch(() => {}); })(),
        (async () => { await client.db(databaseName).dropDatabase().catch(() => {}); await client.close().catch(() => {}); })(),
      ]);
    } finally {
      for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  }
});
