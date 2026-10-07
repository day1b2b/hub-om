import { BSON, MongoClient } from "mongodb";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const REPAIR_ROUTE = "/maintenance/om-request-session-repair";
const CREATE_ROUTE = "/api/om-request";
const check = (value, code) => { if (!value) throw new Error(code); };
const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : "";
const digest = value => createHash("sha256").update(BSON.serialize(value)).digest("hex");
const idKey = value => typeof value === "string" ? value : BSON.EJSON.stringify(value, { relaxed: false });
const operationSnapshot = row => ({
  id: idKey(row._id), operationId: String(row.operationId ?? ""), courseRecordId: idKey(row.courseRecordId),
  startDate: day(row.startDate), endDate: day(row.endDate), deletedAt: row.deletedAt instanceof Date ? row.deletedAt.toISOString() : null,
  roundNo: row.roundNo == null ? null : String(row.roundNo)
});
const operationFingerprint = row => createHash("sha256").update(JSON.stringify(operationSnapshot(row))).digest("hex");

function decrypt(value, context, env) {
  const parts = String(value ?? "").split(":");
  check(parts.length === 6 && parts[0] === "pii", "ENCRYPTED_VALUE_REQUIRED");
  const keys = JSON.parse(env.PII_ENCRYPTION_KEYS);
  check(typeof keys[parts[2]] === "string", "PII_KEY_MISSING");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keys[parts[2]], "base64"), Buffer.from(parts[3], "base64url"));
  decipher.setAAD(Buffer.from(`pii:v1:${parts[2]}:${context}`));
  decipher.setAuthTag(Buffer.from(parts[4], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[5], "base64url")), decipher.final()]).toString();
}

