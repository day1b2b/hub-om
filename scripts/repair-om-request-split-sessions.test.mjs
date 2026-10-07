import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { planSessionSplit } from './repair-om-request-split-sessions.mjs';
const env = { PII_ACTIVE_KEY_ID: 'test', PII_ENCRYPTION_KEYS: JSON.stringify({ test: randomBytes(32).toString('base64') }), PII_INDEX_KEY: randomBytes(32).toString('base64') };
function fixture() {
  const row = (id, start, end) => ({ _id: id, operationId: `synthetic-${id}`, courseRecordId: 'synthetic-course', operationStatus: 'ASSIGNMENT_NEEDED',
    omName: null, omUserId: null, deletedAt: null, sourceFingerprint: null, totalCost: null, instructorCost: null, operationCost: null,
    startDate: new Date(start), endDate: new Date(end), createdAt: new Date(0), updatedAt: new Date(0), roundNo: id });
  return { request: { totalSessions: 4, assignedOm: null, status: '배정필요', operationId: 'synthetic-a' },
    operations: [row('a', '2099-01-01', '2099-01-03'), row('b', '2099-02-01', '2099-02-03')],
    sessions: ['2099-01-01', '2099-01-03', '2099-02-01', '2099-02-03'].map(date => ({ date, dateEnd: date, timeStart: '09:00', timeEnd: '17:00', duration: '7', location: 'Synthetic room' })) };
}
test('두 원본 ID와 대표 연결을 보존해 네 날짜를 분할하고 입력은 변경하지 않는다', () => {
  const f = fixture(), before = structuredClone(f);
  const plan = planSessionSplit(f.request, f.operations, f.sessions, env);
  assert.deepEqual(f, before);
  assert.equal(plan.length, 4);
  assert.equal(plan[0].after._id, 'a'); assert.equal(plan[2].after._id, 'b');
  assert.equal(plan.filter(p => p.before === null).length, 2);
  assert.equal(new Set(plan.map(p => p.after._id)).size, 4);
  assert.deepEqual(plan.map(p => p.after.roundNo), ['1', '2', '3', '4']);
  assert.deepEqual(plan.map(p => p.after.startDate.toISOString().slice(0, 10)), f.sessions.map(s => s.date));
  for (const p of plan) { assert.equal(p.after.startDate.getTime(), p.after.endDate.getTime()); assert.equal(p.after.sessionDurationDays, 1); assert.match(p.after.region, /^pii:v1:/); }
});
test('기존 배정·비용·원천 연결이 있으면 자동 분할을 거부한다', () => {
  for (const patch of [{ omName: 'encrypted-assignee' }, { operationStatus: 'DONE' }, { totalCost: '10.00' }, { sourceFingerprint: 'source' }]) {
    const f = fixture(); Object.assign(f.operations[0], patch);
    assert.throws(() => planSessionSplit(f.request, f.operations, f.sessions, env));
  }
});
test('명시적으로 허용한 배정완료 회차는 기존 배정을 보존해 분할한다', () => {
  const f = fixture();
  Object.assign(f.request, { assignedOm: 'encrypted-assignee', status: '배정완료' });
  for (const row of f.operations) Object.assign(row, { omName: 'encrypted-assignee', omUserId: 'synthetic-user', operationStatus: 'ASSIGNMENT_PLANNED' });
  assert.throws(() => planSessionSplit(f.request, f.operations, f.sessions, env), /REQUEST_ALREADY_ASSIGNED/);
  const plan = planSessionSplit(f.request, f.operations, f.sessions, env, new Date(0), { allowAssigned: true });
  assert.equal(plan.length, 4);
  assert.ok(plan.every(row => row.after.omUserId === 'synthetic-user' && row.after.operationStatus === 'ASSIGNMENT_PLANNED'));
});
test('요청의 여러 날 구간과 명시 교육일을 원본 범위 안에서 보존한다', () => {
  const f = fixture();
  f.sessions = [
    { date: '2099-01-01', dateEnd: '2099-01-02', educationDatesText: '2099-01-01, 2099-01-02', duration: '2' },
    { date: '2099-01-03', dateEnd: '2099-01-03', duration: '1' },
    { date: '2099-02-01', dateEnd: '2099-02-03', duration: '3' }
  ];
  f.request.totalSessions = 3;
  const plan = planSessionSplit(f.request, f.operations, f.sessions, env);
  assert.deepEqual(plan.map(row => dayRange(row.after)), [
    ['2099-01-01', '2099-01-02', ['2099-01-01', '2099-01-02']],
    ['2099-01-03', '2099-01-03', ['2099-01-03']],
    ['2099-02-01', '2099-02-03', ['2099-02-01', '2099-02-02', '2099-02-03']]
  ]);
});
function dayRange(row) { return [row.startDate.toISOString().slice(0, 10), row.endDate.toISOString().slice(0, 10), row.educationDates.map(value => value.toISOString().slice(0, 10))]; }
test('중복 날짜·원본 구간 밖 날짜·대표 누락·구간 중첩은 거부한다', () => {
  const mutations = [f => { f.sessions[1].date = f.sessions[0].date; }, f => { f.sessions[1].date = '2099-01-10'; f.sessions[1].dateEnd = '2099-01-10'; },
    f => { f.request.operationId = 'missing'; }, f => { f.operations[1].startDate = new Date('2099-01-01'); }];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => planSessionSplit(f.request, f.operations, f.sessions, env)); }
});
