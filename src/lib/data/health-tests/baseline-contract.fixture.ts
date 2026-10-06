import assert from 'node:assert/strict';
export const CASES = ['success', 'unavailable', 'invalid-key', 'invalid-key-development', 'scope', 'scope-development'] as const;
export type Case = typeof CASES[number];
export type Backend = 'original' | 'current';
export interface Observation {
  connects: number; queries: string[]; violations: string[]; disconnected: boolean;
  socketsClosed: boolean; nextResponse: boolean; dynamic: string;
  status: number; headers: [string,string][]; body: unknown;
}
export function endpoint(value: string | undefined, port: number) {
  assert.ok(value, 'HEALTH_TEST_ENDPOINT_REQUIRED');
  let url: URL; try { url = new URL(value); } catch { throw new Error('HEALTH_TEST_ENDPOINT_INVALID'); }
  assert.ok(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && url.port === String(port)
    && url.username === 'synthetic' && !url.password && !url.search && !url.hash
    && url.pathname === '/health_test', 'HEALTH_TEST_ENDPOINT_NOT_OWNED');
  return value;
}
export function expectedBody(backend: Backend, name: Case) {
  if (name === 'success') return { ok: true, database: 'connected' };
  const error = backend === 'original' && name === 'invalid-key-development'
    ? 'PII keys must be base64-encoded 32-byte random keys.'
    : backend === 'original' && name === 'scope-development' ? 'DEFAULT_DATABASE_ACCESS_BLOCKED' : 'Health check failed';
  return { ok: false, database: 'unavailable', error };
}
export function checkObservation(value: Observation, backend: Backend, name: Case) {
  assert.deepEqual(value.violations, [], 'HEALTH_OBSERVER_VIOLATION');
  assert.equal(value.disconnected, true, 'HEALTH_DISCONNECT_NOT_COMPLETED');
  assert.equal(value.socketsClosed, true, 'HEALTH_SOCKET_CLOSE_NOT_OBSERVED');
  assert.equal(value.nextResponse, true, 'HEALTH_NOT_NEXT_RESPONSE'); assert.equal(value.dynamic, 'force-dynamic');
  assert.equal(value.status, name === 'success' ? 200 : 503);
  assert.deepEqual(value.headers, [['content-type', 'application/json']]);
  assert.deepEqual(value.body, expectedBody(backend, name));
  if (name === 'success') { assert.ok(value.connects > 0); assert.deepEqual(value.queries, ['SELECT 1']); }
  else if (name === 'unavailable') { assert.ok(value.connects > 0); assert.deepEqual(value.queries, []); }
  else { assert.equal(value.connects, 0); assert.deepEqual(value.queries, []); }
}
export function comparatorNegatives() {
  const good: Observation = { connects: 1, queries: ['SELECT 1'], violations: [], disconnected: true,
    socketsClosed: true, nextResponse: true, dynamic: 'force-dynamic', status: 200,
    headers: [['content-type', 'application/json']], body: { ok: true, database: 'connected' } };
  checkObservation(good, 'original', 'success');
  for (const bad of [{ ...good, connects: 0 }, { ...good, queries: ['SELECT 2'] }, { ...good, body: { ok: true } },
    { ...good, violations: ['SWALLOWED_OBSERVER'] }, { ...good, socketsClosed: false }]) assert.throws(() => checkObservation(bad, 'original', 'success'));
}
