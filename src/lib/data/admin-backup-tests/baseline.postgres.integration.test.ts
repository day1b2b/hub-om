/** Parent execution only; original and current each run in fresh processes in both timezones. */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { endpoint, checkReport, checkOutput, unexpectedStderrDiagnostics, runnerNegatives, type Report } from './runner-contract.fixture.ts';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
async function run(t: TestContext, backend: string, timezone: string): Promise<Report> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C', TZ: timezone, NODE_ENV: 'production',
    ADMIN_BACKUP_TEST_PG_URL: endpoint(process.env.ADMIN_BACKUP_TEST_PG_URL),
    PII_ACTIVE_KEY_ID: process.env.PII_ACTIVE_KEY_ID, PII_ENCRYPTION_KEYS: process.env.PII_ENCRYPTION_KEYS,
    PII_INDEX_KEY: process.env.PII_INDEX_KEY, PII_ALLOW_PLAINTEXT_READS: 'false'
  };
  const worker = fork(new URL('./baseline-worker.fixture.ts', import.meta.url), [backend], {
    cwd: root, env, execArgv: ['--experimental-strip-types', '--experimental-loader', root + 'scripts/ts-loader.mjs', '--import', root + 'scripts/test-admin-backup-baseline-loader.mjs'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  let bytes = 0, oversized = false, failed = false, report: Report | undefined;
  let forced = false, escalation: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (forced) return;
    forced = true; worker.kill('SIGTERM'); escalation = setTimeout(() => worker.kill('SIGKILL'), 5000);
  };
  const receive = (target: Buffer[], data: Buffer) => {
    bytes += data.length;
    if (bytes > 1024 * 1024) { oversized = true; stop(); }
    else target.push(Buffer.from(data));
  };
  worker.stdout!.on('data', data => receive(stdout, data)); worker.stderr!.on('data', data => receive(stderr, data));
  worker.on('message', (input: unknown) => {
    const value = input as Report & { phase?: string; failureCode?: string; completedCases?: number };
    if (value.kind === 'backup-result') { if (report) failed = true; report = value; }
    else {
      failed = true;
      // Only closed safe metadata; never error message, stack, body, connection string or source.
      t.diagnostic(JSON.stringify({ kind: 'backup-worker-failure', backend, timezone, phase: value.phase, failureCode: value.failureCode,
        completedCases: value.completedCases, cleanupComplete: value.cleanupComplete, socketsClosed: value.socketsClosed }));
    }
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(stop, 90000);
    worker.once('error', () => { if (worker.pid === undefined) { clearTimeout(timer); reject(new Error('BACKUP_WORKER_SPAWN_FAILED')); } });
    worker.once('close', (exit, signal) => {
      clearTimeout(timer); clearTimeout(escalation);
      if (forced || signal) reject(new Error('BACKUP_WORKER_OBSERVED_TERMINATION_STOP_OWNED_RESOURCE_AUDIT_REQUIRED'));
      else resolve(exit);
    });
  });
  const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
  t.diagnostic(JSON.stringify({ backend, timezone, exit: code, stdoutBytes: out.length, stderrBytes: err.length,
    stderrSha256: createHash('sha256').update(err).digest('hex'), oversized }));
  t.diagnostic(JSON.stringify({ kind: 'backup-stderr-classification', backend, timezone,
    ...unexpectedStderrDiagnostics(err), workerReportedCleanup: report?.cleanupComplete === true,
    workerReportedSocketClose: report?.socketsClosed === true }));
  const keys = Object.values(JSON.parse(env.PII_ENCRYPTION_KEYS ?? '{}') as Record<string, string>);
  checkOutput(out, err, [env.ADMIN_BACKUP_TEST_PG_URL!, env.PII_INDEX_KEY!, env.PII_ENCRYPTION_KEYS!, ...keys]);
  assert.equal(oversized, false); assert.equal(code, 0); assert.equal(failed, false); assert.ok(report);
  assert.equal(report.backend, backend); assert.equal(report.timezone, timezone); checkReport(report);
  for (const mutate of [(r: Report) => { r.violations.push('PG_ENDPOINT_ESCAPE'); }, (r: Report) => { r.cleanupComplete = false; }, (r: Report) => { r.ledger[0].readModels = 0; }]) {
    const bad = structuredClone(report); mutate(bad); assert.throws(() => checkReport(bad));
  }
  t.diagnostic(JSON.stringify(report));
  return report;
}
test('Admin backup immutable original/current actual PG full DTO and audit', {
  skip: process.env.ADMIN_BACKUP_DATABASE_TESTS !== '1', concurrency: false, timeout: 400000
}, async t => {
  runnerNegatives();
  for (const timezone of ['UTC', 'Asia/Seoul']) {
    const original = await run(t, 'original', timezone);
    const current = await run(t, 'current', timezone);
    // Both entire bodies already passed the same independent literals. Array and boundary-tie
    // ordering is intentionally not compared through incidental JSON serialization hashes.
    const logical = (r: Report) => r.ledger.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'bodyHash')));
    assert.deepEqual(logical(current), logical(original));
  }
});
