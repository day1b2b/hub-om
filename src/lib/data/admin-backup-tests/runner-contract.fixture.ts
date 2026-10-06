import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SECRET, type Row } from './shared.fixture.ts';
export function endpoint(value: string | undefined): string {
  assert.ok(value, 'BACKUP_TEST_URL_REQUIRED');
  const url = new URL(value);
  assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '56756');
  assert.equal(url.username, 'synthetic'); assert.equal(url.password, ''); assert.equal(url.pathname, '/admin_backup_test');
  assert.equal(url.search, ''); assert.equal(url.hash, ''); return url.href;
}
export interface Report {
  kind: string; backend: string; timezone: string; ledger: Row[]; violations: string[];
  cleanupComplete: boolean; socketsClosed: boolean; provenance: unknown;
}
export function checkReport(value: Report) {
  assert.equal(value.kind, 'backup-result'); assert.equal(value.cleanupComplete, true); assert.equal(value.socketsClosed, true);
  assert.deepEqual(value.violations, []);
  assert.deepEqual(value.ledger.map(row => row.label), ['empty-secret', 'rich-secret', 'rich-admin', 'wrong-secret-admin', 'anonymous-denied', 'workspace-nonadmin-denied', 'admin-unconfigured-denied', 'external-configured-denied', 'wrong-secret-denied', 'unselected-corruption', 'boundary-ties']);
  for (const [index, row] of value.ledger.entries()) {
    assert.equal(row.auditCount, index + 1); assert.equal(row.rawUnchanged, true);
    const success = !String(row.label).endsWith('-denied');
    assert.equal(row.status, success ? 200 : 'guard-rejection'); assert.equal(row.readModels, success ? 12 : 0);
    if (success) assert.match(String(row.bodyHash), /^[a-f0-9]{64}$/);
    else assert.equal(row.bodyHash, null);
  }
}
const ownedWorkerURL = new URL('./baseline-worker.fixture.ts', import.meta.url).href;
const ownedPackagePath = fileURLToPath(new URL('../../../../package.json', import.meta.url));
const ownedLoaderPath = fileURLToPath(new URL('../../../../scripts/ts-loader.mjs', import.meta.url));
// Exact warning text verified against pg-diagnostic.log SHA256; only Node's PID varies.
const nodeWarnings = new Set([
  'ExperimentalWarning: `--experimental-loader` may be removed in the future; instead use `register()`:',
  'ExperimentalWarning: Type Stripping is an experimental feature and might change at any time',
  'ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time',
  `[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of ${ownedWorkerURL} is not specified and it doesn't parse as CommonJS.`
]);
const fixedStderrLines = new Set([
  '(Use `node --trace-warnings ...` to show where the warning was created)',
  'Reparsing as ES module because module syntax was detected. This incurs a performance overhead.',
  `To eliminate this warning, add "type": "module" to ${ownedPackagePath}.`
]);
for (const path of ['./scripts/ts-loader.mjs', ownedLoaderPath]) {
  const registration = `register(${JSON.stringify(path)}, pathToFileURL("./"));`;
  // Node's repeated loader suggestion is allowed only for the same exact owned loader.
  for (const value of [registration, `${registration} ${registration}`])
    fixedStderrLines.add(`--import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; ${value}'`);
}
function allowedStderrLine(line: string): boolean {
  if (fixedStderrLines.has(line)) return true;
  const warning = /^\(node:\d+\) (.*)$/.exec(line);
  return warning !== null && nodeWarnings.has(warning[1]);
}
/** Diagnostic labels do NOT authorize stderr. No substring, path, URI or source is returned. */
export function unexpectedStderrDiagnostics(stderr: Buffer) {
  const lines = stderr.toString().split(/\r?\n/);
  const unexpected = lines.flatMap((line, index) => {
    if (!line.trim() || allowedStderrLine(line)) return [];
    let classification = 'UNKNOWN';
    if (/^\(node:\d+\) \[MODULE_TYPELESS_PACKAGE_JSON\] Warning: Module type of /.test(line)) classification = 'NODE_MODULE_TYPELESS';
    else if (/^\(node:\d+\) ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time$/.test(line)) classification = 'NODE_STRIP_TYPES';
    else if (line === 'Reparsing as ES module because module syntax was detected. This incurs a performance overhead.') classification = 'NODE_MODULE_REPARSE';
    else if (line.startsWith('To eliminate this warning, add "type": "module" to ')) classification = 'NODE_MODULE_TYPE_SUGGESTION';
    else if (line.startsWith("--import 'data:text/javascript,import { register } from \"node:module\";")) classification = 'NODE_LOADER_REGISTRATION';
    return [{ lineNumber: index + 1, classification, bytes: Buffer.byteLength(line),
      sha256: createHash('sha256').update(line).digest('hex'),
      loaderRegistrationCount: classification === 'NODE_LOADER_REGISTRATION' ? (line.match(/register\(/g) ?? []).length : 0 }];
  });
  return { unexpectedCount: unexpected.length, lines: unexpected.slice(0, 16), omittedCount: Math.max(0, unexpected.length - 16) };
}
/** Exact Node startup warning lines only, never a raw stderr dump or blanket warning suppression. */
export function checkOutput(stdout: Buffer, stderr: Buffer, privateValues: string[]) {
  assert.equal(stdout.length, 0, 'BACKUP_UNEXPECTED_STDOUT');
  const text = stderr.toString();
  for (const value of [SECRET, 'synthetic-coach-a', '합성코치 A', 'synthetic-feedback', ...privateValues])
    if (value) assert.ok(!text.includes(value), 'BACKUP_PRIVATE_STDERR');

  for (const line of text.split(/\r?\n/).filter(line => line.trim())) assert.ok(allowedStderrLine(line), 'BACKUP_UNAPPROVED_STDERR_LINE');
}
export function runnerNegatives() {
  endpoint('postgresql://synthetic@127.0.0.1:56756/admin_backup_test');
  for (const url of ['postgresql://synthetic@127.0.0.1:56754/admin_backup_test', 'postgresql://synthetic@127.0.0.1:56756/other', 'postgresql://synthetic@localhost:56756/admin_backup_test', 'postgresql://synthetic:secret@127.0.0.1:56756/admin_backup_test', 'postgresql://synthetic@127.0.0.1:56756/admin_backup_test?options=unsafe']) assert.throws(() => endpoint(url));
  checkOutput(Buffer.alloc(0), Buffer.alloc(0), []);
  assert.throws(() => checkOutput(Buffer.from('synthetic'), Buffer.alloc(0), []));
  assert.throws(() => checkOutput(Buffer.alloc(0), Buffer.from('synthetic-feedback'), []));
  assert.throws(() => checkOutput(Buffer.alloc(0), Buffer.from('unknown warning'), []));
}
