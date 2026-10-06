/** Two-model synthetic retention fixture; no business parents or real data. */
import assert from 'node:assert/strict';
export type Row = Record<string, unknown>;
export type SeedSpec = { requests: number; changes: number; ties?: boolean; retained?: boolean };
export type Rows = { ActivityRequest: Row[]; ActivityChange: Row[] };
export const id = (model: 'ActivityRequest' | 'ActivityChange', n: number) => `ccdd0011-${model === 'ActivityRequest' ? '0001' : '0002'}-4000-8000-${String(n).padStart(12, '0')}`;
export const CANARIES = ['prune-synthetic@example.invalid', 'Synthetic Prune Actor', 'synthetic-prune-payload'];
/** Caller provides observed server time; ±40/400 days deliberately avoid precision-boundary assumptions. */
export function seedRows(serverNow: Date, spec: SeedSpec): Rows {
  assert.ok(Number.isFinite(serverNow.getTime()));
  assert.ok([spec.requests, spec.changes].every(n => Number.isInteger(n) && n >= 0 && n <= 2001));
  const actor = { actorEmail: CANARIES[0], actorName: CANARIES[1], actorType: 'user', route: '/api/synthetic-prune', method: 'POST' };
  const row = (model: keyof Rows, n: number, expired: boolean): Row => ({
    id: id(model, n), occurredAt: new Date(serverNow.getTime() - (expired ? (model === 'ActivityRequest' ? 40 : 400) * 86400000 : -86400000) + (spec.ties ? 0 : n * 1000)),
    ...actor, ...(model === 'ActivityRequest' ? { status: 200, durationMs: n % 7 } : {
      requestId: id('ActivityRequest', 1), targetType: 'synthetic_target', targetId: 'synthetic-no-parent', action: 'update',
      changes: { field: { before: null, after: 'synthetic-prune-payload' }, _id: 'user-json-key' }
    })
  });
  return {
    ActivityRequest: [...Array.from({ length: spec.requests }, (_, n) => row('ActivityRequest', n + 1, true)), ...(spec.retained === false ? [] : [row('ActivityRequest', 9001, false), { ...row('ActivityRequest', 9002, false), actorEmail: null, actorName: null }])],
    ActivityChange: [...Array.from({ length: spec.changes }, (_, n) => row('ActivityChange', n + 1, true)), ...(spec.retained === false ? [] : [row('ActivityChange', 9001, false), { ...row('ActivityChange', 9002, false), actorEmail: null, actorName: null }])]
  };
}
/** Independently specified identity oracle, not generated from seedRows or a retention implementation. */
export function expectedRemainingIds(spec: SeedSpec, committedBatches: number): Record<keyof Rows, string[]> {
  assert.ok(!spec.ties, 'TIED_SELECTION_REQUIRES_ALLOWED_SET_CHECK');
  return Object.fromEntries((['ActivityRequest', 'ActivityChange'] as const).map(model => {
    const count = model === 'ActivityRequest' ? spec.requests : spec.changes;
    const removed = Math.min(count, 1000 * committedBatches);
    return [model, [...Array.from({ length: count - removed }, (_, n) => id(model, removed + n + 1)), ...(spec.retained === false ? [] : [id(model, 9001), id(model, 9002)])].sort()];
  })) as Record<keyof Rows, string[]>;
}
/** Remaining raw rows must be exact original rows, including ciphertext, helpers and JSON. */
export function checkRemainingRaw(before: Rows, after: Rows, spec: SeedSpec, committedBatches: number) {
  for (const model of ['ActivityRequest', 'ActivityChange'] as const) {
    const keys = after[model].map(row => String(row.id));
    assert.equal(new Set(keys).size, keys.length, 'PRUNE_DUPLICATE_REMAINING_ID');
    const old = new Map(before[model].map(row => [String(row.id), row]));
    assert.equal(old.size, before[model].length, 'PRUNE_DUPLICATE_SEED_ID');
    for (const row of after[model]) assert.deepEqual(row, old.get(String(row.id)), 'PRUNE_RETAINED_RAW_CHANGED');
    if (!spec.ties) assert.deepEqual(keys.sort(), expectedRemainingIds(spec, committedBatches)[model], 'PRUNE_REMAINING_ID_BIJECTION');
    else {
      const count = model === 'ActivityRequest' ? spec.requests : spec.changes;
      const remaining = Math.max(0, count - 1000 * committedBatches);
      const keep = spec.retained === false ? [] : [id(model, 9001), id(model, 9002)];
      assert.equal(keys.length, remaining + keep.length);
      for (const key of keep) assert.ok(keys.includes(key), 'PRUNE_RETENTION_LOST');
      const eligible = new Set(Array.from({ length: count }, (_, n) => id(model, n + 1)));
      assert.equal(keys.filter(key => eligible.has(key)).length, remaining, 'PRUNE_TIE_ALLOWED_SET');
    }
  }
}
export function expectedSummary(spec: SeedSpec) { return { deletedRequests: spec.requests, deletedChanges: spec.changes }; }
export function expectedBatchCount(spec: SeedSpec) { return Math.floor(Math.max(spec.requests, spec.changes) / 1000) + 1; }
export function comparatorNegatives() {
  const spec = { requests: 1, changes: 1 };
  const before = seedRows(new Date('2026-09-30T00:00:00.000Z'), spec);
  const valid: Rows = { ActivityRequest: before.ActivityRequest.slice(1), ActivityChange: before.ActivityChange.slice(1) };
  checkRemainingRaw(before, valid, spec, 1);
  for (const mutate of [
    (rows: Rows) => { rows.ActivityChange = before.ActivityChange; },
    (rows: Rows) => { rows.ActivityRequest.pop(); },
    (rows: Rows) => { rows.ActivityChange[0].actorName = 'changed'; },
    (rows: Rows) => { rows.ActivityRequest.push(rows.ActivityRequest[0]); }
  ]) { const bad = structuredClone(valid); mutate(bad); assert.throws(() => checkRemainingRaw(before, bad, spec, 1)); }
}
