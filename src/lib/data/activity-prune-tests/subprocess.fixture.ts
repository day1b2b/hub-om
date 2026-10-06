import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CANARIES } from './shared.fixture.ts';
export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export type Clock = { batch: number; model: string; now: string; transaction: string; pid: number };
export interface Observer { kind: string; type?: string; events?: string[]; violations?: string[]; envReads?: string[]; batch?: number; queryCount?: number; faultTriggered?: boolean; clocks?: Clock[]; sockets?: number; closed?: number; [key: string]: unknown }
export async function child(entry: URL, args: string[], env: NodeJS.ProcessEnv, cwd: string, observeCLI: boolean) {
  const worker = fork(entry, args, { cwd, env,
    execArgv: ['--experimental-strip-types', '--experimental-loader', REPO + 'scripts/ts-loader.mjs', '--import', REPO + 'scripts/test-activity-prune-baseline-loader.mjs', ...(observeCLI ? ['--import', REPO + 'src/lib/data/activity-prune-tests/cli-observer.fixture.ts'] : [])],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const stdout: Buffer[] = [], stderr: Buffer[] = [], messages: Observer[] = [];
  let size = 0, forced = false, kill: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { if (forced) return; forced = true; worker.kill('SIGTERM'); kill = setTimeout(() => worker.kill('SIGKILL'), 5000); };
  const collect = (target: Buffer[], bytes: Buffer) => { size += bytes.length; if (size > 2 * 1024 * 1024) stop(); else target.push(Buffer.from(bytes)); };
  worker.stdout!.on('data', value => collect(stdout, value)); worker.stderr!.on('data', value => collect(stderr, value));
  worker.on('message', (value: Observer) => { if (messages.length >= 200) stop(); else messages.push(value); });
  const exit = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(stop, 30000);
    worker.once('error', () => { if (worker.pid === undefined) { clearTimeout(timer); reject(new Error('PRUNE_SPAWN_FAILED')); } });
    worker.once('close', (code, signal) => { clearTimeout(timer); clearTimeout(kill); if (forced || signal) reject(new Error('PRUNE_OBSERVED_TERMINATION_STOP_OWNED_RESOURCE_AUDIT_REQUIRED')); else resolve(code); });
  });
  return { exit, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), messages };
}
const tips = [
  '◈ encrypted .env [www.dotenvx.com]', '◈ secrets for agents [www.dotenvx.com]', '⌁ auth for agents [www.vestauth.com]',
  "⌘ custom filepath { path: '/custom/path/.env' }", '⌘ enable debugging { debug: true }', '⌘ override existing { override: true }',
  '⌘ suppress logs { quiet: true }', "⌘ multiple files { path: ['.env.local', '.env'] }"
];
function allowedWarning(line: string) {
  if (line === '(Use `node --trace-warnings ...` to show where the warning was created)' || line === 'Reparsing as ES module because module syntax was detected. This incurs a performance overhead.' || line === `To eliminate this warning, add "type": "module" to ${REPO}package.json.`) return true;
  const rest = /^\(node:\d+\) (.*)$/.exec(line)?.[1];
  if (rest && [
    'ExperimentalWarning: `--experimental-loader` may be removed in the future; instead use `register()`:',
    'ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time',
    'ExperimentalWarning: Type Stripping is an experimental feature and might change at any time',
    ...['cli-observer.fixture.ts', 'batch-worker.fixture.ts', 'pg-store.fixture.ts'].map(name => `[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of ${new URL('./' + name, import.meta.url).href} is not specified and it doesn't parse as CommonJS.`),
    `[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of ${new URL('../../../../scripts/prune-activity.ts', import.meta.url).href} is not specified and it doesn't parse as CommonJS.`
  ].includes(rest)) return true;
  const register = `register(${JSON.stringify(REPO + 'scripts/ts-loader.mjs')}, pathToFileURL("./"));`;
  return [register, `${register} ${register}`].some(value => line === `--import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; ${value}'`);
}
export function checkCLIOutput(result: Awaited<ReturnType<typeof child>>, backend: string, failure: boolean, privateValues: string[], expectedInjections: readonly [number, number]): unknown[] {
  const out = result.stdout.toString(), err = result.stderr.toString();
  // Original uncaught exceptions can contain source frames. Never print/persist their raw stderr;
  // current failures must contain only the fixed code plus exact Node startup warnings.
  for (const value of [...CANARIES, ...privateValues]) if (value) {
    assert.ok(!out.includes(value), 'PRUNE_PRIVATE_STDOUT');
    if (backend === 'current' || !failure) assert.ok(!err.includes(value), 'PRUNE_PRIVATE_STDERR');
  }
  const summaries: unknown[] = [];
  let dotenvLines = 0;
  assert.ok(out.endsWith('\n'), 'PRUNE_STDOUT_LINE_TERMINATION');
  const outputLines = out.split(/\r?\n/); outputLines.pop();
  assert.ok(outputLines.every(line => line.trim().length > 0), 'PRUNE_STDOUT_BLANK_LINE');
  for (const line of outputLines) {
    if (line.startsWith('{')) {
      assert.equal(dotenvLines, 2, 'PRUNE_SUMMARY_AFTER_DOTENV');
      assert.equal(summaries.length, 0, 'PRUNE_SINGLE_SUMMARY');
      summaries.push(JSON.parse(line)); continue;
    }
    assert.equal(summaries.length, 0, 'PRUNE_NO_NOTICE_AFTER_SUMMARY');
    const noise = /^◇ injected env \((\d+)\) from (\.env\.local|\.env) \/\/ tip: (.*)$/.exec(line);
    assert.ok(noise && tips.includes(noise[3]), 'PRUNE_UNKNOWN_STDOUT');
    assert.equal(noise[2], ['.env.local', '.env'][dotenvLines], 'PRUNE_DOTENV_NOTICE_ORDER');
    assert.equal(noise[1], String(expectedInjections[dotenvLines]), 'PRUNE_DOTENV_NOTICE_COUNT');
    dotenvLines++;
  }
  assert.equal(dotenvLines, 2, 'PRUNE_ACTUAL_DOTENV_OUTPUT');
  if (backend === 'current' || !failure) {
    const lines = err.length ? err.split(/\r?\n/) : [];
    if (err.length) { assert.equal(lines.pop(), '', 'PRUNE_STDERR_LINE_TERMINATION'); assert.ok(lines.every(line => line.trim().length > 0), 'PRUNE_STDERR_BLANK_LINE'); }
    assert.equal(lines.filter(line => line === 'ACTIVITY_PRUNE_FAILED').length, failure ? 1 : 0);
    for (const line of lines) assert.ok(line === 'ACTIVITY_PRUNE_FAILED' && failure || allowedWarning(line), 'PRUNE_UNKNOWN_STDERR');
  }
  return summaries;
}
export const safeOutput = (value: Awaited<ReturnType<typeof child>>) => ({ exit: value.exit, stdoutBytes: value.stdout.length, stderrBytes: value.stderr.length,
  stdoutSha256: createHash('sha256').update(value.stdout).digest('hex'), stderrSha256: createHash('sha256').update(value.stderr).digest('hex') });
