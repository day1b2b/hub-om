import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { frozenBytes, migrationNames, verifyClosure } from "./frozen-loader.fixture.ts";

export const PG_URL = "postgresql://synthetic@127.0.0.1:56749/calendar_boundary_parity";
export const MONGO_URI = "mongodb://127.0.0.1:27849/?replicaSet=calendarboundary20260930";
export function configure() {
  verifyClosure();
  assert.equal(process.env.PG_CALENDAR_TEST_DATABASE_URL, PG_URL);
  assert.equal(process.env.MONGODB_CALENDAR_TEST_URI, MONGO_URI);
  for (const key of ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "GOOGLE_CAL_OAUTH_REFRESH_TOKEN"])
    assert.equal(process.env[key], undefined, `refuse inherited ${key}`);
  Object.assign(process.env, { TZ: "UTC", DATABASE_URL: PG_URL, PII_ACTIVE_KEY_ID: "oracle",
    PII_ENCRYPTION_KEYS: JSON.stringify({ oracle: randomBytes(32).toString("base64") }), PII_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ALLOW_PLAINTEXT_READS: "false", GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-client", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-secret",
    GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-refresh", GOOGLE_CAL_PART_CALENDARS: "1파트:synthetic@example.invalid" });
  globalThis.fetch = async () => { throw new Error("ORACLE_EXTERNAL_FETCH_FORBIDDEN"); };
}
export async function ownPg() {
  const sql = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
  await sql.connect();
  let owned = false;
  try {
    assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr")).rows, [{ db: "calendar_boundary_parity", usr: "synthetic" }]);
    assert.equal((await sql.query("SHOW data_directory")).rows[0].data_directory, "/private/tmp/hub-om-calendar-boundary-20260930/pg");
    // Never silently share public with another worker. Parent runs these children sequentially.
    assert.equal((await sql.query("SELECT pg_try_advisory_lock(8238647961::bigint) AS owned")).rows[0].owned, true);
    const rows = await sql.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    assert.equal(rows.rowCount, 0, "refuse populated PG public schema"); owned = true;
    for (const name of migrationNames()) await sql.query(frozenBytes(name).toString());
    const trigger = await sql.query("SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='calendar_event_links' AND t.tgname='activity_change'");
    assert.equal(trigger.rowCount, 1); assert.match(trigger.rows[0].def, /operation_id/); assert.match(trigger.rows[0].def, /event_date/);
    return { sql, close: async () => { try { await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); } finally { await sql.end(); } } };
  } catch (error) {
    try { if (owned) await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); } finally { await sql.end(); }
    throw error;
  }
}
export async function send(value: unknown) {
  if (!process.send) throw new Error("oracle worker requires parent IPC");
  await new Promise<void>((resolve, reject) => process.send!(value, error => error ? reject(error) : resolve()));
}
