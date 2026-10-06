/** Narrow PG original/current oracle. Carver's scope/native fixtures live separately. */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CASES, endpoint, comparatorNegatives, checkObservation, type Backend, type Case, type Observation } from './baseline-contract.fixture.ts';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
async function run(t: TestContext, backend: Backend, name: Case) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C', TZ: 'UTC',
    NODE_ENV: name.endsWith('development') ? 'development' : 'production',
    HEALTH_TEST_PG_URL: endpoint(process.env.HEALTH_TEST_PG_URL, 56754),
    HEALTH_TEST_PG_UNAVAILABLE_URL: endpoint(process.env.HEALTH_TEST_PG_UNAVAILABLE_URL, 56755),
    PII_ACTIVE_KEY_ID: process.env.PII_ACTIVE_KEY_ID, PII_ENCRYPTION_KEYS: process.env.PII_ENCRYPTION_KEYS,
    PII_INDEX_KEY: process.env.PII_INDEX_KEY, PII_ALLOW_PLAINTEXT_READS: 'false' };
  const worker = fork(new URL('./baseline-worker.fixture.ts', import.meta.url), [backend, name], {
    cwd: root, env, execArgv: ['--experimental-strip-types', '--experimental-loader', root + 'scripts/ts-loader.mjs',
      '--import', root + 'scripts/test-health-baseline-loader.mjs'], stdio: ['ignore','pipe','pipe','ipc']
  });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  type Cleanup = { tracked: number; endObserved: number; streamCloseObserved: number };
  let report: { observation: Observation; evidence: unknown; cleanup?: Cleanup } | undefined, failed = false;
  worker.stdout!.on('data', data => stdout.push(Buffer.from(data))); worker.stderr!.on('data', data => stderr.push(Buffer.from(data)));
  worker.on('message', (value: unknown) => {
    const message = value as { kind: string; observation: Observation; evidence: unknown; code?: string; phase?: string; cleanup?: Cleanup; disconnected?: boolean; socketsClosed?: boolean };
    if (message.kind === 'health-observation') { if (report) failed = true; report = message; }
    else { failed = true; t.diagnostic(JSON.stringify({ kind: 'health-worker-failure', backend, name, code: 'HEALTH_BASELINE_CHECK_FAILED', phase: message.phase,
      disconnected: message.disconnected, socketsClosed: message.socketsClosed, cleanup: message.cleanup })); }
  });
  const exit = await new Promise<number | null>((resolve,reject) => {
    let expired = false, kill: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => { expired = true; worker.kill('SIGTERM'); kill = setTimeout(() => worker.kill('SIGKILL'), 5000); }, 20000);
    worker.once('error', () => { if (worker.pid === undefined) { clearTimeout(timer); reject(new Error('HEALTH_WORKER_SPAWN_FAILED')); } });
    worker.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(kill);
      if (expired || signal) reject(new Error('HEALTH_WORKER_OBSERVED_TERMINATION_STOP_RESOURCE_AUDIT_REQUIRED'));
      else resolve(code);
    });
  });
  const err = Buffer.concat(stderr);
  // Content stays in memory. No raw stderr or original source URL is printed on failure.
  const encryptionKeys = Object.values(JSON.parse(env.PII_ENCRYPTION_KEYS ?? '{}') as Record<string,string>);
  for (const secret of [env.HEALTH_TEST_PG_URL, env.HEALTH_TEST_PG_UNAVAILABLE_URL, env.PII_ENCRYPTION_KEYS, env.PII_INDEX_KEY, ...encryptionKeys])
    if (secret) assert.ok(!err.includes(secret), 'HEALTH_PRIVATE_STDERR');
  assert.equal(Buffer.concat(stdout).length, 0, 'HEALTH_UNEXPECTED_STDOUT');
  t.diagnostic(JSON.stringify({ backend, name, exit, stderrBytes: err.length, stderrSha256: createHash('sha256').update(err).digest('hex') }));
  if (report) {
    const value = report.observation;
    t.diagnostic(JSON.stringify({ kind: 'health-safe-observation', backend, name, status: value.status,
      connects: value.connects, queryCount: value.queries.length, selectOneCount: value.queries.filter(q => q === 'SELECT 1').length,
      violationCount: value.violations.length, nextResponse: value.nextResponse, forceDynamic: value.dynamic === 'force-dynamic',
      disconnected: value.disconnected, socketsClosed: value.socketsClosed, cleanup: report.cleanup,
      jsonHeadersExact: JSON.stringify(value.headers) === JSON.stringify([['content-type', 'application/json']]),
      bodySha256: createHash('sha256').update(JSON.stringify(value.body)).digest('hex') }));
  }
  assert.equal(exit, 0); assert.equal(failed, false); assert.ok(report);
  checkObservation(report.observation, backend, name);
  t.diagnostic(JSON.stringify({ backend, name, observation: report.observation, provenance: report.evidence }));
  return report.observation;
}
test('Health immutable original and current actual PG route', { skip: process.env.HEALTH_DATABASE_TESTS !== '1', timeout: 300000, concurrency: false }, async t => {
  comparatorNegatives();
  for (const name of CASES) {
    const original = await run(t, 'original', name);
    const current = await run(t, 'current', name);
    if (!name.endsWith('development')) assert.deepEqual(current.body, original.body);
  }
});
