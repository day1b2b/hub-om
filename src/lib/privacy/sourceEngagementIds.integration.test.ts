import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { migratePersonalData, enforcePersonalData } from "../../../scripts/encrypt-personal-data";
import { activityContext } from "../activity/context";

// Disposable local database only: the test recreates its public schema from the checked-in migrations.
const url = process.env.PII_SOURCE_ID_TEST_DATABASE_URL;
const TARGET = "20260923090000_pii_source_engagement_ids";
const coachName = "가상소스코치", coachId = "00000000-0000-4000-8000-0000000000c1";
const legacyId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const legacySource = (n: number) => `contract-sheet:${n + 1}:${coachName}:2099-12-10:2099-12-11`;
const conflictSource = `contract-sheet:999:${coachName}:2099-01-01:2099-01-02`;

function contractRow(course: string) {
  const row = Array<string>(17).fill(""); row[3] = "TEST123-1"; row[4] = coachName; row[6] = "Synthetic Hiring"; row[5] = "실습코치"; row[7] = course; row[9] = "2099-12-10"; row[10] = "2099-12-11"; row[12] = "09:00~18:00"; return row;
}

test("name-bearing engagement source IDs: legacy plaintext, schema transition, partial backfill, retries, key mismatch and real sheet resync on PostgreSQL", { skip: !url, timeout: 240_000 }, async () => {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/pii_source_ids_test") throw new Error("Use the isolated pii_source_ids_test database on 127.0.0.1.");
  const saved = new Map(["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL"].map(name => [name, process.env[name]]));
  const keys = { enc: JSON.stringify({ source_fixture: randomBytes(32).toString("base64") }), index: randomBytes(32).toString("base64") };
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: keys.enc, PII_ACTIVE_KEY_ID: "source_fixture", PII_INDEX_KEY: keys.index, PII_ALLOW_PLAINTEXT_READS: "false", DATABASE_URL: url });
  const sql = new pg.Client({ connectionString: url });
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, options: "-c timezone=UTC" }) });
  let db: PrismaClient | undefined;
  await sql.connect();
  try {
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations");
    const migrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrations.at(-1), TARGET);
    for (const name of migrations.slice(0, -1)) await sql.query(readFileSync(path.join(root, name, "migration.sql"), "utf8"));

    // Legacy state: plaintext source IDs guarded only by the plaintext unique constraint.
    await sql.query("INSERT INTO coaches(id, source_coach_id, name, normalized_name, updated_at) VALUES ($1, 'synthetic:source-coach', $2, $2, now())", [coachId, coachName]);
    for (let n = 1; n <= 205; n++) await sql.query("INSERT INTO coach_engagements(id, source_engagement_id, coach_id, course_name, start_date, end_date) VALUES ($1, $2, $3, $4, '2099-12-10', '2099-12-11')", [legacyId(n), legacySource(n), coachId, `Synthetic Course ${n}`]);
    await sql.query("INSERT INTO coach_engagements(id, source_engagement_id, coach_id, course_name, start_date, end_date) VALUES ('ffffffff-0000-4000-8000-000000000001', $1, $2, 'Synthetic Conflict', '2099-01-01', '2099-01-02')", [conflictSource, coachId]);
    for (const [index, day] of ["2099-12-10", "2099-12-11"].entries()) await sql.query("INSERT INTO coach_engagement_schedules(id, source_engagement_schedule_id, engagement_id, coach_id, date, start_time, end_time) VALUES ($1, $2, $3, $4, $5, '09:00', '18:00')", [randomUUID(), `${legacySource(1)}:${index}:${day}`, legacyId(1), coachId, day]);
    await assert.rejects(sql.query("INSERT INTO coach_engagements(id, source_engagement_id, coach_id, course_name, start_date, end_date) VALUES ($1, $2, $3, 'dup', '2099-12-10', '2099-12-11')", [randomUUID(), legacySource(1), coachId]));

    // Backfill before the schema: the missing companion column aborts the batch and leaves source IDs untouched.
    await assert.rejects(migratePersonalData(raw, true), /source_engagement_id_pii_index/);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM coach_engagements WHERE source_engagement_id LIKE 'pii:v1:%'")).rows[0].n, 0);

    await sql.query(readFileSync(path.join(root, TARGET, "migration.sql"), "utf8"));
    const dry = await migratePersonalData(raw, false);
    assert.equal(dry.coach_engagements.plaintext, 206); assert.equal(dry.coach_engagement_schedules.plaintext, 2);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM coach_engagements WHERE source_engagement_id_pii_index IS NOT NULL")).rows[0].n, 0);

    const { getPrismaClient } = await import("../data/prisma");
    db = getPrismaClient();
    await assert.rejects(db.coachEngagement.findUniqueOrThrow({ where: { id: legacyId(1) } }), /Unencrypted personal data/);

    // Maintenance violation: during the mixed state neither the random ciphertext nor NULL HMAC blocks the same plaintext.
    const intruder = await db.coachEngagement.create({ data: { id: "ffffffff-0000-4000-8000-000000000002", sourceEngagementId: conflictSource, coachId, courseName: "Synthetic Intruder", startDate: new Date("2099-01-01"), endDate: new Date("2099-01-02") } });
    await assert.rejects(migratePersonalData(raw, true), /coach_engagements_source_engagement_id_pii_index_key|23505|unique/i);
    const partial = (await sql.query("SELECT id::text, source_engagement_id LIKE 'pii:v1:%' AS encrypted, source_engagement_id_pii_index IS NOT NULL AS indexed FROM coach_engagements ORDER BY id::text")).rows as Array<{ id: string; encrypted: boolean; indexed: boolean }>;
    assert.equal(partial.filter(row => row.encrypted && row.indexed).length, 201, "the committed first batch and the intruder are encrypted");
    assert.deepEqual(partial.filter(row => !row.encrypted).map(row => row.id), [...[201, 202, 203, 204, 205].map(legacyId), "ffffffff-0000-4000-8000-000000000001"]);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM coach_engagement_schedules WHERE source_engagement_schedule_id LIKE 'pii:v1:%'")).rows[0].n, 0);

    // Operators must review the collision; here the synthetic intruder is removed before the retry.
    await sql.query("DELETE FROM coach_engagements WHERE id = $1", [intruder.id]);
    const retry = await migratePersonalData(raw, true);
    assert.equal(retry.coach_engagements.encrypted, 200); assert.equal(retry.coach_engagements.plaintext, 6); assert.equal(retry.coach_engagement_schedules.plaintext, 2);
    const ciphertexts = (await sql.query("SELECT id::text, source_engagement_id, source_engagement_id_pii_index FROM coach_engagements ORDER BY id::text")).rows;
    const rerun = await migratePersonalData(raw, true);
    for (const table of ["coach_engagements", "coach_engagement_schedules"] as const) { assert.equal(rerun[table].plaintext, 0); assert.equal(rerun[table].invalidIndexes, 0); }
    assert.deepEqual((await sql.query("SELECT id::text, source_engagement_id, source_engagement_id_pii_index FROM coach_engagements ORDER BY id::text")).rows, ciphertexts);

    // Wrong keys fail closed without writes: a foreign encryption key cannot authenticate, a foreign HMAC key cannot enforce.
    process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ source_fixture: randomBytes(32).toString("base64") });
    await assert.rejects(migratePersonalData(raw, false));
    process.env.PII_ENCRYPTION_KEYS = keys.enc; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
    assert.ok((await migratePersonalData(raw, false)).coach_engagements.invalidIndexes > 0);
    await assert.rejects(enforcePersonalData(raw));
    process.env.PII_INDEX_KEY = keys.index;
    assert.deepEqual((await sql.query("SELECT id::text, source_engagement_id, source_engagement_id_pii_index FROM coach_engagements ORDER BY id::text")).rows, ciphertexts);

    await enforcePersonalData(raw);
    await assert.rejects(sql.query("INSERT INTO coach_engagements(id, source_engagement_id, coach_id, course_name, start_date, end_date) VALUES ($1, 'plain-after-enforce', $2, 'x', '2099-12-10', '2099-12-11')", [randomUUID(), coachId]), (error: { code?: string; constraint?: string }) => error.code === "23514" && error.constraint === "pii_encrypted_storage");

    // Application equality, uniqueness and the approved decrypted response value.
    const found = await db.coachEngagement.findUniqueOrThrow({ where: { sourceEngagementId: legacySource(7) } });
    assert.equal(found.id, legacyId(7)); assert.equal(found.sourceEngagementId, legacySource(7));
    assert.ok(!JSON.stringify(found).includes("PiiIndex"));
    assert.deepEqual((await db.coachEngagement.findMany({ where: { sourceEngagementId: { in: [legacySource(3), legacySource(4)] } }, select: { id: true }, orderBy: { id: "asc" } })).map(row => row.id), [legacyId(3), legacyId(4)]);
    await assert.rejects(db.coachEngagement.create({ data: { sourceEngagementId: legacySource(9), coachId, courseName: "dup", startDate: new Date("2099-12-10"), endDate: new Date("2099-12-11") } }), (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
    const slots = await db.coachEngagementSchedule.findMany({ where: { sourceEngagementScheduleId: `${legacySource(1)}:0:2099-12-10` } });
    assert.equal(slots.length, 1);

    // Real PostgreSQL sheet repository + workflow: the renamed course disables the overlap fallback, so only HMAC can match.
    const { PrismaCoachSheetSyncRepository } = await import("../data/prismaCoachSheetSyncRepository");
    const { runContractSheetSync } = await import("../coaches/coachSheetSyncWorkflow");
    const repository = new PrismaCoachSheetSyncRepository();
    const actor = { requestId: randomUUID(), actorEmail: "sheet-admin@example.test", actorName: "가상 관리자", actorType: "user" as const, route: "/api/sync/engagements", method: "POST" };
    const first = await activityContext.run(actor, () => runContractSheetSync({ values: [["header"], contractRow("Synthetic Sheet Course")], struckCells: new Set() }, repository, false));
    assert.equal(first.created, 0); assert.equal(first.updated, 1, "row 2 matches the backfilled legacy engagement by its source ID HMAC");
    const before = await sql.query("SELECT count(*)::int AS n FROM coach_engagements");
    const resync = await activityContext.run({ ...actor, requestId: randomUUID() }, () => runContractSheetSync({ values: [["header"], contractRow("Synthetic Renamed Course")], struckCells: new Set() }, repository, false));
    assert.equal(resync.created, 0); assert.equal(resync.updated, 1);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM coach_engagements")).rows[0].n, before.rows[0].n);
    const synced = await db.coachEngagement.findUniqueOrThrow({ where: { sourceEngagementId: legacySource(1) }, include: { schedules: true } });
    assert.equal(synced.id, legacyId(1)); assert.equal(synced.courseName, "Synthetic Renamed Course");
    assert.deepEqual(synced.schedules.map(slot => slot.sourceEngagementScheduleId).sort(), [`${legacySource(1)}:0:2099-12-10`, `${legacySource(1)}:1:2099-12-11`]);

    // Stored rows, companions and attributed activity diffs never carry the name-bearing plaintext.
    for (const table of ["coach_engagements", "coach_engagement_schedules", "activity_changes"]) {
      const stored = JSON.stringify((await sql.query(`SELECT * FROM ${table}`)).rows);
      assert.ok(!stored.includes(coachName), `${table} exposes the synthetic name`);
    }
    const audit = (await sql.query("SELECT changes FROM activity_changes WHERE target_type = 'coach_engagements' AND request_id = $1", [actor.requestId])).rows;
    assert.ok(audit.length > 0); assert.ok(audit.every(row => !row.changes.source_engagement_id || row.changes.source_engagement_id.redacted === true));
  } finally {
    try { await db?.$disconnect(); await raw.$disconnect(); await sql.end(); }
    finally { for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
  }
});
