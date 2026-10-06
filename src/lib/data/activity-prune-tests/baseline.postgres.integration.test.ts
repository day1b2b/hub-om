/** Parent-only real PG + actual CLI oracle. No migrations, server lifecycle or operational env access. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { ROOT, endpoint, loader, openOwnedStore, seed, rawRows, removeOwned, assertEmpty } from './pg-store.fixture.ts';
import { seedRows, expectedSummary, expectedBatchCount, checkRemainingRaw, comparatorNegatives, id, type SeedSpec, type Rows } from './shared.fixture.ts';
import { REPO, child, checkCLIOutput, checkObserver, safeOutput, outputNegatives, knownFailureCode } from './subprocess.fixture.ts';
const summary = (requests: number, changes: number) => ({ deletedRequests: requests, deletedChanges: changes });
test('Activity prune frozen original/current PG batch and real CLI', {
  skip: process.env.ACTIVITY_PRUNE_DATABASE_TESTS !== '1', concurrency: false, timeout: 900000
}, async t => {
  let sql: pg.Client | undefined, owned: Rows = { ActivityRequest: [], ActivityChange: [] }, phase = 'preflight', uncertain = false;
  const directories: string[] = [];
  const envBase = (backend: string, timezone: string): NodeJS.ProcessEnv => ({
    PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C', TZ: timezone, NODE_ENV: 'production',
    PRUNE_TEST_BACKEND: backend, ACTIVITY_PRUNE_TEST_PG_URL: endpoint(process.env.ACTIVITY_PRUNE_TEST_PG_URL),
    PII_ACTIVE_KEY_ID: process.env.PII_ACTIVE_KEY_ID, PII_ENCRYPTION_KEYS: process.env.PII_ENCRYPTION_KEYS,
    PII_INDEX_KEY: process.env.PII_INDEX_KEY, PII_ALLOW_PLAINTEXT_READS: 'false'
  });
  async function cleanRows() { if (sql) { await removeOwned(sql, owned); owned = { ActivityRequest: [], ActivityChange: [] }; } }
  async function runCLI(backend: string, timezone: string, fault: string, preference: string, wanted: unknown[], batches: number, failedBatch = 0) {
    phase = `${backend}/${timezone}/cli/${fault}/${preference}`;
    const cwd = await mkdtemp(ROOT + '/cli-'); directories.push(cwd);
    const env = envBase(backend, timezone); env.PRUNE_TEST_FAULT = fault;
    const valid = endpoint(process.env.ACTIVITY_PRUNE_TEST_PG_URL);
    const forbidden = 'postgresql://synthetic@127.0.0.1:56758/not_owned';
    const local = preference === 'env-only' ? 'SYNTHETIC_PRUNE_MARK=local\n' : `DATABASE_URL=${preference === 'process-first' ? forbidden : valid}\n`;
    await writeFile(cwd + '/.env.local', local, { mode: 0o600 });
    await writeFile(cwd + '/.env', `DATABASE_URL=${preference === 'env-only' ? valid : forbidden}\n`, { mode: 0o600 });
    if (preference === 'process-first') env.DATABASE_URL = valid;
    const result = await child(new URL('../../../../scripts/prune-activity.ts', import.meta.url), [], env, cwd, true);
    const failure = fault !== 'none';
    t.diagnostic(JSON.stringify({ phase, injection: failedBatch ? 'actual PG SQL cast fault in second DELETE position' : fault === 'close' ? 'post-real-close throw injection' : 'none', ...safeOutput(result) }));
    assert.equal(result.exit, failure ? 1 : 0);
    const privateValues = [valid, env.PII_INDEX_KEY!, env.PII_ENCRYPTION_KEYS!, ...Object.values(JSON.parse(env.PII_ENCRYPTION_KEYS ?? '{}') as Record<string, string>)];
    const expectedInjections: readonly [number, number] = preference === 'env-only' ? [1, 1] : preference === 'process-first' ? [0, 0] : [1, 0];
    assert.deepEqual(checkCLIOutput(result, backend, failure, privateValues, expectedInjections), wanted, 'PRUNE_CLI_SUMMARY_LITERAL');
    const observation = result.messages.filter(message => message.kind === 'prune-observer' && Array.isArray(message.events)).at(-1);
    assert.ok(observation, 'PRUNE_OBSERVER_MISSING'); checkObserver(observation, batches, failedBatch, fault === 'close');
    // Same checker must reject swallowed observer violations and an incorrect close/output order.
    const bad = structuredClone(observation); bad.violations = ['ENDPOINT_ESCAPE']; assert.throws(() => checkObserver(bad, batches, failedBatch, fault === 'close'));
    t.diagnostic(JSON.stringify({ phase, observation }));
    return observation;
  }
  try {
    for (const key of ['PII_ACTIVE_KEY_ID', 'PII_ENCRYPTION_KEYS', 'PII_INDEX_KEY']) assert.ok(process.env[key], 'PRUNE_CALLER_EPHEMERAL_KEYS_REQUIRED');
    assert.equal(process.env.DATABASE_URL, undefined, 'PRUNE_NO_INHERITED_DATABASE_URL');
    const frozen = await loader(); const provenance = frozen.verifyBaseline(); await frozen.negativeControls(); comparatorNegatives(); outputNegatives();
    t.diagnostic(JSON.stringify({ provenance }));
    await mkdir(ROOT, { recursive: true }); sql = await openOwnedStore();
    const anchor = (await sql.query('SELECT now() AS now')).rows[0].now as Date;
    const scenarios: { name: string; spec: SeedSpec; fault?: string; preference?: string }[] = [
      { name: 'empty', spec: { requests: 0, changes: 0, retained: false } },
      { name: 'fresh', spec: { requests: 0, changes: 0 }, preference: 'env-only' },
      { name: 'requests999', spec: { requests: 999, changes: 0 }, preference: 'process-first' },
      { name: 'changes1000', spec: { requests: 0, changes: 1000 } },
      { name: 'both1000', spec: { requests: 1000, changes: 1000 } },
      { name: 'both1001', spec: { requests: 1001, changes: 1001 } },
      { name: 'batch-rollback', spec: { requests: 1, changes: 1 }, fault: 'batch1' },
      { name: 'partial-commit', spec: { requests: 1001, changes: 1001 }, fault: 'batch2' },
      { name: 'close-after-summary', spec: { requests: 1, changes: 1 }, fault: 'close' }
    ];
    for (const backend of ['original', 'current']) {
      for (const scenario of scenarios) {
        phase = backend + '/seed/' + scenario.name;
        await assertEmpty(sql); owned = seedRows(anchor, scenario.spec);
        const before = await seed(sql, anchor, scenario.spec);
        const failedBatch = scenario.fault === 'batch1' ? 1 : scenario.fault === 'batch2' ? 2 : 0;
        const batches = failedBatch || expectedBatchCount(scenario.spec);
        await runCLI(backend, 'UTC', scenario.fault ?? 'none', scenario.preference ?? 'local-first', failedBatch ? [] : [expectedSummary(scenario.spec)], batches, failedBatch);
        checkRemainingRaw(before, await rawRows(sql), scenario.spec, failedBatch ? failedBatch - 1 : batches);
        if (failedBatch) {
          const remainingR = Math.max(0, scenario.spec.requests - 1000 * (failedBatch - 1)), remainingC = Math.max(0, scenario.spec.changes - 1000 * (failedBatch - 1));
          await runCLI(backend, 'UTC', 'none', 'local-first', [summary(remainingR, remainingC)], Math.floor(Math.max(remainingR, remainingC) / 1000) + 1);
          checkRemainingRaw(before, await rawRows(sql), scenario.spec, 3);
        }
        if (failedBatch || scenario.name === 'both1001') {
          await runCLI(backend, 'UTC', 'none', 'local-first', [summary(0, 0)], 1);
          checkRemainingRaw(before, await rawRows(sql), scenario.spec, 3);
        }
        await cleanRows();
      }
      // Asia/Seoul coarse parity: same anchor/rows; no PG microsecond equality assumption.
      phase = backend + '/Seoul-seed';
      const rich = { requests: 1001, changes: 1 }; owned = seedRows(anchor, rich);
      const before = await seed(sql, anchor, rich);
      await runCLI(backend, 'Asia/Seoul', 'none', 'local-first', [expectedSummary(rich)], 2);
      checkRemainingRaw(before, await rawRows(sql), rich, 2); await cleanRows();
      // Actual one-batch helper permits any correct member of the tied cutoff set.
      phase = backend + '/ties';
      const ties = { requests: 1001, changes: 1001, ties: true }; owned = seedRows(anchor, ties);
      const tieBefore = await seed(sql, anchor, ties);
      const tieResult = await child(new URL('./batch-worker.fixture.ts', import.meta.url), [backend, 'once'], envBase(backend, 'UTC'), REPO, false);
      assert.equal(tieResult.exit, 0); const tieReport = tieResult.messages.at(-1); assert.ok(tieReport);
      assert.deepEqual(tieReport.result, { requests: 1000, changes: 1000 }); assert.equal(tieReport.socketsClosed, true); assert.deepEqual(tieReport.violations, []);
      checkRemainingRaw(tieBefore, await rawRows(sql), ties, 1); t.diagnostic(JSON.stringify({ phase, ...safeOutput(tieResult), result: tieReport.result }));
      await runCLI(backend, 'UTC', 'none', 'local-first', [summary(1, 1)], 1);
      checkRemainingRaw(tieBefore, await rawRows(sql), ties, 2); await cleanRows();
      phase = backend + '/microsecond-boundary';
      owned = { ActivityRequest: [9901,9902,9903].map(n => ({ id: id('ActivityRequest',n) })), ActivityChange: [9901,9902,9903].map(n => ({ id: id('ActivityChange',n) })) };
      const boundary = await child(new URL('./batch-worker.fixture.ts', import.meta.url), [backend, 'boundary'], envBase(backend, 'UTC'), REPO, false);
      assert.equal(boundary.exit, 0); const report = boundary.messages.at(-1); assert.ok(report); assert.equal(report.socketsClosed, true); assert.deepEqual(report.violations, []);
      assert.ok(report.result && typeof report.result === 'object' && 'serverNowMicroseconds' in report.result);
      t.diagnostic(JSON.stringify({ phase, ...safeOutput(boundary), report })); await cleanRows();
    }
    await assertEmpty(sql); t.diagnostic('PRUNE_OWNED_ROWS_REMAINING_0');
  } catch (error) {
    uncertain = error instanceof Error && error.message.includes('OWNED_RESOURCE_AUDIT_REQUIRED');
    const failureSha256 = createHash('sha256').update(error instanceof Error ? error.name + ':' + error.message : 'NON_ERROR').digest('hex');
    t.diagnostic(JSON.stringify({ phase, failureCode: knownFailureCode(error), failureSha256, ownedResourceAuditRequired: uncertain }));
    throw new Error('ACTIVITY_PRUNE_PG_GATE_FAILED');
  } finally {
    try { if (sql && !uncertain) await cleanRows(); }
    finally {
      try { await sql?.end(); }
      finally { if (!uncertain) for (const directory of directories) await rm(directory, { recursive: true, force: true }); }
    }
  }
});
