/** Synthetic-only seed. Expected DTOs below are independently specified, never decoded from this seed. */
import assert from 'node:assert/strict';
export type Row = Record<string, unknown>;
export type FixtureCase = 'empty' | 'rich' | 'ties';
export type ResponseData = Record<string, Row[]>;
export const ADMIN = 'backup-oracle@day1company.co.kr';
export const SECRET = 'synthetic-backup-secret-only';
export const MODEL_KEYS = {
  Coach: 'coaches', CoachPrivateProfile: 'privateProfiles', CoachFieldMaster: 'fields',
  CoachCurriculumMaster: 'curriculums', CoachField: 'coachFields', CoachCurriculum: 'coachCurriculums',
  CoachSchedule: 'schedules', CoachScheduleAccessLog: 'scheduleAccessLogs', CoachEngagement: 'engagements',
  CoachEngagementSchedule: 'engagementSchedules', CoachImportRun: 'importRuns', CoachdbArchiveSnapshot: 'archiveSnapshots'
} as const;
export type Model = keyof typeof MODEL_KEYS;
export const TABLES: Record<Model, string> = {
  Coach: 'coaches', CoachPrivateProfile: 'coach_private_profiles', CoachFieldMaster: 'coach_field_masters',
  CoachCurriculumMaster: 'coach_curriculum_masters', CoachField: 'coach_fields', CoachCurriculum: 'coach_curriculums',
  CoachSchedule: 'coach_schedules', CoachScheduleAccessLog: 'coach_schedule_access_logs', CoachEngagement: 'coach_engagements',
  CoachEngagementSchedule: 'coach_engagement_schedules', CoachImportRun: 'coach_import_runs', CoachdbArchiveSnapshot: 'coachdb_archive_snapshots'
};
export const uuid = (n: number) => `aabbccdd-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Native stores logical null for both; PG seeder uses Prisma.JsonNull ONLY for this explicit ID.
export const JSON_NULL_RUN_ID = uuid(92);
const D = (value: string) => new Date(value);
export function seedRows(kind: FixtureCase = 'rich'): Record<Model, Row[]> {
  const empty = Object.fromEntries(Object.keys(MODEL_KEYS).map(model => [model, [] as Row[]])) as Record<Model, Row[]>;
  if (kind === 'empty') return empty;
  return {
    Coach: [
      { id: uuid(1), sourceCoachId: 'synthetic-coach-a', accessToken: 'synthetic-access-a', name: '합성코치 A', normalizedName: '합성코치a',
        workType: 'synthetic-work', status: 'ACTIVE', statusNote: 'synthetic-status', returnDate: D('2026-10-03T00:00:00.000Z'),
        selfNote: 'synthetic-self', portfolioUrl: 'https://example.invalid/synthetic', availabilityDetail: 'synthetic-availability',
        managerNote: 'synthetic-manager', dxTag: 'synthetic-dx', employeeNo: 'SYN-001', notionNo: 901, notionPageId: 'synthetic-notion-a',
        isActive: true, displayOrder: 7, createdAt: D('2026-09-01T01:02:03.004Z'), updatedAt: D('2026-09-02T02:03:04.005Z'), deletedAt: null, deletedBy: null },
      { id: uuid(2), sourceCoachId: 'synthetic-coach-b', accessToken: null, name: '합성코치 B', normalizedName: '합성코치b',
        workType: null, status: 'INACTIVE', statusNote: null, returnDate: null, selfNote: null, portfolioUrl: null, availabilityDetail: null,
        managerNote: null, dxTag: null, employeeNo: null, notionNo: null, notionPageId: null, isActive: false, displayOrder: null,
        createdAt: D('2026-09-01T01:02:03.004Z'), updatedAt: D('2026-09-02T02:03:04.005Z'), deletedAt: D('2026-09-03T03:04:05.006Z'), deletedBy: 'synthetic-deleter' }
    ],
    CoachPrivateProfile: [
      { coachId: uuid(1), employeeId: 'synthetic-employee', phone: '010-0000-0000', email: 'synthetic@example.invalid', birthDate: D('1990-01-02T00:00:00.000Z'), affiliation: '합성소속', createdAt: D('2026-09-01T01:02:03.004Z'), updatedAt: D('2026-09-02T02:03:04.005Z') },
      { coachId: uuid(2), employeeId: null, phone: null, email: null, birthDate: null, affiliation: null, createdAt: D('2026-09-01T01:02:03.004Z'), updatedAt: D('2026-09-02T02:03:04.005Z') }
    ],
    CoachFieldMaster: [{ id: uuid(11), name: '합성분야 A' }, { id: uuid(12), name: '합성분야 B' }],
    CoachCurriculumMaster: [{ id: uuid(21), name: '합성과정 A' }, { id: uuid(22), name: '합성과정 B' }],
    CoachField: [{ coachId: uuid(1), tagId: uuid(11) }, { coachId: uuid(1), tagId: uuid(12) }],
    CoachCurriculum: [{ coachId: uuid(1), tagId: uuid(21) }, { coachId: uuid(1), tagId: uuid(22) }],
    CoachSchedule: [{ id: uuid(31), sourceScheduleId: 'synthetic-schedule', coachId: uuid(1), date: D('2026-10-04T00:00:00.000Z'), startTime: '09:30', endTime: '17:45', updatedAt: D('2026-09-02T02:03:04.005Z') }],
    CoachScheduleAccessLog: [
      { id: uuid(41), sourceAccessLogId: 'synthetic-access-log', coachId: uuid(1), yearMonth: '2026-10', accessedAt: D('2026-09-01T01:02:03.004Z'), lastEditedAt: D('2026-09-02T02:03:04.005Z') },
      { id: uuid(42), sourceAccessLogId: null, coachId: uuid(2), yearMonth: '2026-10', accessedAt: D('2026-09-01T01:02:03.004Z'), lastEditedAt: null }
    ],
    CoachEngagement: [
      { id: uuid(51), sourceEngagementId: 'synthetic-engagement-a', coachId: uuid(1), operationSessionId: null, courseName: '합성업무 A', status: 'COMPLETED', source: 'SHEET', startDate: D('2026-10-04T00:00:00.000Z'), endDate: D('2026-10-05T00:00:00.000Z'), startTime: '09:30', endTime: '17:45', rating: 4, rehire: false, feedback: 'synthetic-feedback', reviewFlaggedAt: D('2026-09-03T03:04:05.006Z'), hiredById: 'synthetic-hired-id', hiredByText: 'synthetic-hired-text', createdAt: D('2026-09-01T01:02:03.004Z') },
      { id: uuid(52), sourceEngagementId: 'synthetic-engagement-b', coachId: uuid(2), operationSessionId: null, courseName: '합성업무 B', status: 'CANCELLED', source: 'MANUAL', startDate: D('2026-10-04T00:00:00.000Z'), endDate: D('2026-10-04T00:00:00.000Z'), startTime: null, endTime: null, rating: null, rehire: null, feedback: null, reviewFlaggedAt: null, hiredById: null, hiredByText: null, createdAt: D('2026-09-01T01:02:03.004Z') }
    ],
    CoachEngagementSchedule: [
      { id: uuid(61), sourceEngagementScheduleId: 'synthetic-engagement-schedule-a', engagementId: uuid(51), coachId: uuid(1), date: D('2026-10-04T00:00:00.000Z'), startTime: '09:30', endTime: '17:45', cancelledAt: null },
      { id: uuid(62), sourceEngagementScheduleId: 'synthetic-engagement-schedule-b', engagementId: uuid(52), coachId: uuid(2), date: D('2026-10-04T00:00:00.000Z'), startTime: '10:00', endTime: '11:00', cancelledAt: D('2026-09-03T03:04:05.006Z') }
    ],
    CoachImportRun: [
      { id: uuid(91), mode: 'dry_run', status: 'PENDING', coachCount: 0, engagementCount: 0, scheduleCount: 0, matchedOperationCount: 0, errorCount: 0, summary: null, notes: null, startedAt: D('2026-09-01T01:02:03.004Z'), finishedAt: null },
      { id: uuid(92), mode: 'apply', status: 'FAILED', coachCount: 2, engagementCount: 1, scheduleCount: 3, matchedOperationCount: 0, errorCount: 1, summary: null, notes: 'synthetic-run-notes', startedAt: D('2026-09-01T01:02:03.004Z'), finishedAt: D('2026-09-02T02:03:04.005Z') },
      { id: uuid(93), mode: 'apply', status: 'COMPLETED', coachCount: 2, engagementCount: 2, scheduleCount: 2, matchedOperationCount: 1, errorCount: 0, summary: { _id: 'user-json-id', codec: 'user-json-codec', namePiiIndex: 'user-json-index', nested: [null, false, 0, '합성'] }, notes: 'synthetic-completed-notes', startedAt: D('2026-09-01T01:02:03.004Z'), finishedAt: D('2026-09-02T02:03:04.005Z') },
      { id: uuid(94), mode: 'dry_run', status: 'COMPLETED_WITH_ERRORS', coachCount: 1, engagementCount: 0, scheduleCount: 0, matchedOperationCount: 0, errorCount: 2, summary: ['synthetic-array', null, 7, true, { _seq: 'user-json-sequence' }], notes: null, startedAt: D('2026-09-01T01:02:03.004Z'), finishedAt: D('2026-09-02T02:03:04.005Z') }
    ],
    CoachdbArchiveSnapshot: Array.from({ length: 22 }, (_, i) => ({
      id: uuid(200 + i), sourceDatabase: 'synthetic-hidden-database', sourceSchema: 'synthetic-hidden-schema', tableCount: i, rowCount: i * 3,
      status: i % 2 === 0 ? 'running' : 'failed', errorMessage: 'synthetic-hidden-error',
      startedAt: D(`2026-09-${String(kind === 'ties' && i < 3 ? 3 : i + 1).padStart(2, '0')}T00:00:00.000Z`),
      finishedAt: i % 2 === 0 ? null : D('2026-09-30T04:05:06.007Z')
    }))
  };
}

/** Independently authored response literals: no seedRows, mapper, repository, codec or schema introspection. */
export function expectedResponseData(kind: FixtureCase = 'rich'): ResponseData {
  if (kind === 'empty') return { coaches: [], privateProfiles: [], fields: [], curriculums: [], coachFields: [], coachCurriculums: [], schedules: [], scheduleAccessLogs: [], engagements: [], engagementSchedules: [], importRuns: [], archiveSnapshots: [] };
  return {
    coaches: [
      { id: uuid(1), sourceCoachId: 'synthetic-coach-a', accessToken: 'synthetic-access-a', name: '합성코치 A', normalizedName: '합성코치a', workType: 'synthetic-work', status: 'ACTIVE', statusNote: 'synthetic-status', returnDate: '2026-10-03T00:00:00.000Z', selfNote: 'synthetic-self', portfolioUrl: 'https://example.invalid/synthetic', availabilityDetail: 'synthetic-availability', managerNote: 'synthetic-manager', dxTag: 'synthetic-dx', employeeNo: 'SYN-001', notionNo: 901, notionPageId: 'synthetic-notion-a', isActive: true, displayOrder: 7, createdAt: '2026-09-01T01:02:03.004Z', updatedAt: '2026-09-02T02:03:04.005Z', deletedAt: null, deletedBy: null },
      { id: uuid(2), sourceCoachId: 'synthetic-coach-b', accessToken: null, name: '합성코치 B', normalizedName: '합성코치b', workType: null, status: 'INACTIVE', statusNote: null, returnDate: null, selfNote: null, portfolioUrl: null, availabilityDetail: null, managerNote: null, dxTag: null, employeeNo: null, notionNo: null, notionPageId: null, isActive: false, displayOrder: null, createdAt: '2026-09-01T01:02:03.004Z', updatedAt: '2026-09-02T02:03:04.005Z', deletedAt: '2026-09-03T03:04:05.006Z', deletedBy: 'synthetic-deleter' }
    ],
    privateProfiles: [
      { coachId: uuid(1), employeeId: 'synthetic-employee', phone: '010-0000-0000', email: 'synthetic@example.invalid', birthDate: '1990-01-02T00:00:00.000Z', affiliation: '합성소속', createdAt: '2026-09-01T01:02:03.004Z', updatedAt: '2026-09-02T02:03:04.005Z' },
      { coachId: uuid(2), employeeId: null, phone: null, email: null, birthDate: null, affiliation: null, createdAt: '2026-09-01T01:02:03.004Z', updatedAt: '2026-09-02T02:03:04.005Z' }
    ],
    fields: [{ id: uuid(11), name: '합성분야 A' }, { id: uuid(12), name: '합성분야 B' }],
    curriculums: [{ id: uuid(21), name: '합성과정 A' }, { id: uuid(22), name: '합성과정 B' }],
    coachFields: [{ coachId: uuid(1), tagId: uuid(11) }, { coachId: uuid(1), tagId: uuid(12) }],
    coachCurriculums: [{ coachId: uuid(1), tagId: uuid(21) }, { coachId: uuid(1), tagId: uuid(22) }],
    schedules: [{ id: uuid(31), sourceScheduleId: 'synthetic-schedule', coachId: uuid(1), date: '2026-10-04T00:00:00.000Z', startTime: '09:30', endTime: '17:45', updatedAt: '2026-09-02T02:03:04.005Z' }],
    scheduleAccessLogs: [
      { id: uuid(41), sourceAccessLogId: 'synthetic-access-log', coachId: uuid(1), yearMonth: '2026-10', accessedAt: '2026-09-01T01:02:03.004Z', lastEditedAt: '2026-09-02T02:03:04.005Z' },
      { id: uuid(42), sourceAccessLogId: null, coachId: uuid(2), yearMonth: '2026-10', accessedAt: '2026-09-01T01:02:03.004Z', lastEditedAt: null }
    ],
    engagements: [
      { id: uuid(51), sourceEngagementId: 'synthetic-engagement-a', coachId: uuid(1), operationSessionId: null, courseName: '합성업무 A', status: 'COMPLETED', source: 'SHEET', startDate: '2026-10-04T00:00:00.000Z', endDate: '2026-10-05T00:00:00.000Z', startTime: '09:30', endTime: '17:45', rating: 4, rehire: false, feedback: 'synthetic-feedback', reviewFlaggedAt: '2026-09-03T03:04:05.006Z', hiredById: 'synthetic-hired-id', hiredByText: 'synthetic-hired-text', createdAt: '2026-09-01T01:02:03.004Z' },
      { id: uuid(52), sourceEngagementId: 'synthetic-engagement-b', coachId: uuid(2), operationSessionId: null, courseName: '합성업무 B', status: 'CANCELLED', source: 'MANUAL', startDate: '2026-10-04T00:00:00.000Z', endDate: '2026-10-04T00:00:00.000Z', startTime: null, endTime: null, rating: null, rehire: null, feedback: null, reviewFlaggedAt: null, hiredById: null, hiredByText: null, createdAt: '2026-09-01T01:02:03.004Z' }
    ],
    engagementSchedules: [
      { id: uuid(61), sourceEngagementScheduleId: 'synthetic-engagement-schedule-a', engagementId: uuid(51), coachId: uuid(1), date: '2026-10-04T00:00:00.000Z', startTime: '09:30', endTime: '17:45', cancelledAt: null },
      { id: uuid(62), sourceEngagementScheduleId: 'synthetic-engagement-schedule-b', engagementId: uuid(52), coachId: uuid(2), date: '2026-10-04T00:00:00.000Z', startTime: '10:00', endTime: '11:00', cancelledAt: '2026-09-03T03:04:05.006Z' }
    ],
    importRuns: [
      { id: uuid(91), mode: 'dry_run', status: 'PENDING', coachCount: 0, engagementCount: 0, scheduleCount: 0, matchedOperationCount: 0, errorCount: 0, summary: null, notes: null, startedAt: '2026-09-01T01:02:03.004Z', finishedAt: null },
      { id: uuid(92), mode: 'apply', status: 'FAILED', coachCount: 2, engagementCount: 1, scheduleCount: 3, matchedOperationCount: 0, errorCount: 1, summary: null, notes: 'synthetic-run-notes', startedAt: '2026-09-01T01:02:03.004Z', finishedAt: '2026-09-02T02:03:04.005Z' },
      { id: uuid(93), mode: 'apply', status: 'COMPLETED', coachCount: 2, engagementCount: 2, scheduleCount: 2, matchedOperationCount: 1, errorCount: 0, summary: { _id: 'user-json-id', codec: 'user-json-codec', namePiiIndex: 'user-json-index', nested: [null, false, 0, '합성'] }, notes: 'synthetic-completed-notes', startedAt: '2026-09-01T01:02:03.004Z', finishedAt: '2026-09-02T02:03:04.005Z' },
      { id: uuid(94), mode: 'dry_run', status: 'COMPLETED_WITH_ERRORS', coachCount: 1, engagementCount: 0, scheduleCount: 0, matchedOperationCount: 0, errorCount: 2, summary: ['synthetic-array', null, 7, true, { _seq: 'user-json-sequence' }], notes: null, startedAt: '2026-09-01T01:02:03.004Z', finishedAt: '2026-09-02T02:03:04.005Z' }
    ],
    archiveSnapshots: expectedSnapshots(kind)
  };
}
// Independent mathematical fixture specification; never consumes seedRows or stored rows.
export function expectedSnapshots(kind: FixtureCase): Row[] {
  if (kind === 'empty') return [];
  return Array.from({ length: kind === 'ties' ? 22 : 20 }, (_, offset) => {
    const rank = 21 - offset;
    return { id: uuid(200 + rank), table_count: rank, row_count: rank * 3, status: rank % 2 === 0 ? 'running' : 'failed',
      started_at: `2026-09-${String(kind === 'ties' && rank < 3 ? 3 : rank + 1).padStart(2, '0')}T00:00:00.000Z`,
      finished_at: rank % 2 === 0 ? null : '2026-09-30T04:05:06.007Z' };
  });
}
function key(name: string, row: Row) {
  const value = name === 'coachFields' || name === 'coachCurriculums' ? [row.coachId, row.tagId] : [name === 'privateProfiles' ? row.coachId : row.id];
  assert.ok(value.every(v => typeof v === 'string'), 'BACKUP_ROW_KEY_REQUIRED');
  return JSON.stringify(value);
}
function sorted(name: string, rows: Row[]) {
  const keys = rows.map(row => key(name, row));
  assert.equal(new Set(keys).size, rows.length, 'BACKUP_DUPLICATE_KEY');
  return [...rows].sort((a, b) => key(name, a) < key(name, b) ? -1 : key(name, a) > key(name, b) ? 1 : 0);
}
export function checkResponseData(actual: ResponseData, kind: FixtureCase = 'rich') {
  const expected = expectedResponseData(kind);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'BACKUP_DATA_KEYS');
  for (const name of Object.keys(expected)) {
    assert.ok(Array.isArray(actual[name]), 'BACKUP_ARRAY_REQUIRED');
    if (name !== 'archiveSnapshots') assert.deepEqual(sorted(name, actual[name]), sorted(name, expected[name]), 'BACKUP_WHOLE_ROWS');
  }
  const snapshots = actual.archiveSnapshots;
  sorted('archiveSnapshots', snapshots); // uniqueness, independent of order assertion
  if (kind !== 'ties') assert.deepEqual(snapshots, expected.archiveSnapshots, 'BACKUP_RECENT20_LITERAL');
  else {
    assert.equal(snapshots.length, 20);
    const pool = expectedSnapshots('ties');
    for (let i = 0; i < snapshots.length; i++) {
      assert.deepEqual(snapshots[i], pool.find(row => row.id === snapshots[i].id), 'BACKUP_SNAPSHOT_WHOLE_ROW');
      if (i) assert.ok(String(snapshots[i - 1].started_at) >= String(snapshots[i].started_at), 'BACKUP_SNAPSHOT_ORDER');
    }
    // All 19 strictly newer rows are mandatory; the remaining slot may be any of the three ties.
    for (const row of pool.slice(0, 19)) assert.ok(snapshots.some(actual => actual.id === row.id), 'BACKUP_MISSING_NEWER_ROW');
  }
}
export function checkBody(body: unknown, kind: FixtureCase, before: number, after: number) {
  const value = body as { exportedAt: string; counts: Record<string, number>; data: ResponseData };
  assert.deepEqual(Object.keys(value).sort(), ['counts', 'data', 'exportedAt']);
  const time = Date.parse(value.exportedAt);
  assert.equal(new Date(time).toISOString(), value.exportedAt);
  assert.ok(time >= before && time <= after, 'BACKUP_EXPORT_CLOCK');
  checkResponseData(value.data, kind);
  assert.deepEqual(value.counts, Object.fromEntries(Object.entries(value.data).map(([name, rows]) => [name, rows.length])));
}
export function comparatorNegatives() {
  const valid = expectedResponseData('rich'); checkResponseData(valid);
  const mutations: ((data: ResponseData) => void)[] = [
    d => { d.coaches.pop(); }, d => { d.coaches.push({ ...d.coaches[0], id: uuid(999) }); },
    d => { d.coachFields.push({ ...d.coachFields[0] }); }, d => { d.coaches[0].namePiiIndex = 'hidden'; },
    d => { d.privateProfiles[0].birthDate = null; }, d => { d.archiveSnapshots.reverse(); },
    d => { d.archiveSnapshots[19] = { ...d.archiveSnapshots[19], id: uuid(200) }; },
    d => { delete (d.importRuns[2].summary as Row)._id; }
  ];
  for (const mutate of mutations) { const copy = structuredClone(valid); mutate(copy); assert.throws(() => checkResponseData(copy)); }
  const tieValid = expectedResponseData('ties'); tieValid.archiveSnapshots = tieValid.archiveSnapshots.slice(0, 20);
  checkResponseData(tieValid, 'ties');
  const tieWrong = structuredClone(tieValid); tieWrong.archiveSnapshots[0] = expectedSnapshots('ties')[21];
  assert.throws(() => checkResponseData(tieWrong, 'ties'));
  const validBody = { exportedAt: '2026-09-30T00:00:00.000Z', data: valid, counts: Object.fromEntries(Object.entries(valid).map(([k, v]) => [k, v.length])) };
  checkBody(validBody, 'rich', Date.parse(validBody.exportedAt), Date.parse(validBody.exportedAt));
  const bad = structuredClone(validBody); bad.counts.coaches++;
  assert.throws(() => checkBody(bad, 'rich', Date.parse(bad.exportedAt), Date.parse(bad.exportedAt)));
}