function encrypt(value, context, env) {
  const key = env.PII_ACTIVE_KEY_ID;
  const keys = JSON.parse(env.PII_ENCRYPTION_KEYS);
  check(key && typeof keys[key] === "string", "PII_ACTIVE_KEY_MISSING");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keys[key], "base64"), nonce);
  cipher.setAAD(Buffer.from(`pii:v1:${key}:${context}`));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return `pii:v1:${key}:${nonce.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function sessionsOf(request, env) {
  const value = request?.sessions?.$json?.__pii;
  const sessions = JSON.parse(decrypt(value, "OmRequest.sessions", env));
  check(Array.isArray(sessions), "INVALID_SESSIONS");
  return sessions;
}

/** Select only a complete, unambiguous, already-existing set. Never infer by names. */
export function planExistingLinks(request, operations, sessions) {
  check(Number.isInteger(request.totalSessions) && request.totalSessions > 0, "INVALID_TOTAL_SESSIONS");
  check(sessions.length === request.totalSessions, "INVALID_SESSION_COUNT");
  check(typeof request.operationId === "string" && request.operationId, "REPRESENTATIVE_MISSING");
  const representative = operations.find(row => row.operationId === request.operationId && !row.deletedAt);
  check(representative, "REPRESENTATIVE_MISSING");
  const course = operations.filter(row => row.courseRecordId === representative.courseRecordId && !row.deletedAt);
  const selected = sessions.map((entry, index) => {
    check(entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.date), "INVALID_SESSION_DATE");
    const end = entry.dateEnd || entry.date;
    check(/^\d{4}-\d{2}-\d{2}$/.test(end), "INVALID_SESSION_END_DATE");
    const matches = course.filter(row => day(row.startDate) === entry.date && day(row.endDate) === end);
    check(matches.length === 1, matches.length ? "AMBIGUOUS_OPERATION" : "OPERATION_NOT_FOUND");
    return { ...matches[0], expectedRoundNo: String(index + 1) };
  });
  check(new Set(selected.map(row => idKey(row._id))).size === request.totalSessions, "DUPLICATE_OPERATION");
  check(selected.some(row => row.operationId === request.operationId), "REPRESENTATIVE_EXCLUDED");
  return selected;
}

function audit(batch, targetType, targetId, changes, env) {
  return {
    _id: randomUUID(), occurredAt: new Date(), requestId: batch,
    actorEmail: null, actorName: null, actorType: "system",
    route: REPAIR_ROUTE, method: "POST", targetType, targetId, action: "link",
    changes: { $json: { __pii: encrypt(JSON.stringify(changes), "ActivityChange.changes", env) } },
    actorEmailPiiIndex: null, actorNamePiiIndex: null
  };
}

function collectionScope(client, env) {
  check(env.MONGODB_URI && env.MONGODB_SHADOW_DATABASE && env.MONGODB_SHADOW_NAMESPACE, "MONGO_SCOPE_REQUIRED");
  check(env.PII_ENCRYPTION_KEYS && env.PII_ACTIVE_KEY_ID, "PII_CONFIGURATION_REQUIRED");
  const db = client.db(env.MONGODB_SHADOW_DATABASE);
  const collection = name => db.collection(`${env.MONGODB_SHADOW_NAMESPACE}_${name}`);
  return { db, collection };
}

async function creationLinks(collection, request) {
  const repairs = await collection("ActivityChange").find({ targetType: "om_requests", targetId: request._id,
    route: REPAIR_ROUTE, method: "POST", action: "link" }).toArray();
  if (repairs.length) return { kind: "repair", count: repairs.length, operationIds: [] };
  const origins = await collection("ActivityChange").find({ targetType: "om_requests", targetId: request._id,
    route: CREATE_ROUTE, method: "POST", action: "create" }).toArray();
  if (origins.length !== 1) return { kind: "invalid-origin", count: origins.length, operationIds: [] };
  const linked = await collection("ActivityChange").find({ requestId: origins[0].requestId,
    route: CREATE_ROUTE, method: "POST", action: "create", targetType: "operation_sessions" }).toArray();
  return { kind: "create", count: linked.length, operationIds: linked.map(row => row.targetId) };
}

export async function diagnoseExistingLinks(client, env) {
  const { collection } = collectionScope(client, env);
  const requests = await collection("OmRequest").find({ operationId: { $type: "string" } }).toArray();
  const operations = await collection("OperationSession").find({}).toArray();
  const result = { scanned: requests.length, healthy: 0, repaired: 0, exactRepairable: 0, blocked: 0, blockedReasons: {}, targets: [] };
  for (const request of requests) {
    const links = await creationLinks(collection, request);
    if (links.kind === "repair") { result.repaired++; continue; }
    const representative = operations.find(row => row.operationId === request.operationId);
    if (links.kind === "create" && links.count === request.totalSessions && new Set(links.operationIds).size === request.totalSessions &&
      representative && links.operationIds.includes(representative._id)) {
      result.healthy++; continue;
    }
    try {
      const selected = planExistingLinks(request, operations, sessionsOf(request, env));
      result.exactRepairable++;
      result.targets.push({ requestId: request._id, requestDigest: digest(request), operationIds: selected.map(row => row._id),
        operationKeys: selected.map(row => idKey(row._id)), operationDigests: selected.map(operationFingerprint), previousLinkCount: links.count });
    } catch (error) {
      result.blocked++;
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "UNKNOWN";
      result.blockedReasons[code] = (result.blockedReasons[code] ?? 0) + 1;
    }
  }
  return result;
}

export async function repairExactExistingLinks(client, env, targets) {
  const { db, collection } = collectionScope(client, env);
  const existingCollections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name));
  check(existingCollections.has(`${env.MONGODB_SHADOW_NAMESPACE}_MaintenanceBackup`), "MAINTENANCE_BACKUP_REQUIRED");
  const repaired = [];
  for (const target of targets) {
    const session = client.startSession();
    try {
      const outcome = await session.withTransaction(async () => {
        const guard = await collection("CourseNameRestoreGuard").updateOne({ _id: "restore" }, { $set: { nonce: randomUUID() } }, { session });
        check(guard.matchedCount === 1, "ASSIGNMENT_GUARD_MISSING");
        const request = await collection("OmRequest").findOne({ _id: target.requestId }, { session });
        check(request && digest(request) === target.requestDigest, "REQUEST_CHANGED");
        const operations = await collection("OperationSession").find({ _id: { $in: target.operationIds } }, { session }).toArray();
        check(operations.length === target.operationIds.length, "OPERATION_DISAPPEARED");
        for (const row of operations) {
          const expected = target.operationDigests[target.operationKeys.indexOf(idKey(row._id))];
          check(expected && operationFingerprint(row) === expected, "OPERATION_CHANGED");
        }
        check(await collection("ActivityChange").countDocuments({ targetType: "om_requests", targetId: request._id,
          route: REPAIR_ROUTE, method: "POST", action: "link" }, { session }) === 0, "ALREADY_REPAIRED");
        const sessions = sessionsOf(request, env);
        const selected = planExistingLinks(request, operations, sessions);
        check(selected.length === request.totalSessions, "REPAIR_PLAN_CHANGED");
        const backupId = randomUUID();
        const payload = BSON.EJSON.stringify({ request, operations, previousLinkCount: target.previousLinkCount }, { relaxed: false });
        await collection("MaintenanceBackup").insertOne({ _id: backupId, requestId: request._id, createdAt: new Date(),
          kind: "om-request-existing-links", payload, sha256: createHash("sha256").update(payload).digest("hex") }, { session });
        const batch = randomUUID();
        await collection("ActivityChange").insertMany([
          audit(batch, "om_requests", request._id, { repair: { backupId, count: selected.length, reason: "exact existing session links" } }, env),
          ...selected.map(row => audit(batch, "operation_sessions", row._id, { repair: { backupId, requestId: request._id } }, env))
        ], { session });
        const refreshed = { $json: { __pii: encrypt(JSON.stringify(sessions), "OmRequest.sessions", env) } };
        const touched = await collection("OmRequest").updateOne({ _id: request._id }, { $set: { sessions: refreshed } }, { session });
        check(touched.matchedCount === 1, "REQUEST_DISAPPEARED");
        return { requestId: request._id, backupId, count: selected.length };
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
      repaired.push(outcome);
    } finally { await session.endSession(); }
  }
  return repaired;
}

async function main() {
  const mode = process.argv[2] ?? "--diagnose";
  check(["--diagnose", "--apply-exact"].includes(mode), "EXPLICIT_MODE_REQUIRED");
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const diagnosis = await diagnoseExistingLinks(client, process.env);
    if (mode === "--diagnose") {
      console.log(JSON.stringify({ scanned: diagnosis.scanned, healthy: diagnosis.healthy, repaired: diagnosis.repaired,
        exactRepairable: diagnosis.exactRepairable, blocked: diagnosis.blocked, blockedReasons: diagnosis.blockedReasons }));
      return;
    }
    const repaired = await repairExactExistingLinks(client, process.env, diagnosis.targets);
    const after = await diagnoseExistingLinks(client, process.env);
    console.log(JSON.stringify({ repaired: repaired.length, remainingExact: after.exactRepairable, blocked: after.blocked }));
  } finally { await client.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error("OM_LINK_REPAIR_FAILED", /^[A-Z_]+$/.test(error.message) ? error.message : error.name); process.exitCode = 1; });
}
