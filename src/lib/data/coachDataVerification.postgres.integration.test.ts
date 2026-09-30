import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { disconnectPrismaClient, getPrismaClient } from "./prisma";
import { PrismaCoachDataVerificationRepository } from "./prismaCoachDataVerificationRepository";
import { readCoachSourceCounts } from "./coachDataVerificationSource";

const url = process.env.POSTGRES_COACH_DATA_VERIFICATION_TEST_URL, sourceUrl = process.env.POSTGRES_COACH_DATA_VERIFICATION_SOURCE_TEST_URL;
test("coach data verification reads encrypted PostgreSQL and a read-only source", { skip: !url || !sourceUrl, timeout: 120_000 }, async () => {
  const targetParsed = new URL(url!), sourceParsed = new URL(sourceUrl!);
  for (const parsed of [targetParsed, sourceParsed]) { assert.equal(parsed.hostname, "127.0.0.1"); assert.ok(parsed.port); assert.equal(parsed.password, ""); }
  assert.equal(targetParsed.pathname, "/hub_om_coach_verify_test"); assert.equal(sourceParsed.pathname, "/coach_verify_source_test");
  const names = ["DATABASE_URL", "PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const saved = new Map(names.map(name => [name, process.env[name]])); Object.assign(process.env, { DATABASE_URL: url, PII_ACTIVE_KEY_ID: "verify-pg",
    PII_ENCRYPTION_KEYS: JSON.stringify({ "verify-pg": randomBytes(32).toString("base64") }), PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const raw = new pg.Client({ connectionString: url });
  try {
    await raw.connect(); await raw.query("TRUNCATE coaches, coach_import_runs, coachdb_archive_snapshots CASCADE"); const db = getPrismaClient();
    const first = await db.coach.create({ data: { sourceCoachId: "synthetic-verify-a", name: "Synthetic Verify A", normalizedName: "syntheticverifya", status: "ACTIVE", isActive: true } });
    await db.coach.create({ data: { sourceCoachId: "synthetic-verify-b", name: "Synthetic Verify B", normalizedName: "syntheticverifyb", status: "ACTIVE", isActive: true, deletedAt: new Date("2099-01-01") } });
    await db.coachPrivateProfile.create({ data: { coachId: first.id, email: "private-verify@example.invalid" } });
    const engagement = await db.coachEngagement.create({ data: { sourceEngagementId: "synthetic-verify-engagement", coachId: first.id, courseName: "Synthetic private course", startDate: new Date("2099-01-01"), endDate: new Date("2099-01-02") } });
    await db.coachSchedule.create({ data: { sourceScheduleId: "synthetic-verify-schedule", coachId: first.id, date: new Date("2099-01-01"), startTime: "09:00", endTime: "18:00" } });
    await db.coachEngagementSchedule.create({ data: { sourceEngagementScheduleId: "synthetic-verify-engagement-schedule", coachId: first.id, engagementId: engagement.id, date: new Date("2099-01-01"), startTime: "09:00", endTime: "18:00" } });
    const tiedAt = new Date("2099-02-01");
    await db.coachImportRun.createMany({ data: [
      { id: "00000000-0000-4000-8000-000000000001", mode: "lower", status: "COMPLETED", coachCount: 1, startedAt: tiedAt },
      { id: "00000000-0000-4000-8000-000000000002", mode: "higher", status: "COMPLETED", coachCount: 2, engagementCount: 1, scheduleCount: 1, startedAt: tiedAt },
    ] });
    await db.coachdbArchiveSnapshot.create({ data: { id: "00000000-0000-4000-8000-000000000011", sourceDatabase: "synthetic", status: "old-tie", startedAt: tiedAt } });
    const archive = await db.coachdbArchiveSnapshot.create({ data: { id: "00000000-0000-4000-8000-000000000012", sourceDatabase: "synthetic", status: "completed", tableCount: 1, rowCount: 2, startedAt: tiedAt } });
    await db.coachdbArchiveRow.createMany({ data: [
      { snapshotId: archive.id, tableSchema: "public", tableName: "coaches", rowKey: "a", rowData: {} },
      { snapshotId: archive.id, tableSchema: "public", tableName: "engagements", rowKey: "b", rowData: {} },
    ] });
    const report = await new PrismaCoachDataVerificationRepository(db).readReport();
    assert.deepEqual(Object.fromEntries(report.serviceCounts.map(row => [row.label, row.count])), { coaches_total: 2, coaches_visible: 1, coaches_deleted: 1,
      private_profiles: 1, engagements: 1, schedules: 1, engagement_schedules: 1, matched_engagements: 0, unmatched_engagements: 1 });
    assert.equal(report.latestImport?.mode, "higher"); assert.equal(report.latestArchive?.id, archive.id);
    assert.deepEqual(report.archiveCounts, [{ label: "coaches", count: 1 }, { label: "engagements", count: 1 }]);
    const stored = JSON.stringify((await raw.query("SELECT name, source_coach_id FROM coaches ORDER BY id")).rows); assert.doesNotMatch(stored, /Synthetic Verify|synthetic-verify/);
    assert.deepEqual(await readCoachSourceCounts(sourceUrl!), [{ label: "coaches", count: 2 }, { label: "engagements", count: 3 },
      { label: "coach_schedules", count: 4 }, { label: "engagement_schedules", count: 5 }]);
  } finally {
    try {
      await Promise.allSettled([
        disconnectPrismaClient(),
        (async () => { await raw.query("TRUNCATE coaches, coach_import_runs, coachdb_archive_snapshots CASCADE").catch(() => {}); await raw.end().catch(() => {}); })(),
      ]);
    } finally {
      for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  }
});
