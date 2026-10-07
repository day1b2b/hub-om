import { MongoClient, BSON } from 'mongodb';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const REPAIR_ROUTE = '/maintenance/om-request-session-repair';
const check = (ok, message) => { if (!ok) throw new Error(message); };
const day = date => date.toISOString().slice(0, 10);
const digest = row => createHash('sha256').update(BSON.serialize(row)).digest('hex');
const dateAt = value => new Date(`${value}T00:00:00.000Z`);
function datesForSession(session) {
  const start = dateAt(session.date), end = dateAt(session.dateEnd || session.date);
  check(Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start <= end, 'INVALID_DATE');
  const explicit = [...new Set(String(session.educationDatesText ?? '').match(/\d{4}-\d{2}-\d{2}/g) ?? [])];
  if (explicit.length) {
    const values = explicit.map(dateAt);
    check(values.every(value => Number.isFinite(value.getTime()) && start <= value && value <= end), 'EDUCATION_DATE_OUT_OF_RANGE');
    return values;
  }
  check(!session.educationDatesText?.trim() || start.getTime() === end.getTime(), 'UNPARSEABLE_EDUCATION_DATES');
  const values = [];
  for (let value = start; value <= end; value = new Date(value.getTime() + 86_400_000)) values.push(value);
  return values;
}
function decrypt(value, context, env) {
  const parts = value.split(':');
  check(parts.length === 6 && parts[0] === 'pii', 'ENCRYPTED_VALUE_REQUIRED');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(JSON.parse(env.PII_ENCRYPTION_KEYS)[parts[2]], 'base64'), Buffer.from(parts[3], 'base64url'));
  decipher.setAAD(Buffer.from(`pii:v1:${parts[2]}:${context}`));
  decipher.setAuthTag(Buffer.from(parts[4], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[5], 'base64url')), decipher.final()]).toString();
}
function encrypt(value, context, env) {
  const key = env.PII_ACTIVE_KEY_ID, nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(JSON.parse(env.PII_ENCRYPTION_KEYS)[key], 'base64'), nonce);
  cipher.setAAD(Buffer.from(`pii:v1:${key}:${context}`));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return `pii:v1:${key}:${nonce.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}
function privateField(row, name, value, env) {
  const context = `OperationSession.${name}`;
  row[name] = value ? encrypt(value, context, env) : null;
  row[`${name}PiiIndex`] = value ? createHmac('sha256', Buffer.from(env.PII_INDEX_KEY, 'base64')).update(context).update('\0').update(value).digest('hex') : null;
}

/** Narrow repair: split unassigned date ranges into explicitly requested single days. */
export function planSessionSplit(request, operations, sessions, env, now = new Date(), options = {}) {
  const allowAssigned = options.allowAssigned === true;
  const allowOutOfRange = options.allowOutOfRange === true;
  if (!allowAssigned) check(request.assignedOm === null && request.status === '배정필요', 'REQUEST_ALREADY_ASSIGNED');
  else check(['배정필요', '배정완료'].includes(request.status), 'REQUEST_STATUS_UNSAFE');
  check(Array.isArray(sessions) && sessions.length === request.totalSessions && sessions.length > operations.length && operations.length > 0, 'INVALID_SESSION_COUNT');
  check(new Set(sessions.map(s => s.date)).size === sessions.length, 'DUPLICATE_DATES');
  check(new Set(operations.map(o => o.courseRecordId)).size === 1, 'MIXED_COURSES');
  check(operations.some(o => o.operationId === request.operationId), 'REPRESENTATIVE_MISSING');
  for (const row of operations) {
    check(!row.deletedAt && (allowAssigned
      ? ['ASSIGNMENT_NEEDED', 'ASSIGNMENT_PLANNED'].includes(row.operationStatus)
      : row.operationStatus === 'ASSIGNMENT_NEEDED' && row.omName === null && row.omUserId === null), 'OPERATION_ALREADY_USED');
    check(!row.sourceFingerprint, 'IMPORTED_OPERATION');
    check(['totalCost', 'instructorCost', 'operationCost'].every(key => row[key] === null || Number(String(row[key])) === 0), 'FINANCIAL_DATA_PRESENT');
    check(sessions.filter(s => s.date === day(row.startDate)).length === 1, 'ORIGINAL_START_NOT_RETAINED');
  }
  const seen = new Set();
  const ordered = [...operations].sort((left, right) => Number(left.roundNo) - Number(right.roundNo));
  const hasStableRounds = ordered.every((row, index) => String(row.roundNo) === String(index + 1));
  const assignmentKey = row => JSON.stringify({ operationStatus: row.operationStatus, omUserId: row.omUserId ?? null,
    omName: row.omName ? decrypt(row.omName, 'OperationSession.omName', env) : null });
  const intervals = sessions.map(s => ({ start: dateAt(s.date), end: dateAt(s.dateEnd || s.date) }));
  check(intervals.every((value, index) => intervals.every((other, otherIndex) => index === otherIndex || value.end < other.start || other.end < value.start)), 'OVERLAPPING_REQUEST_SESSIONS');
  const planned = sessions.map((s, index) => {
    check(/^\d{4}-\d{2}-\d{2}$/.test(s.date) && (!s.dateEnd || /^\d{4}-\d{2}-\d{2}$/.test(s.dateEnd)), 'INVALID_DATE');
    const date = dateAt(s.date), endDate = dateAt(s.dateEnd || s.date), educationDates = datesForSession(s);
    check(Number.isFinite(date.getTime()) && day(date) === s.date && day(endDate) === (s.dateEnd || s.date), 'INVALID_DATE');
    const indexed = ordered[index];
    let candidates = operations.filter(o => o.startDate <= date && endDate <= o.endDate);
    if (candidates.length === 0 && allowOutOfRange) {
      check(hasStableRounds && new Set(operations.map(assignmentKey)).size === 1, 'SOURCE_RANGE_NOT_FOUND');
      candidates = indexed ? [indexed] : [ordered.at(-1)];
    }
    check(candidates.length > 0 && candidates[0], 'SOURCE_RANGE_NOT_FOUND');
    if (candidates.length > 1) {
      check(hasStableRounds, 'AMBIGUOUS_SOURCE_RANGE');
      check(new Set(candidates.map(assignmentKey)).size === 1, 'AMBIGUOUS_ASSIGNMENT_SOURCE');
    }
    const source = indexed && candidates.includes(indexed) ? indexed : candidates.find(row => !seen.has(row._id)) ?? candidates[0];
    const reuse = !seen.has(source._id) && (day(source.startDate) === s.date || allowOutOfRange || candidates.length > 1);
    const next = { ...source, _id: reuse ? source._id : randomUUID(), operationId: reuse ? source.operationId : `manual-${randomUUID()}`,
      roundNo: String(index + 1), startDate: date, endDate, educationDates, operationMonth: s.date.slice(0, 7),
      sessionDurationDays: educationDates.length, educationDays: s.duration || null, timeText: s.timeStart && s.timeEnd ? `${s.timeStart} ~ ${s.timeEnd}` : null,
      createdAt: reuse ? source.createdAt : now, updatedAt: now };
    privateField(next, 'region', s.location || '', env);
    privateField(next, 'updatedBy', 'approved-session-repair', env);
    if (!reuse) privateField(next, 'createdBy', 'approved-session-repair', env);
    if (reuse) seen.add(source._id);
    return { before: reuse ? source : null, after: next };
  });
  check(seen.size === operations.length, 'ORIGINAL_OPERATION_LOST');
  return planned;
}
function audit(batch, targetType, targetId, action, changes, env) {
  return { _id: randomUUID(), occurredAt: new Date(), requestId: batch, actorEmail: null, actorName: null, actorType: 'system',
    route: REPAIR_ROUTE, method: 'POST', targetType, targetId, action,
    changes: { $json: { __pii: encrypt(JSON.stringify(changes), 'ActivityChange.changes', env) } }, actorEmailPiiIndex: null, actorNamePiiIndex: null };
}

export async function repairFromBackup(client, env, requestId, backupId, apply = false) {
  check(requestId && backupId && env.MONGODB_SHADOW_DATABASE && env.MONGODB_SHADOW_NAMESPACE, 'EXPLICIT_TARGET_REQUIRED');
  const db = client.db(env.MONGODB_SHADOW_DATABASE), prefix = `${env.MONGODB_SHADOW_NAMESPACE}_`, collection = name => db.collection(prefix + name);
  const backup = await collection('MaintenanceBackup').findOne({ _id: backupId, requestId });
  check(backup && createHash('sha256').update(backup.payload).digest('hex') === backup.sha256, 'BACKUP_INVALID');
  const original = BSON.EJSON.parse(backup.payload, { relaxed: false });
  const session = client.startSession();
  const batch = randomUUID();
  try {
    return await session.withTransaction(async () => {
      if (apply) {
        const locked = await collection('CourseNameRestoreGuard').updateOne({ _id: 'restore' }, { $set: { nonce: randomUUID() } }, { session });
        check(locked.matchedCount === 1, 'ASSIGNMENT_GUARD_MISSING');
      }
      const request = await collection('OmRequest').findOne({ _id: requestId }, { session });
      check(request && digest(request) === digest(original.request), 'REQUEST_CHANGED_SINCE_BACKUP');
      const ids = original.operations.map(o => o._id);
      const operations = await collection('OperationSession').find({ _id: { $in: ids } }, { session }).toArray();
      check(operations.length === ids.length && operations.every(o => digest(o) === digest(original.operations.find(b => b._id === o._id))), 'OPERATIONS_CHANGED_SINCE_BACKUP');
      check(await collection('ActivityChange').countDocuments({ targetId: requestId, route: REPAIR_ROUTE, action: 'link' }, { session }) === 0, 'ALREADY_REPAIRED');
      check(await collection('CoachEngagement').countDocuments({ operationSessionId: { $in: ids } }, { session }) === 0, 'COACH_DEPENDENCY');
      check(await collection('OperationSourceRecord').countDocuments({ operationSessionId: { $in: ids } }, { session }) === 0, 'SOURCE_DEPENDENCY');
      const sessions = JSON.parse(decrypt(request.sessions.$json.__pii, 'OmRequest.sessions', env));
      const plan = planSessionSplit(request, operations, sessions, env, new Date(), { allowAssigned: true, allowOutOfRange: true });
      const summary = { apply, requestId, backupId, retained: operations.length, inserted: plan.length - operations.length,
        rounds: plan.map(p => ({ roundNo: p.after.roundNo, date: day(p.after.startDate), operationId: p.after.operationId })) };
      if (!apply) return summary;
      for (const row of plan) {
        if (row.before) {
          const result = await collection('OperationSession').replaceOne({ _id: row.before._id }, row.after, { session });
          check(result.matchedCount === 1, 'OPERATION_DISAPPEARED');
        } else await collection('OperationSession').insertOne(row.after, { session });
        await collection('ActivityChange').insertOne(audit(batch, 'operation_sessions', row.after._id, row.before ? 'update' : 'create', {
          repair: { reason: 'approved request session split', backupId },
          round_no: { before: row.before?.roundNo ?? null, after: row.after.roundNo },
          start_date: { before: row.before ? day(row.before.startDate) : null, after: day(row.after.startDate) },
          end_date: { before: row.before ? day(row.before.endDate) : null, after: day(row.after.endDate) }
        }, env), { session });
      }
      await collection('ActivityChange').insertMany([
        audit(batch, 'om_requests', requestId, 'link', { repair: { backupId, count: plan.length } }, env),
        ...plan.map(row => audit(batch, 'operation_sessions', row.after._id, 'link', { repair: { backupId, requestId } }, env))
      ], { session });
      // Fresh ciphertext forces a real write, conflicting with concurrent request edits.
      // The authenticated logical schedule stays identical.
      const touched = await collection('OmRequest').updateOne({ _id: requestId }, {
        $set: { sessions: { $json: { __pii: encrypt(JSON.stringify(sessions), 'OmRequest.sessions', env) } } }
      }, { session });
      check(touched.matchedCount === 1, 'REQUEST_DISAPPEARED');
      return { ...summary, repairBatch: batch };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', j: true }, readPreference: 'primary', timeoutMS: 30000 });
  } finally { await session.endSession(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [requestId, backupId, mode] = process.argv.slice(2);
  check(mode === '--dry-run' || mode === '--apply', 'EXPLICIT_MODE_REQUIRED');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try { await client.connect(); console.log(JSON.stringify(await repairFromBackup(client, process.env, requestId, backupId, mode === '--apply'))); }
  catch (error) { console.error('SESSION_REPAIR_FAILED', /^[A-Z_]+$/.test(error.message) ? error.message : error.name); process.exitCode = 1; }
  finally { await client.close(); }
}
