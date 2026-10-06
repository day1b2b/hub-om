/** Parent execution only. Actual route/getter/guards/NextResponse/pg, no response or query stubs. */
import assert from 'node:assert/strict';
import pg from 'pg';
import { NextResponse } from 'next/server';
import { endpoint, expectedBody, type Backend, type Case, type Observation } from './baseline-contract.fixture.ts';

interface Loader {
  ROOT: string; verifyBaseline(): unknown; negativeControls(): Promise<void>; originalURL(path: string): string;
}
type PgObserved = pg.Client & { connectionParameters: { host: string; port: number; database: string; user: string }; connection?: { stream?: { closed?: boolean; once(name:string, fn:()=>void):void } } };
const backend = process.argv[2] as Backend, name = process.argv[3] as Case;
const observation: Observation = { connects: 0, queries: [], violations: [], disconnected: false,
  socketsClosed: false, nextResponse: false, dynamic: '', status: 0, headers: [], body: null };
const clients = new Set<PgObserved>();
const closed = new Set<PgObserved>();
const ended = new Set<PgObserved>();
const closeSignals = new Map<PgObserved, Promise<void>>();
let phase = 'bootstrap';
async function observeSocketClosure() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // This only bounds observation. It neither cancels IO nor substitutes for socket close.
    await Promise.race([
      Promise.all([...closeSignals.values()]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('HEALTH_SOCKET_CLOSE_NOT_OBSERVED')), 3000); })
    ]);
    observation.socketsClosed = [...clients].every(client => closed.has(client));
  } finally { clearTimeout(timer); }
}
async function send(value: unknown) {
  assert.ok(process.send, 'HEALTH_TEST_IPC_REQUIRED');
  await new Promise<void>((resolve,reject) => process.send!(value, error => error ? reject(new Error('HEALTH_TEST_IPC_FAILED')) : resolve()));
}
async function main() {
  assert.ok(backend === 'original' || backend === 'current');
  const loader = await import(new URL('../../../../scripts/test-health-baseline-loader.mjs', import.meta.url).href) as Loader;
  const evidence = loader.verifyBaseline(); await loader.negativeControls();
  const available = endpoint(process.env.HEALTH_TEST_PG_URL, 56754);
  const unavailable = endpoint(process.env.HEALTH_TEST_PG_UNAVAILABLE_URL, 56755);
  assert.equal(new URL(available).pathname, new URL(unavailable).pathname, 'HEALTH_ENDPOINT_DATABASE_MISMATCH');
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'DEV_AUTH_BYPASS']) assert.equal(process.env[key], undefined);
  for (const key of ['PII_ACTIVE_KEY_ID', 'PII_ENCRYPTION_KEYS', 'PII_INDEX_KEY']) assert.ok(process.env[key], 'CALLER_TEMPORARY_KEYS_REQUIRED');
  const selected = name === 'unavailable' ? unavailable : available;
  process.env.DATABASE_URL = selected;
  if (name.startsWith('invalid-key') || name.startsWith('scope')) process.env.PII_INDEX_KEY = 'SYNTHETIC_INVALID_KEY';
  globalThis.fetch = async () => { observation.violations.push('EXTERNAL_FETCH'); throw new Error('HEALTH_EXTERNAL_FETCH_FORBIDDEN'); };
  // Application console output is not part of the original health response contract.
  for (const method of ['log','error','warn','info','debug'] as const) console[method] = () => { observation.violations.push('APPLICATION_LOG_OUTPUT'); };

  // A separate ownership read is setup evidence, never counted as the actual health query.
  // Guard and unavailable cases do not open any setup connection.
  if (name === 'success') {
    phase = 'owned-pg-preflight';
    const setup = new pg.Client({ connectionString: available, connectionTimeoutMillis: 5000, query_timeout: 5000 });
    try {
      await setup.connect();
      const identity = (await setup.query('SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port')).rows;
      assert.deepEqual(identity, [{ db: 'health_test', usr: 'synthetic', port: 56754 }]);
      assert.equal((await setup.query('SHOW data_directory')).rows[0].data_directory, '/private/tmp/hub-om-health-20260930/pg');
    } finally { await setup.end(); }
  }

  const prototype = pg.Client.prototype, connect = prototype.connect, query = prototype.query;
  prototype.connect = function (this: pg.Client, ...args: unknown[]) {
    observation.connects++;
    const client = this as PgObserved, params = client.connectionParameters, url = new URL(selected);
    if (params.host !== '127.0.0.1' || Number(params.port) !== Number(url.port) || params.database !== url.pathname.slice(1) || params.user !== 'synthetic') {
      observation.violations.push('PG_ENDPOINT_ESCAPE'); throw new Error('HEALTH_PG_ENDPOINT_ESCAPE');
    }
    clients.add(client); client.once('end', () => ended.add(client));
    const stream = client.connection?.stream;
    if (!stream) { observation.violations.push('PG_STREAM_NOT_OBSERVABLE'); throw new Error('HEALTH_PG_STREAM_NOT_OBSERVABLE'); }
    closeSignals.set(client, new Promise<void>(resolve => {
      const markClosed = () => { closed.add(client); resolve(); };
      stream.once('close', markClosed);
      if (stream.closed === true) markClosed();
    }));
    return Reflect.apply(connect, this, args);
  } as typeof prototype.connect;
  prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const first = args[0], text = typeof first === 'string' ? first : (first as { text?: unknown })?.text;
    if (typeof text !== 'string' || text.trim() !== 'SELECT 1') {
      observation.violations.push('NON_HEALTH_QUERY'); throw new Error('HEALTH_NON_HEALTH_QUERY');
    }
    observation.queries.push(text.trim());
    return Reflect.apply(query, this, args);
  } as typeof prototype.query;
  try {
    phase = 'actual-route-import';
    const routePath = 'src/app/api/health/route.ts';
    const route = await import(backend === 'original' ? loader.originalURL(routePath) : new URL('../../../../' + routePath, import.meta.url).href) as { dynamic: string; GET(): Promise<Response> };
    assert.equal(observation.connects, 0, 'IMPORT_CONNECTED'); assert.deepEqual(observation.queries, [], 'IMPORT_QUERIED');
    phase = 'actual-route-call';
    let response: Response;
    if (name.startsWith('scope')) {
      const path = 'src/lib/data/dataRepositoryContext.ts';
      const context = await import(backend === 'original' ? loader.originalURL(path) : new URL('../../../../' + path, import.meta.url).href) as { runWithDataRepositories<T>(value: object, work: () => T): T };
      response = await context.runWithDataRepositories({}, () => route.GET());
    } else response = await route.GET();
    observation.nextResponse = response instanceof NextResponse;
    observation.dynamic = route.dynamic; observation.status = response.status;
    observation.headers = [...response.headers.entries()].sort(([a],[b]) => a.localeCompare(b));
    const body: unknown = await response.json();
    // Do not IPC unexpected raw errors. Compare privately before assigning a report field.
    assert.deepEqual(body, expectedBody(backend, name), 'HEALTH_HTTP_LITERAL');
    observation.body = body;
  } finally {
    phase = 'disconnect';
    try {
      const client = (globalThis as unknown as { prisma?: { $disconnect(): Promise<void> } }).prisma;
      await client?.$disconnect(); observation.disconnected = true;
      await observeSocketClosure();
    } finally { prototype.connect = connect; prototype.query = query; }
  }
  await send({ kind: 'health-observation', backend, name, observation, evidence,
    cleanup: { tracked: clients.size, endObserved: ended.size, streamCloseObserved: closed.size } });
}
main().then(() => process.disconnect?.(), async () => {
  // Never print driver Error.message/cause/stack, URI, response mismatch or original data URL.
  await send({ kind: 'health-worker-failure', code: 'HEALTH_BASELINE_CHECK_FAILED', backend, name, phase,
    disconnected: observation.disconnected, socketsClosed: observation.socketsClosed, violations: observation.violations,
    cleanup: { tracked: clients.size, endObserved: ended.size, streamCloseObserved: closed.size } });
  process.exitCode = 1; process.disconnect?.();
});
