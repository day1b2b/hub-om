import assert from 'node:assert/strict';
import pg from 'pg';
import { seedRows, type Rows, type Row, type SeedSpec } from './shared.fixture.ts';
export const ROOT = '/private/tmp/hub-om-activity-prune-20260930';
export function endpoint(value: string | undefined) {
  assert.ok(value, 'PRUNE_PG_URL_REQUIRED'); const url = new URL(value);
  assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '56758');
  assert.equal(url.username, 'synthetic'); assert.equal(url.password, ''); assert.equal(url.pathname, '/activity_prune_test');
  assert.equal(url.search, ''); assert.equal(url.hash, ''); return url.href;
}
export interface BaselineLoader { originalURL(path: string): string; verifyBaseline(): unknown; negativeControls(): Promise<void> }
export async function loader() { return await import(new URL('../../../../scripts/test-activity-prune-baseline-loader.mjs', import.meta.url).href) as BaselineLoader; }
export async function openOwnedStore() {
  const sql = new pg.Client({ connectionString: endpoint(process.env.ACTIVITY_PRUNE_TEST_PG_URL), connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    await sql.connect();
    assert.deepEqual((await sql.query('SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port')).rows, [{ db: 'activity_prune_test', usr: 'synthetic', port: 56758 }]);
    assert.equal((await sql.query('SHOW data_directory')).rows[0].data_directory, ROOT + '/pg');
    assert.equal((await sql.query('SELECT pg_try_advisory_lock(56758, 2001) AS acquired')).rows[0].acquired, true, 'PRUNE_OTHER_WORKER_ACTIVE');
    await assertEmpty(sql); return sql;
  } catch (error) { await sql.end(); throw error; }
}
export async function rawRows(sql: pg.Client): Promise<Rows> {
  const ActivityRequest = (await sql.query('SELECT to_jsonb(t) AS value FROM activity_requests t ORDER BY id')).rows.map(row => row.value as Row);
  const ActivityChange = (await sql.query('SELECT to_jsonb(t) AS value FROM activity_changes t ORDER BY id')).rows.map(row => row.value as Row);
  return { ActivityRequest, ActivityChange };
}
export async function assertEmpty(sql: pg.Client) {
  const rows = await rawRows(sql); assert.equal(rows.ActivityRequest.length, 0, 'PRUNE_REQUESTS_NOT_EMPTY'); assert.equal(rows.ActivityChange.length, 0, 'PRUNE_CHANGES_NOT_EMPTY');
}
export async function seed(sql: pg.Client, now: Date, spec: SeedSpec): Promise<Rows> {
  const frozen = await loader();
  const privacy = await import(frozen.originalURL('src/lib/privacy/fields.ts')) as { encryptField(model: string, field: string, value: unknown): unknown; indexField(model: string, field: string, value: unknown): string | null };
  const input = seedRows(now, spec);
  for (const model of ['ActivityRequest', 'ActivityChange'] as const) {
    const rows = input[model].map(row => ({
      id: row.id, occurred_at: row.occurredAt, actor_email: privacy.encryptField(model, 'actorEmail', row.actorEmail), actor_name: privacy.encryptField(model, 'actorName', row.actorName),
      actor_email_pii_index: privacy.indexField(model, 'actorEmail', row.actorEmail), actor_name_pii_index: privacy.indexField(model, 'actorName', row.actorName),
      actor_type: row.actorType, route: row.route, method: row.method,
      ...(model === 'ActivityRequest' ? { status: row.status, duration_ms: row.durationMs } : {
        request_id: row.requestId, target_type: row.targetType, target_id: row.targetId, action: row.action, changes: privacy.encryptField(model, 'changes', row.changes)
      })
    }));
    if (!rows.length) continue;
    const common = 'id uuid, occurred_at timestamptz, actor_email text, actor_name text, actor_email_pii_index text, actor_name_pii_index text, actor_type text, route text, method text';
    const specific = model === 'ActivityRequest' ? 'status integer, duration_ms integer' : 'request_id uuid, target_type text, target_id text, action text, changes jsonb';
    const table = model === 'ActivityRequest' ? 'activity_requests' : 'activity_changes';
    const columns = (common + ', ' + specific).split(', ').map(field => field.split(' ')[0]).join(', ');
    // Closed table/column literals only; every fixture value is a bound JSON parameter.
    await sql.query(`INSERT INTO ${table} (${columns}) SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(${common}, ${specific})`, [JSON.stringify(rows)]);
  }
  const raw = await rawRows(sql);
  for (const model of ['ActivityRequest', 'ActivityChange'] as const) {
    for (const row of raw[model]) {
      if (row.actor_email !== null) { assert.match(String(row.actor_email), /^pii:v1:/); assert.match(String(row.actor_name), /^pii:v1:/); assert.ok(row.actor_email_pii_index); }
    }
  }
  return raw;
}
export async function removeOwned(sql: pg.Client, owned: Rows) {
  await sql.query('DELETE FROM activity_changes WHERE id=ANY($1::uuid[])', [owned.ActivityChange.map(row => row.id)]);
  await sql.query('DELETE FROM activity_requests WHERE id=ANY($1::uuid[])', [owned.ActivityRequest.map(row => row.id)]);
  await assertEmpty(sql);
}