export function checkObserver(value: Observer, expectedBatches: number, failedBatch = 0, closeFailure = false) {
  assert.deepEqual(value.violations, [], 'PRUNE_OBSERVER_VIOLATION');
  assert.deepEqual(value.envReads, ['.env.local', '.env']);
  assert.equal(value.batch, expectedBatches); assert.equal(value.closed, value.sockets); assert.ok(Number(value.sockets) > 0);
  assert.equal(value.faultTriggered, failedBatch > 0 || closeFailure);
  const events = value.events!;
  assert.ok(events.includes('close-complete'));
  for (let batch = 1; batch <= expectedBatches; batch++) {
    const clocks = value.clocks!.filter(clock => clock.batch === batch);
    assert.equal(clocks.length, 2); assert.deepEqual(clocks.map(clock => clock.model), ['activity_requests', 'activity_changes']);
    assert.equal(clocks[0].now, clocks[1].now); assert.equal(clocks[0].transaction, clocks[1].transaction); assert.equal(clocks[0].pid, clocks[1].pid);
  }
  if (failedBatch) { assert.ok(!events.includes('summary')); assert.ok(events.includes('rollback')); assert.equal(events.filter(event => event === 'commit').length, failedBatch - 1); }
  else {
    assert.equal(events.filter(event => event === 'commit').length, expectedBatches);
    assert.equal(events.filter(event => event === 'summary').length, 1);
    assert.ok(events.indexOf('summary') < events.indexOf('close-called'), 'PRUNE_SUMMARY_BEFORE_CLOSE');
  }
}

/** Same public-output checker and summary literal, tested before opening the owned PG connection. */
export function outputNegatives() {
  const local = `◇ injected env (1) from .env.local // tip: ${tips[0]}`;
  const env = `◇ injected env (0) from .env // tip: ${tips[1]}`;
  const summary = '{"deletedRequests":0,"deletedChanges":0}';
  const check = (lines: string[]) => assert.deepEqual(checkCLIOutput({ exit: 0, stdout: Buffer.from(lines.join('\n') + '\n'), stderr: Buffer.alloc(0), messages: [] }, 'current', false, [], [1, 0]), [{ deletedRequests: 0, deletedChanges: 0 }]);
  check([local, env, summary]);
  for (const lines of [
    [local.replace('◇', '[dotenv@17.4.2]'), env, summary],
    [local.replace('(1)', '(0)'), env, summary], [local, env.replace('(0)', '(1)'), summary],
    [local, '', env, summary], [local, env, summary, ''], [local, '   ', env, summary],
    [local + ' arbitrary-tail', env, summary],
    [local.replace('.env.local', '/not-owned/.env.local'), env, summary],
    [env, local, summary], [local, summary], [local, env, env, summary],
    [summary, local, env], [local, env, summary, summary], [local, env],
    [local, env, summary, 'synthetic-prune-payload']
  ]) assert.throws(() => check(lines));
}

/** Only these authored fixed codes may leave the catch; assertion diff/message stays private. */
export function knownFailureCode(error: unknown): string {
  const known = new Set([
    'PRUNE_UNKNOWN_STDOUT', 'PRUNE_UNKNOWN_STDERR', 'PRUNE_PRIVATE_STDOUT', 'PRUNE_PRIVATE_STDERR',
    'PRUNE_DOTENV_NOTICE_ORDER', 'PRUNE_DOTENV_NOTICE_COUNT', 'PRUNE_ACTUAL_DOTENV_OUTPUT',
    'PRUNE_STDOUT_LINE_TERMINATION', 'PRUNE_STDOUT_BLANK_LINE', 'PRUNE_STDERR_LINE_TERMINATION', 'PRUNE_STDERR_BLANK_LINE',
    'PRUNE_SUMMARY_AFTER_DOTENV', 'PRUNE_SINGLE_SUMMARY', 'PRUNE_NO_NOTICE_AFTER_SUMMARY',
    'PRUNE_CLI_SUMMARY_LITERAL', 'PRUNE_OBSERVER_MISSING', 'PRUNE_OBSERVER_VIOLATION', 'PRUNE_SUMMARY_BEFORE_CLOSE'
  ]);
  const candidate = error instanceof Error ? error.message.split('\n')[0] : '';
  return known.has(candidate) ? candidate : 'UNCLASSIFIED_FAILURE';
}
