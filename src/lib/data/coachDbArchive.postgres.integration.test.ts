import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { disconnectPrismaClient, getPrismaClient } from "./prisma";
import { readCoachDbArchiveSource } from "./coachDbArchiveSource";
import { PrismaCoachDbArchiveRepository } from "./prismaCoachDbArchiveRepository";
const targetUrl = process.env.POSTGRES_COACH_DB_ARCHIVE_TARGET_TEST_URL, sourceUrl = process.env.POSTGRES_COACH_DB_ARCHIVE_SOURCE_TEST_URL;
test("coach db archive encrypts PostgreSQL snapshots from a read-only source", { skip: !targetUrl || !sourceUrl, timeout: 120_000 }, async () => {
  const target = new URL(targetUrl!), source = new URL(sourceUrl!); assert.equal(target.hostname, "127.0.0.1"); assert.equal(source.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/hub_om_coach_archive_target_test"); assert.equal(source.pathname, "/coach_archive_source_test"); assert.equal(target.password, ""); assert.equal(source.password, "");
  const names = ["DATABASE_URL", "PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const, saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: targetUrl, PII_ACTIVE_KEY_ID: "archive-pg", PII_ENCRYPTION_KEYS: JSON.stringify({ "archive-pg": randomBytes(32).toString("base64") }), PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const raw = new pg.Client({ connectionString: targetUrl });
  try {
    await raw.connect(); await raw.query("TRUNCATE coachdb_archive_snapshots CASCADE"); const input = await readCoachDbArchiveSource(sourceUrl!, true); assert.equal(input.sourceDatabase, "configured-postgresql-source"); assert.equal(input.tables.length, 2);
    const repository = new PrismaCoachDbArchiveRepository(); await repository.archive(input, false); assert.equal((await raw.query("SELECT count(*) FROM coachdb_archive_snapshots")).rows[0].count, "0");
    await repository.archive(input, true); await repository.archive(input, true); const db = getPrismaClient(); assert.equal(await db.coachdbArchiveSnapshot.count({ where: { status: "completed" } }), 2);
    const decryptedRows = await db.coachdbArchiveRow.findMany({ orderBy: { tableName: "asc" } }); assert.equal(decryptedRows.length, 4); assert.ok(decryptedRows.some(row => row.rowKey === "source-a" && JSON.stringify(row.rowData).includes("Synthetic Private Name")));
    const stored = JSON.stringify((await raw.query("SELECT row_key, row_data, row_key_pii_index FROM coachdb_archive_rows")).rows); assert.doesNotMatch(stored, /source-a|Synthetic Private Name|010-0000/); assert.match(stored, /row_key_pii_index/);
    const failureRows = Array.from({ length: 250 }, (_, index) => ({ rowKey: `late-${index}`, rowData: { index } })); failureRows.push(failureRows[0]);
    const duplicate = { ...input, tables: [{ schema: "public", name: "late_failure", rows: failureRows, rowCount: failureRows.length }] };
    const storedState = async () => JSON.stringify(await Promise.all([
      raw.query("SELECT * FROM coachdb_archive_snapshots ORDER BY id").then(result => result.rows),
      raw.query("SELECT * FROM coachdb_archive_rows ORDER BY id").then(result => result.rows),
    ]));
    const before = await storedState();
    await assert.rejects(() => repository.archive(duplicate, true));
    const after = await storedState(); assert.equal(after, before);
  } finally { try { const cleanup = await Promise.allSettled([disconnectPrismaClient(), (async()=>{try { await raw.query("TRUNCATE coachdb_archive_snapshots CASCADE"); } finally { await raw.end(); }})()]);
      for (const result of cleanup) if (result.status === "rejected") throw result.reason; }
    finally { for (const name of names) { const value=saved.get(name); if(value===undefined) delete process.env[name]; else process.env[name]=value; } } }
});
