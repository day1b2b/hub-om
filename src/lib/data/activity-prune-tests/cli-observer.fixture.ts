/** Preloaded observer for the actual script entry. All normal SQL delegates to the real driver. */
import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { endpoint, loader, ROOT } from './pg-store.fixture.ts';
const frozen = await loader();
const provenance = frozen.verifyBaseline(); await frozen.negativeControls();
const selected = endpoint(process.env.ACTIVITY_PRUNE_TEST_PG_URL);
assert.ok(process.cwd().startsWith(ROOT + '/cli-'), 'PRUNE_SYNTHETIC_CWD_REQUIRED');
assert.equal(process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === selected, true);
const violations: string[] = [], events: string[] = [], envReads: string[] = [];
let batch = 0, faultTriggered = false, queryCount = 0;
const clocks: { batch: number; model: string; now: string; transaction: string; pid: number }[] = [];
const clients = new Set<pg.Client>(), closed = new Set<pg.Client>();
const closeSignals: Promise<void>[] = [];
function send(data: object) {
  assert.ok(process.send, 'PRUNE_CLI_IPC_REQUIRED');
  return new Promise<void>((resolve, reject) => process.send!({ kind: 'prune-observer', ...data }, error => error ? reject(new Error('PRUNE_IPC_FAILED')) : resolve()));
}
function state() { return { events: [...events], violations: [...violations], envReads: [...envReads], batch, queryCount, faultTriggered, clocks: [...clocks], sockets: clients.size, closed: closed.size }; }
await send({ type: 'provenance', provenance });
globalThis.fetch = async () => { violations.push('EXTERNAL_FETCH'); throw new Error('PRUNE_EXTERNAL_FETCH_FORBIDDEN'); };
const read = fs.readFileSync;
fs.readFileSync = function (...args: unknown[]) {
  const target = String(args[0]);
  if (path.basename(target) === '.env.local' || path.basename(target) === '.env') {
    const resolved = path.resolve(target);
    if (resolved !== path.join(process.cwd(), '.env.local') && resolved !== path.join(process.cwd(), '.env')) { violations.push('ENV_ESCAPE'); throw new Error('PRUNE_ENV_ESCAPE'); }
    envReads.push(path.basename(target));
  }
  return Reflect.apply(read, fs, args);
} as typeof fs.readFileSync;
const log = console.log;
console.log = (...args: unknown[]) => {
  if (args.length === 1 && typeof args[0] === 'string' && args[0].startsWith('{')) events.push('summary');
  Reflect.apply(log, console, args);
};
type ClientObserved = pg.Client & { connectionParameters: { host: string; port: number; database: string; user: string }; connection?: { stream?: { closed?: boolean; once(event: string, callback: () => void): void } } };
const connect = pg.Client.prototype.connect, query = pg.Client.prototype.query, end = pg.Pool.prototype.end;
pg.Client.prototype.connect = function (this: pg.Client, ...args: unknown[]) {
  const client = this as ClientObserved, params = client.connectionParameters;
  if (params.host !== '127.0.0.1' || Number(params.port) !== 56758 || params.database !== 'activity_prune_test' || params.user !== 'synthetic') { violations.push('PG_ENDPOINT_ESCAPE'); throw new Error('PRUNE_PG_ENDPOINT_ESCAPE'); }
  clients.add(client); const stream = client.connection?.stream; assert.ok(stream, 'PRUNE_SOCKET_UNOBSERVABLE');
  closeSignals.push(new Promise<void>(resolve => { const close = () => { closed.add(client); resolve(); }; stream.once('close', close); if (stream.closed) close(); }));
  return Reflect.apply(connect, this, args);
} as typeof pg.Client.prototype.connect;
pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
  const execute = async () => {
    queryCount++;
    const first = args[0], text = typeof first === 'string' ? first : (first as { text?: string })?.text;
    if (typeof text !== 'string') { violations.push('UNOBSERVABLE_SQL'); throw new Error('PRUNE_SQL_UNOBSERVABLE'); }
    if (/\b(?:INSERT|UPDATE|TRUNCATE|ALTER|CREATE|DROP)\b/i.test(text)) { violations.push('UNEXPECTED_WRITE'); throw new Error('PRUNE_UNEXPECTED_WRITE'); }
    for (const match of text.matchAll(/\b(?:FROM|JOIN)\s+(?:"?public"?\.)?"?([a-z_][a-z_0-9]*)"?/gi)) {
      if (!['activity_requests', 'activity_changes'].includes(match[1].toLowerCase())) { violations.push('OTHER_TABLE'); throw new Error('PRUNE_OTHER_TABLE'); }
    }
    const deletion = /^\s*DELETE\s+FROM\s+"?(activity_requests|activity_changes)"?\b/i.exec(text);
    if (deletion) {
      const model = deletion[1]; if (model === 'activity_requests') batch++;
      // Diagnostic SQL on the SAME client/transaction; original DELETE text/parameters remain unchanged.
      const clock = await Reflect.apply(query, this, ["SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS now, txid_current()::text AS transaction, pg_backend_pid() AS pid"]) as pg.QueryResult;
      clocks.push({ batch, model, ...clock.rows[0] });
      if (model === 'activity_changes' && process.env.PRUNE_TEST_FAULT === `batch${batch}`) {
        faultTriggered = true; events.push('injected-real-pg-error'); await send({ type: 'state', ...state() });
        // Labelled SQL-fault injection: real PG cast error aborts the actual transaction after first DELETE.
        return Reflect.apply(query, this, ["SELECT CAST('SYNTHETIC_PRUNE_FAULT' AS integer)"]);
      }
    }
    const result = await Reflect.apply(query, this, args) as pg.QueryResult;
    if (deletion) events.push(`deleted:${deletion[1]}:${result.rowCount}`);
    if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(text)) events.push(text.trim().split(/\s/)[0].toLowerCase());
    await send({ type: 'state', ...state() });
    return result;
  };
  return execute();
} as typeof pg.Client.prototype.query;
pg.Pool.prototype.end = function (this: pg.Pool, ...args: unknown[]) {
  const close = async () => {
    events.push('close-called'); await send({ type: 'state', ...state() });
    await Reflect.apply(end, this, args);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.all(closeSignals), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PRUNE_SOCKET_CLOSE_NOT_OBSERVED')), 3000); })]); }
    finally { clearTimeout(timer); }
    events.push('close-complete'); await send({ type: 'state', ...state() });
    if (process.env.PRUNE_TEST_FAULT === 'close') {
      faultTriggered = true; events.push('injected-post-close-error'); await send({ type: 'state', ...state() });
      throw new Error('SYNTHETIC_PRUNE_CLOSE_FAULT');
    }
  };
  return close();
} as typeof pg.Pool.prototype.end;
process.once('beforeExit', () => {
  void send({ type: 'final', ...state() }).then(() => process.disconnect?.());
});
