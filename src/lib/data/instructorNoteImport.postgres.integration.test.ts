import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { disconnectPrismaClient, getPrismaClient } from "./prisma";
import { PrismaInstructorNoteImportRepository } from "./prismaInstructorNoteImportRepository";

const url = process.env.POSTGRES_INSTRUCTOR_NOTE_IMPORT_TEST_URL;
test("instructor note import is encrypted, atomic and repeatable on isolated PostgreSQL", { skip: !url, timeout: 120_000 }, async () => {
  const parsed = new URL(url!); assert.equal(parsed.hostname, "127.0.0.1"); assert.equal(parsed.pathname, "/hub_om_note_import_test"); assert.ok(parsed.port); assert.equal(parsed.password, "");
  const names = ["DATABASE_URL", "PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const, saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: url, PII_ACTIVE_KEY_ID: "notes-pg", PII_ENCRYPTION_KEYS: JSON.stringify({ "notes-pg": randomBytes(32).toString("base64") }), PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: url }); let connected = false;
  try {
    await sql.connect(); connected = true; const db = getPrismaClient(), repository = new PrismaInstructorNoteImportRepository(db);
    const numbered = await db.instructorNote.create({ data: { instructorName: "Synthetic PG A", notionNo: 5, displayName: "Keep display", notes: "Old A" } });
    const legacy = await db.instructorNote.create({ data: { instructorName: "Synthetic PG A", notionNo: null, displayName: "Legacy display", notes: "Legacy A" } });
    const second = await db.instructorNote.create({ data: { instructorName: "Synthetic PG B", partnerId: "Keep partner", notes: "Old B" } });
    const entries = [
      { name: "Synthetic PG A", note: { notionNo: 5, instructorName: "Synthetic PG A", displayName: "", notes: "Redacted PG A", notion: { syncedAt: "2026-10-01T00:00:00.000Z", memo: "Safe PG memo" } } },
      { name: "Synthetic PG A", note: { notionNo: 6, instructorName: "Synthetic PG A", notes: "Distinct PG same-name row" } },
      { name: "Synthetic PG B", note: { partnerId: "", recruitAvoid: true, notes: "Redacted PG B" } },
      { name: "Synthetic PG C", note: { displayName: "Display PG C", notes: "Redacted PG C" } },
    ];
    assert.deepEqual(await repository.importNotes(entries, false), { total: 4, inserted: 2, updated: 2 }); assert.equal(await db.instructorNote.count(), 3);
    await sql.query("CREATE FUNCTION synthetic_note_import_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private late failure'; END $$");
    await sql.query(`CREATE TRIGGER synthetic_note_import_fail BEFORE UPDATE ON instructor_notes FOR EACH ROW WHEN (OLD.id = '${second.id}'::uuid) EXECUTE FUNCTION synthetic_note_import_fail()`);
    try { await assert.rejects(repository.importNotes(entries, true), error => !String(error).includes("private")); }
    finally { await sql.query("DROP TRIGGER synthetic_note_import_fail ON instructor_notes"); await sql.query("DROP FUNCTION synthetic_note_import_fail()") }
    assert.equal((await db.instructorNote.findUniqueOrThrow({ where: { id: numbered.id } })).notes, "Old A"); assert.equal(await db.instructorNote.count(), 3);
    assert.deepEqual(await repository.importNotes(entries, true), { total: 4, inserted: 2, updated: 2 });
    const a = await db.instructorNote.findUniqueOrThrow({ where: { id: numbered.id } }), untouched = await db.instructorNote.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.equal(a.displayName, "Keep display"); assert.equal(a.notes, "Redacted PG A"); assert.equal(untouched.notes, "Legacy A");
    const b = await db.instructorNote.findUniqueOrThrow({ where: { id: second.id } }); assert.equal(b.partnerId, "Keep partner"); assert.equal(b.recruitAvoid, true); assert.equal(b.notes, "Redacted PG B");
    assert.equal((await db.instructorNote.findFirstOrThrow({ where: { instructorName: "Synthetic PG C" } })).displayName, "Display PG C");
    assert.equal((await db.instructorNote.findUniqueOrThrow({ where: { notionNo: 6 } })).notes, "Distinct PG same-name row");
    const raw = JSON.stringify((await sql.query("SELECT instructor_name, display_name, partner_id, notes, notion_profile FROM instructor_notes ORDER BY id")).rows);
    for (const plaintext of ["Synthetic PG A", "Redacted PG A", "Safe PG memo", "Keep partner", "Display PG C"]) assert.equal(raw.includes(plaintext), false);
    assert.deepEqual(await repository.importNotes(entries, true), { total: 4, inserted: 0, updated: 4 });
  } finally { await disconnectPrismaClient(); if (connected) await sql.end(); for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
