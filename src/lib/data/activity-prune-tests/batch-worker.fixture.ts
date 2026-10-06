/** Actual original/current PG transaction; precision gate is separate from coarse CLI parity. */
import assert from 'node:assert/strict';
import pg from 'pg';
import type { PrismaClient, Prisma } from '@prisma/client';
import { endpoint, loader, ROOT } from './pg-store.fixture.ts';
import { id } from './shared.fixture.ts';
const backend = process.argv[2], mode = process.argv[3];
const violations: string[] = [];
let disconnected = false, socketsClosed = false;
let prisma: PrismaClient | undefined;
const clients = new Set<pg.Client>(), closed = new Set<pg.Client>(), signals: Promise<void>[] = [];
const connect = pg.Client.prototype.connect;
async function send(value: object) { await new Promise<void>((resolve, reject) => process.send!({ kind: 'prune-batch', ...value }, error => error ? reject(new Error('PRUNE_IPC_FAILED')) : resolve())); }
async function main() {
  const frozen = await loader(); const provenance = frozen.verifyBaseline(); await frozen.negativeControls();
  process.env.DATABASE_URL = endpoint(process.env.ACTIVITY_PRUNE_TEST_PG_URL);
  globalThis.fetch = async () => { violations.push('FETCH'); throw new Error('PRUNE_FETCH_FORBIDDEN'); };
  for (const key of ['log', 'warn', 'error', 'info', 'debug'] as const) console[key] = () => { violations.push('CONSOLE'); };
  pg.Client.prototype.connect = function (this: pg.Client, ...args: unknown[]) {
    const client = this as pg.Client & { connectionParameters: { host: string; port: number; database: string; user: string }; connection: { stream: { closed?: boolean; once(event: string, callback: () => void): void } } };
    const p = client.connectionParameters;
    if (p.host !== '127.0.0.1' || Number(p.port) !== 56758 || p.database !== 'activity_prune_test' || p.user !== 'synthetic') { violations.push('ENDPOINT_ESCAPE'); throw new Error('PRUNE_ENDPOINT_ESCAPE'); }
    clients.add(client);
    signals.push(new Promise<void>(resolve => { const done = () => { closed.add(client); resolve(); }; client.connection.stream.once('close', done); if (client.connection.stream.closed) done(); }));
    return Reflect.apply(connect, this, args);
  } as typeof connect;
  let result: unknown;
  try {
    const load = (path: string) => import(backend === 'original' ? frozen.originalURL(path) : new URL('../../../../' + path, import.meta.url).href);
    const getter = await load('src/lib/data/prisma.ts') as { getPrismaClient(): PrismaClient };
    const retention = await load('src/lib/activity/retention.ts') as { pruneActivityBatch(tx: Prisma.TransactionClient): Promise<{ requests: number; changes: number }> };
    prisma = getter.getPrismaClient();
    const directory = await prisma.$queryRawUnsafe<{ data_directory: string }[]>('SHOW data_directory');
    assert.equal(directory[0].data_directory, ROOT + '/pg');
    if (mode === 'once') result = await prisma.$transaction(retention.pruneActivityBatch, { timeout: 10000 });
    else {
      assert.equal(mode, 'boundary');
      result = await prisma.$transaction(async tx => {
        const clock = (await tx.$queryRaw<{ stamp: string; micros: string }[]>`SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS stamp,to_char(now(),'US') AS micros`)[0];
        const fractionalMilliseconds = Number(clock.micros) % 1000;
        for (const model of ['ActivityRequest', 'ActivityChange'] as const) {
          for (const [offset, n] of [[-1, 9901], [0, 9902], [1, 9903]] as const) {
            if (model === 'ActivityRequest') await tx.$executeRaw`INSERT INTO activity_requests(id,occurred_at,actor_type,route,method,status,duration_ms) VALUES(${id(model,n)}::uuid,date_trunc('milliseconds',now()-interval '30 days') + ${offset} * interval '1 millisecond','anonymous','/api/synthetic-prune','POST',200,0)`;
            else await tx.$executeRaw`INSERT INTO activity_changes(id,occurred_at,request_id,actor_type,route,method,target_type,target_id,action,changes) VALUES(${id(model,n)}::uuid,date_trunc('milliseconds',now()-interval '365 days') + ${offset} * interval '1 millisecond',${id('ActivityRequest',9901)}::uuid,'anonymous','/api/synthetic-prune','POST','synthetic','no-fk-parent','update','{}'::jsonb)`;
          }
        }
        const beforeRows = {
          ActivityRequest: await tx.$queryRaw<{ value: Record<string, unknown> }[]>`SELECT to_jsonb(t) AS value FROM activity_requests t ORDER BY id`,
          ActivityChange: await tx.$queryRaw<{ value: Record<string, unknown> }[]>`SELECT to_jsonb(t) AS value FROM activity_changes t ORDER BY id`
        };
        const pruned = await retention.pruneActivityBatch(tx);
        const expected = fractionalMilliseconds === 0 ? 1 : 2;
        assert.deepEqual(pruned, { requests: expected, changes: expected });
        for (const model of ['ActivityRequest', 'ActivityChange'] as const) {
          const table = model === 'ActivityRequest' ? 'activity_requests' : 'activity_changes';
          const remaining = await tx.$queryRawUnsafe<{ id: string; date: string }[]>(`SELECT id,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS date FROM ${table} ORDER BY id`);
          const raw = await tx.$queryRawUnsafe<{ value: Record<string, unknown> }[]>(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY id`);
          for (const row of raw) assert.deepEqual(row, beforeRows[model].find(before => before.value.id === row.value.id), 'PRUNE_BOUNDARY_RAW_CHANGED');
          assert.deepEqual(remaining.map(row => row.id), (fractionalMilliseconds === 0 ? [9902,9903] : [9903]).map(n => id(model,n)));
        }
        const after = (await tx.$queryRaw<{ stamp: string }[]>`SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS stamp`)[0];
        assert.equal(after.stamp, clock.stamp, 'PRUNE_TRANSACTION_NOW_CHANGED');
        return { ...pruned, serverNowMicroseconds: clock.stamp, fractionalMilliseconds, exactEqualityObserved: fractionalMilliseconds === 0 };
      }, { timeout: 10000 });
    }
  } finally {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await prisma?.$disconnect(); disconnected = true;
      await Promise.race([Promise.all(signals), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PRUNE_SOCKET_CLOSE_NOT_OBSERVED')), 3000); })]);
      socketsClosed = clients.size === closed.size;
    } finally { clearTimeout(timer); pg.Client.prototype.connect = connect; }
  }
  assert.deepEqual(violations, []); assert.ok(disconnected && socketsClosed);
  await send({ backend, mode, result, disconnected, socketsClosed, violations, provenance });
}
main().then(() => process.disconnect?.(), async () => { await send({ failure: 'PRUNE_BATCH_GATE_FAILED', disconnected, socketsClosed, violations }); process.exitCode = 1; process.disconnect?.(); });
