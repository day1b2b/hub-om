/** Parent-only actual PG execution. No query, guard, privacy or response substitutions. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { Prisma, type PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { ADMIN, SECRET, MODEL_KEYS, TABLES, JSON_NULL_RUN_ID, seedRows, checkBody, comparatorNegatives, uuid, type Model, type Row, type FixtureCase } from './shared.fixture.ts';
import { endpoint } from './runner-contract.fixture.ts';

interface Loader { originalURL(path: string): string; verifyBaseline(): unknown; negativeControls(): Promise<void> }
type PgObserved = pg.Client & { connectionParameters: { host: string; port: number; database: string; user: string }; connection?: { stream?: { closed?: boolean; once(event: string, fn: () => void): void } } };
type Delegate = { create(input: { data: Row }): Promise<unknown> };
const backend = process.argv[2];
let phase = 'bootstrap', failurePhase: string | undefined, failureCode: string | undefined, owned = false, cleanupComplete = false, socketsClosed = false;
const violations: string[] = [], ledger: Row[] = [];
const auditIds = new Set<string>(), cleanupAuditIds = new Set<string>();
const auditSnapshots = new Map<string, unknown>();
let requestContext: { getStore(): { requestId: string } | undefined } | undefined;
const closes: Promise<void>[] = [], closed = new Set<pg.Client>(), clients = new Set<pg.Client>();
const proto = pg.Client.prototype, realConnect = proto.connect, realQuery = proto.query;
let sql: pg.Client | undefined, prisma: PrismaClient | undefined;
let routeReads: string[] = [], authCalls = 0;
const models = Object.keys(MODEL_KEYS) as Model[];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function send(value: unknown) {
  assert.ok(process.send, 'BACKUP_IPC_REQUIRED');
  await new Promise<void>((resolve, reject) => process.send!(value, error => error ? reject(new Error('BACKUP_IPC_FAILED')) : resolve()));
}
async function rawState() {
  const state: Record<string, unknown[]> = {};
  for (const model of models) {
    // Table names come only from the closed literal mapping; no source input interpolation.
    state[model] = (await sql!.query(`SELECT to_jsonb(t) AS value FROM "${TABLES[model]}" t ORDER BY to_jsonb(t)::text`)).rows.map(row => row.value);
  }
  return state;
}
async function ensureEmpty() {
  const raw = await rawState();
  assert.ok(Object.values(raw).every(rows => rows.length === 0), 'BACKUP_OWNED_TARGET_NOT_EMPTY');
  for (const table of ['activity_requests', 'activity_changes']) assert.equal((await sql!.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, 'BACKUP_OWNED_AUDIT_NOT_EMPTY');
}
async function seed() {
  phase = 'seed';
  const data = seedRows('rich');
  for (const model of models) {
    const delegate = Reflect.get(prisma!, model[0].toLowerCase() + model.slice(1)) as Delegate;
    for (const row of data[model]) {
      const input = { ...row };
      if (model === 'CoachImportRun' && input.summary === null) input.summary = input.id === JSON_NULL_RUN_ID ? Prisma.JsonNull : Prisma.DbNull;
      await delegate.create({ data: input });
    }
  }
  // Verify physical encryption/null semantics using raw PG JSON, not a new repository decoder.
  const physical = await rawState();
  const coach = (physical.Coach as Row[]).find(row => row.id === uuid(1))!;
  assert.match(String(coach.name), /^pii:v1:/); assert.match(String(coach.source_coach_id), /^pii:v1:/);
  assert.match(String(coach.access_token), /^pii:v1:/); assert.equal(coach.return_date, null);
  assert.match(String(coach.return_date_encrypted), /^pii:v1:/); assert.ok(coach.name_pii_index);
  const profile = (physical.CoachPrivateProfile as Row[]).find(row => row.coach_id === uuid(1))!;
  assert.equal(profile.birth_date, null); assert.match(String(profile.birth_date_encrypted), /^pii:v1:/);
  assert.match(String(profile.email), /^pii:v1:/); assert.ok(profile.email_pii_index);
  for (const [model, column, index] of [['CoachEngagement', 'source_engagement_id', 'source_engagement_id_pii_index'], ['CoachEngagementSchedule', 'source_engagement_schedule_id', 'source_engagement_schedule_id_pii_index']] as const) {
    for (const row of physical[model] as Row[]) { assert.match(String(row[column]), /^pii:v1:/); assert.ok(row[index]); }
  }
  const runs = physical.CoachImportRun as Row[];
  assert.equal(runs.find(row => row.id === uuid(91))!.summary, null, 'BACKUP_DBNULL_RAW');
  // Privacy layer encrypts JsonNull into an envelope; it is NOT a SQL NULL or plaintext JSON null.
  for (const id of [uuid(92), uuid(93), uuid(94)]) assert.match(String((runs.find(row => row.id === id)!.summary as Row).__pii), /^pii:v1:/);
  assert.equal((await sql!.query('SELECT count(*)::int AS n FROM activity_changes')).rows[0].n, 0, 'BACKUP_SEED_HAS_NO_REQUEST_CONTEXT');
}
interface AuthCase { label: string; header?: string; email?: string; admin?: string; secret?: string; success: boolean; calls: number }
async function request(route: { POST(input: Request): Promise<Response> }, kind: FixtureCase, config: AuthCase) {
  phase = 'before-request';
  process.env.ADMIN_EMAILS = config.admin ?? ADMIN;
  if (config.secret === '') delete process.env.BACKUP_API_SECRET;
  else process.env.BACKUP_API_SECRET = config.secret ?? SECRET;
  authCalls = 0;
  (globalThis as unknown as { __adminBackupSession: () => unknown }).__adminBackupSession = () => {
    authCalls++;
    return config.email ? { user: { email: config.email, name: 'Synthetic Backup Actor' }, expires: '2099-01-01T00:00:00.000Z' } : null;
  };
  const beforeState = await rawState();
  const changesBefore = (await sql!.query('SELECT to_jsonb(t) AS value FROM activity_changes t ORDER BY id')).rows;
  const before = Date.now();
  routeReads = [];
  phase = 'route';
  let response: Response | undefined, caught: unknown;
  try { response = await route.POST(new Request('http://synthetic.invalid/api/admin/backup', { method: 'POST', headers: config.header ? { authorization: config.header } : {} })); }
  catch (error) { caught = error; }
  finally { phase = 'after-request'; }
  const after = Date.now();
  assert.deepEqual(violations, [], 'BACKUP_OBSERVER_VIOLATIONS');
  assert.equal(authCalls, config.calls, 'BACKUP_REAL_GUARD_AUTH_CALLS');
  let responseId: string | null = null, bodyHash: string | null = null;
  if (config.success) {
    assert.equal(caught, undefined, 'BACKUP_UNEXPECTED_ROUTE_REJECTION');
    assert.ok(response instanceof NextResponse, 'BACKUP_REAL_NEXT_RESPONSE');
    assert.equal(response.status, 200);
    responseId = response.headers.get('x-request-id'); assert.match(responseId ?? '', /^[0-9a-f-]{36}$/);
    assert.deepEqual([...response.headers.keys()].sort(), ['content-disposition', 'content-type', 'x-request-id']);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    const dates = new Set([new Date(before).toISOString().slice(0, 10), new Date(after).toISOString().slice(0, 10)]);
    const disposition = response.headers.get('content-disposition')!;
    assert.ok([...dates].some(date => disposition === `attachment; filename="hub_om_coach_backup_${date}.json"`), 'BACKUP_ATTACHMENT_LITERAL');
    const body: unknown = await response.json(); checkBody(body, kind, before, after);
    bodyHash = hash((body as { data: unknown }).data);
    for (const table of Object.values(TABLES)) assert.ok(routeReads.includes(table), 'BACKUP_EACH_MODEL_ACTUALLY_READ');
  } else {
    assert.equal(response, undefined);
    assert.ok(caught instanceof Error);
    assert.equal(caught.message, '코치 개인정보 열람 권한이 없습니다. (ADMIN_EMAILS 설정 및 admin 계정 필요)');
    assert.deepEqual(routeReads, [], 'BACKUP_AUTH_DENIED_DATA_READ_ZERO');
  }
  // The actual wrapper has awaited audit completion before its promise settles.
  const audits = await prisma!.activityRequest.findMany();
  assert.equal(audits.length, auditIds.size + 1, 'BACKUP_AUDIT_WHOLE_ID_COUNT');
  assert.equal(new Set(audits.map(row => row.id)).size, audits.length);
  for (const id of auditIds) assert.deepEqual(audits.find(row => row.id === id), auditSnapshots.get(id), 'BACKUP_PRIOR_AUDIT_WHOLE_ROW');
  const fresh = audits.filter(row => !auditIds.has(row.id)); assert.equal(fresh.length, 1);
  const audit = fresh[0];
  if (responseId) assert.equal(audit.id, responseId);
  auditIds.add(audit.id); cleanupAuditIds.add(audit.id);
  const { id, occurredAt, durationMs, ...stable } = audit;
  assert.match(id, /^[0-9a-f-]{36}$/); assert.ok(occurredAt instanceof Date);
  assert.ok(occurredAt.getTime() >= before - 1000 && occurredAt.getTime() <= after + 1000, 'BACKUP_AUDIT_DB_CLOCK_BOUND');
  assert.ok(Number.isInteger(durationMs) && durationMs >= 0 && durationMs <= after - before + 1000);
  const user = !config.header && config.email?.toLowerCase().endsWith('@day1company.co.kr');
  assert.deepEqual(stable, {
    actorEmail: user ? config.email!.toLowerCase() : null, actorName: user ? 'Synthetic Backup Actor' : null,
    actorType: config.header ? 'token_request' : user ? 'user' : 'anonymous',
    route: '/api/admin/backup', method: 'POST', status: config.success ? 200 : 500
  });
  auditSnapshots.set(id, structuredClone(audit));
  const rawAudit = (await sql!.query('SELECT to_jsonb(t) AS value FROM activity_requests t WHERE id=$1', [id])).rows[0].value as Row;
  if (user) { assert.match(String(rawAudit.actor_email), /^pii:v1:/); assert.match(String(rawAudit.actor_name), /^pii:v1:/); assert.ok(rawAudit.actor_email_pii_index); }
  else { assert.equal(rawAudit.actor_email, null); assert.equal(rawAudit.actor_name, null); }
  assert.deepEqual(await rawState(), beforeState, 'BACKUP_BUSINESS_RAW_IMMUTABLE');
  assert.deepEqual((await sql!.query('SELECT to_jsonb(t) AS value FROM activity_changes t ORDER BY id')).rows, changesBefore, 'BACKUP_NO_BUSINESS_AUDIT');
  ledger.push({ kind, label: config.label, status: config.success ? 200 : 'guard-rejection', authCalls,
    readModels: new Set(routeReads).size, auditCount: auditIds.size, rawUnchanged: true, bodyHash });
}
async function cleanup() {
  phase = 'cleanup';
  try {
    if (owned && sql) {
      // Delete only literal owned identities. Unknown leftovers stay visible and fail cleanup.
      const seeds = seedRows('rich');
      for (const model of [...models].reverse()) {
        const table = TABLES[model];
        for (const row of seeds[model]) {
          if (model === 'CoachField' || model === 'CoachCurriculum') await sql.query(`DELETE FROM "${table}" WHERE coach_id=$1 AND tag_id=$2`, [row.coachId, row.tagId]);
          else await sql.query(`DELETE FROM "${table}" WHERE "${model === 'CoachPrivateProfile' ? 'coach_id' : 'id'}"=$1`, [row.id ?? row.coachId]);
        }
      }
      for (const id of cleanupAuditIds) await sql.query('DELETE FROM activity_requests WHERE id=$1', [id]);
      await ensureEmpty(); cleanupComplete = true;
    }
  } finally {
    // Neither cleanup SQL failure nor assertion failure may skip either connection owner.
    try { await prisma?.$disconnect(); }
    finally { await sql?.end(); }
  }
}
async function main() {
  assert.ok(backend === 'original' || backend === 'current');
  const loader = await import(new URL('../../../../scripts/test-admin-backup-baseline-loader.mjs', import.meta.url).href) as Loader;
  const provenance = loader.verifyBaseline(); await loader.negativeControls(); comparatorNegatives();
  const url = endpoint(process.env.ADMIN_BACKUP_TEST_PG_URL);
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'DEV_AUTH_BYPASS']) assert.equal(process.env[key], undefined);
  for (const key of ['PII_ACTIVE_KEY_ID', 'PII_ENCRYPTION_KEYS', 'PII_INDEX_KEY']) assert.ok(process.env[key], 'BACKUP_EPHEMERAL_KEYS_REQUIRED');
  process.env.DATABASE_URL = url;
  globalThis.fetch = async () => { violations.push('EXTERNAL_FETCH'); throw new Error('BACKUP_EXTERNAL_FETCH_FORBIDDEN'); };
  for (const name of ['log', 'warn', 'info', 'error', 'debug'] as const) console[name] = () => { violations.push('APPLICATION_LOG_OUTPUT'); };
  proto.connect = function (this: pg.Client, ...args: unknown[]) {
    const client = this as PgObserved, p = client.connectionParameters;
    if (p.host !== '127.0.0.1' || Number(p.port) !== 56756 || p.database !== 'admin_backup_test' || p.user !== 'synthetic') {
      violations.push('PG_ENDPOINT_ESCAPE'); throw new Error('BACKUP_PG_ENDPOINT_ESCAPE');
    }
    clients.add(client);
    const stream = client.connection?.stream;
    assert.ok(stream, 'BACKUP_SOCKET_NOT_OBSERVABLE');
    closes.push(new Promise<void>(resolve => { const done = () => { closed.add(client); resolve(); }; stream.once('close', done); if (stream.closed) done(); }));
    return Reflect.apply(realConnect, this, args);
  } as typeof proto.connect;
  proto.query = function (this: pg.Client, ...args: unknown[]) {
    const first = args[0], query = typeof first === 'string' ? first : (first as { text?: string })?.text;
    if (phase === 'route') {
      const requestId = requestContext?.getStore()?.requestId;
      if (requestId) cleanupAuditIds.add(requestId);
      if (typeof query !== 'string') { violations.push('UNOBSERVABLE_SQL'); throw new Error('BACKUP_SQL_NOT_OBSERVABLE'); }
      const allowedTables = new Set<string>([...Object.values(TABLES), 'activity_requests', 'activity_changes']);
      for (const match of query.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:"?public"?\.)?"?([a-z_][a-z_0-9]*)"?/gi)) {
        if (!allowedTables.has(match[1].toLowerCase())) { violations.push('OUTSIDE_SCOPE_TABLE'); throw new Error('BACKUP_OUTSIDE_SCOPE_TABLE'); }
      }
      if (/\b(?:TRUNCATE|ALTER|DROP|CREATE)\b/i.test(query)) { violations.push('ROUTE_DDL'); throw new Error('BACKUP_ROUTE_DDL_FORBIDDEN'); }
      for (const table of Object.values(TABLES)) {
        if (new RegExp(`\\b${table}\\b`).test(query)) {
          if (/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i.test(query)) { violations.push('BUSINESS_WRITE'); throw new Error('BACKUP_BUSINESS_WRITE_FORBIDDEN'); }
          routeReads.push(table);
        }
      }
      if (/\bcoachdb_archive_rows\b/.test(query)) { violations.push('ARCHIVE_PAYLOAD_READ'); throw new Error('BACKUP_ARCHIVE_PAYLOAD_FORBIDDEN'); }
    }
    return Reflect.apply(realQuery, this, args);
  } as typeof proto.query;
  try {
    phase = 'ownership';
    sql = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 5000 }); await sql.connect();
    assert.deepEqual((await sql.query('SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port')).rows, [{ db: 'admin_backup_test', usr: 'synthetic', port: 56756 }]);
    assert.equal((await sql.query('SHOW data_directory')).rows[0].data_directory, '/private/tmp/hub-om-admin-backup-20260930/pg');
    assert.equal((await sql.query('SELECT pg_try_advisory_lock(56756, 1201) AS acquired')).rows[0].acquired, true, 'BACKUP_WORKER_ALREADY_ACTIVE');
    await ensureEmpty(); owned = true;
    const load = (path: string) => import(backend === 'original' ? loader.originalURL(path) : new URL('../../../../' + path, import.meta.url).href);
    requestContext = (await load('src/lib/activity/context.ts') as { activityContext: NonNullable<typeof requestContext> }).activityContext;
    const getter = await load('src/lib/data/prisma.ts') as { getPrismaClient(): PrismaClient };
    prisma = getter.getPrismaClient();
    const route = await load('src/app/api/admin/backup/route.ts') as { dynamic: string; POST(input: Request): Promise<Response> };
    assert.equal(route.dynamic, 'force-dynamic');
    await request(route, 'empty', { label: 'empty-secret', header: `Bearer ${SECRET}`, success: true, calls: 0 });
    await seed();
    await request(route, 'rich', { label: 'rich-secret', header: `Bearer ${SECRET}`, success: true, calls: 0 });
    await request(route, 'rich', { label: 'rich-admin', email: ADMIN, secret: '', success: true, calls: 2 });
    await request(route, 'rich', { label: 'wrong-secret-admin', header: 'Bearer synthetic-wrong', email: ADMIN, success: true, calls: 1 });
    await request(route, 'rich', { label: 'anonymous-denied', success: false, calls: 2 });
    await request(route, 'rich', { label: 'workspace-nonadmin-denied', email: 'synthetic-other@day1company.co.kr', success: false, calls: 2 });
    await request(route, 'rich', { label: 'admin-unconfigured-denied', email: ADMIN, admin: '', success: false, calls: 2 });
    await request(route, 'rich', { label: 'external-configured-denied', email: 'synthetic@example.invalid', admin: 'synthetic@example.invalid', success: false, calls: 2 });
    await request(route, 'rich', { label: 'wrong-secret-denied', header: 'Bearer synthetic-wrong', success: false, calls: 1 });
    // Unselected metadata corruption must not invoke the full privacy decoder.
    phase = 'fixture-mutation';
    await sql.query('UPDATE coachdb_archive_snapshots SET error_message=$1 WHERE id=$2', ['pii:v1:synthetic-invalid-envelope', uuid(221)]);
    await request(route, 'rich', { label: 'unselected-corruption', header: `Bearer ${SECRET}`, success: true, calls: 0 });
    await sql.query('UPDATE coachdb_archive_snapshots SET started_at=$1 WHERE id=ANY($2::uuid[])', ['2026-09-03T00:00:00.000Z', [uuid(200), uuid(201), uuid(202)]]);
    await request(route, 'ties', { label: 'boundary-ties', header: `Bearer ${SECRET}`, success: true, calls: 0 });
    assert.deepEqual(violations, []);
  } catch (error) {
    failurePhase = phase;
    // Assertion diagnostics are hashed; never emit their actual/expected values or driver error.
    failureCode = error instanceof Error ? hash({ name: error.name, message: error.message }) : 'NON_ERROR';
    throw error;
  } finally {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await cleanup(); }
    finally {
      try {
        await Promise.race([Promise.all(closes), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('BACKUP_SOCKET_CLOSE_NOT_OBSERVED')), 3000); })]);
        socketsClosed = closed.size === clients.size;
      } finally { clearTimeout(timer); proto.connect = realConnect; proto.query = realQuery; }
    }
  }
  assert.ok(cleanupComplete && socketsClosed);
  await send({ kind: 'backup-result', backend, timezone: process.env.TZ, ledger, violations, cleanupComplete, socketsClosed, provenance });
}
main().then(() => process.disconnect?.(), async () => {
  await send({ kind: 'backup-failure', code: 'BACKUP_BASELINE_CHECK_FAILED', backend, phase: failurePhase ?? phase, failureCode, violations, cleanupComplete, socketsClosed, completedCases: ledger.length });
  process.exitCode = 1; process.disconnect?.();
});
