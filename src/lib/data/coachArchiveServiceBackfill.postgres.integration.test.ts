import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { backfillCoachArchiveServiceData } from "./prismaCoachArchiveServiceBackfillRepository";
import { disconnectPrismaClient, getPrismaClient } from "./prisma";

const url = process.env.POSTGRES_COACH_ARCHIVE_SERVICE_BACKFILL_TEST_URL;
test("coach archive service backfill encrypts and reapplies on isolated PostgreSQL", { skip: !url, timeout: 120_000 }, async () => {
  const parsed = new URL(url!); assert.equal(parsed.hostname, "127.0.0.1"); assert.equal(parsed.pathname, "/hub_om_archive_service_test"); assert.ok(parsed.port); assert.equal(parsed.password, "");
  const names = ["DATABASE_URL", "PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: url, PII_ACTIVE_KEY_ID: "archive-pg", PII_ENCRYPTION_KEYS: JSON.stringify({ "archive-pg": randomBytes(32).toString("base64") }), PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: url }); let connected = false;
  const ids = { coach: randomUUID(), oldSnapshot: randomUUID(), latestSnapshot: randomUUID(), coachRow: randomUUID(), logRow: randomUUID() };
  try {
    await sql.connect(); connected = true;
    const empty = await sql.query("SELECT (SELECT count(*) FROM coaches) + (SELECT count(*) FROM coachdb_archive_snapshots) AS count"); assert.equal(Number(empty.rows[0].count), 0);
    const db = getPrismaClient(), sourceCoachId = "synthetic-pg-archive-service", now = new Date("2099-01-01T00:00:00Z");
    await db.coach.create({ data: { id: ids.coach, sourceCoachId, accessToken: "old-token", name: "Synthetic PG Archive Coach", normalizedName: "synthetic pg archive coach", statusNote: "old", status: "ACTIVE", isActive: true, createdAt: now, updatedAt: now } });
    await db.coachdbArchiveSnapshot.createMany({ data: [
      { id: ids.oldSnapshot, sourceDatabase: "synthetic", sourceSchema: "public", status: "completed", startedAt: new Date("2098-01-01T00:00:00Z") },
      { id: ids.latestSnapshot, sourceDatabase: "synthetic", sourceSchema: "public", status: "completed", startedAt: new Date("2099-01-01T00:00:00Z") },
    ] });
    const latest = { access_token: "new-token", status_note: "new status", return_date: "2099-02-03", self_note: "new self", portfolio_url: "https://example.invalid/private", availability_detail: "new availability", manager_note: "new manager", dx_tag: "new dx", deleted_by: "synthetic-admin@example.invalid" };
    await db.coachdbArchiveRow.createMany({ data: [
      { id: randomUUID(), snapshotId: ids.oldSnapshot, tableSchema: "public", tableName: "coaches", rowKey: sourceCoachId, rowData: { access_token: "older-token" } },
      { id: ids.coachRow, snapshotId: ids.latestSnapshot, tableSchema: "public", tableName: "coaches", rowKey: sourceCoachId, rowData: latest },
      { id: ids.logRow, snapshotId: ids.latestSnapshot, tableSchema: "public", tableName: "schedule_access_logs", rowKey: "synthetic-pg-access-log", rowData: { coach_id: sourceCoachId, year_month: "2099-02", accessed_at: "2099-02-04T01:02:03Z", last_edited_at: "2099-02-05T01:02:03Z" } },
    ] });
    const rawBefore = await sql.query("SELECT source_coach_id, status_note FROM coaches WHERE id = $1", [ids.coach]); assert.match(rawBefore.rows[0].source_coach_id, /^pii:v1:/); assert.doesNotMatch(JSON.stringify(rawBefore.rows[0]), /synthetic-pg-archive-service|old/);
    assert.deepEqual(await backfillCoachArchiveServiceData(db, { apply: false }), { coachRows: 1, changedCoaches: 1, accessLogRows: 1, updatedCoaches: 0, upsertedAccessLogs: 0 });
    assert.deepEqual(await backfillCoachArchiveServiceData(db, { apply: true }), { coachRows: 1, changedCoaches: 1, accessLogRows: 1, updatedCoaches: 1, upsertedAccessLogs: 1 });
    const coach = await db.coach.findUniqueOrThrow({ where: { id: ids.coach } }); assert.equal(coach.managerNote, "new manager"); assert.equal(coach.accessToken, "new-token"); assert.deepEqual(coach.returnDate, new Date("2099-02-03T00:00:00Z"));
    const rawAfter = await sql.query("SELECT access_token, manager_note, deleted_by FROM coaches WHERE id = $1", [ids.coach]);
    for (const field of ["access_token", "manager_note", "deleted_by"]) assert.match(rawAfter.rows[0][field], /^pii:v1:/);
    assert.doesNotMatch(JSON.stringify(rawAfter.rows[0]), /new-token|new manager|synthetic-admin/);
    assert.deepEqual(await backfillCoachArchiveServiceData(db, { apply: true }), { coachRows: 1, changedCoaches: 0, accessLogRows: 1, updatedCoaches: 0, upsertedAccessLogs: 1 });
    assert.equal(await db.coachScheduleAccessLog.count({ where: { coachId: ids.coach, yearMonth: "2099-02" } }), 1);
    const indexKey = process.env.PII_INDEX_KEY!;
    process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
    try { await assert.rejects(backfillCoachArchiveServiceData(db, { apply: false }), /index mismatch/i); }
    finally { process.env.PII_INDEX_KEY = indexKey; }
  } finally {
    await disconnectPrismaClient();
    if (connected) { await sql.query("DELETE FROM coach_schedule_access_logs WHERE coach_id = $1", [ids.coach]); await sql.query("DELETE FROM coaches WHERE id = $1", [ids.coach]); await sql.query("DELETE FROM coachdb_archive_snapshots WHERE id = ANY($1::uuid[])", [[ids.oldSnapshot, ids.latestSnapshot]]); await sql.end(); }
    for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
