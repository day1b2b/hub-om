import { randomUUID } from "node:crypto";
import { activityContext } from "../activity/context";
import policies from "../privacy/fields.json" with { type: "json" };
import { completeMongoRow, stableMongoValue, type MongoRow } from "./mongoOperationStore";
import { mongoRuntimeContracts } from "./mongoRuntimeCodec";

const excluded = new Set(["id", "createdAt", "updatedAt", "createdBy", "updatedBy", "deletedBy", "normalizedName", "sourceFingerprint", "validationErrors"]);
const allowed: Record<string, Set<string>> = {
  CalendarEventLink: new Set(["operationId", "eventDate"]),
  OmRequest: new Set(["status", "operationId", "team", "company", "trainingType", "courseId", "courseName", "courseCategoryMajor", "courseCategory", "skillfloSetup", "skillmatchSetup", "onSiteOperation", "coachRequest", "resultReportNeeded", "totalSessions"]),
  Company: new Set(["name"]),
  Announcement: new Set(),
  AnnouncementAttachment: new Set(["announcementId", "mimeType", "size"]),
  Member: new Set(["role", "sourceTeam"]),
  Course: new Set(["companyId", "courseId", "name", "operationType", "courseCategory", "revenue"]),
  CourseIdLabel: new Set(["companyId", "courseId", "label"]),
  Coach: new Set(["name", "workType", "status", "returnDate", "dxTag", "isActive", "displayOrder"]),
  CoachEngagement: new Set(["coachId", "operationSessionId", "courseName", "status", "source", "startDate", "endDate", "startTime", "endTime", "rating", "rehire", "reviewFlaggedAt"]),
  CoachEngagementSchedule: new Set(["engagementId", "coachId", "date", "startTime", "endTime", "cancelledAt"]),
  CoachSchedule: new Set(["coachId", "date", "startTime", "endTime"]),
  CoachDayReservation: new Set(["coachId", "date", "cancelledAt", "confirmedEngagementId"]),
  CoachContentEntry: new Set(["coachId", "kind", "flaggedAt"]),
  CoachPrivateProfile: new Set(),
  CoachFieldMaster: new Set(["name"]),
  CoachCurriculumMaster: new Set(["name"]),
  CoachField: new Set(["coachId", "tagId"]),
  CoachCurriculum: new Set(["coachId", "tagId"]),
  TeamUser: new Set(["name", "email", "team", "role"]),
  InstructorNote: new Set(["instructorName", "displayName", "recruitAvoid"]),
  OperationSession: new Set(["operationId", "courseRecordId", "operationStatus", "archiveStatus", "educationFormat", "operationChannel", "roundNo", "educationDays", "startDate", "endDate", "educationDates", "operationMonth", "sessionDurationDays", "sessionDurationType", "timeText", "onsiteRequired", "totalCost", "instructorCost", "operationCost", "hasSatisfactionSurvey", "hasResultReport"])
};
function column(model: string, field: string) {
  if (model === "OmRequest" && field === "onSiteOperation") return "onsite_operation";
  if (model === "Course" && field === "name") return "course_name";
  return field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}
function safeValue(value: unknown, model: string, field: string): unknown {
  if (value === undefined || typeof value === "symbol") return null;
  const contract = mongoRuntimeContracts[model].fields[field];
  if (contract?.values && contract.type !== "OnsiteRequired" && contract.type !== "CoachContentEntryKind" && typeof value === "string") value = value.toLowerCase();
  if (contract?.type === "Decimal" && typeof value === "string") value = Number(value);
  if (contract?.dateOnly) value = Array.isArray(value) ? value.map(date => (date as Date).toISOString().slice(0,10)) : value instanceof Date ? value.toISOString().slice(0,10) : value;
  const text = JSON.stringify(value);
  return text.length > 500 ? { truncated: true, preview: text.slice(0, 500) } : JSON.parse(text);
}
/** Compare authenticated logical values, never randomized ciphertext. */
export function operationAuditRow(model: string, before: MongoRow | null, after: MongoRow | null, forceChangedFields: readonly string[] = []): MongoRow | null {
  const context = activityContext.getStore();
  const row = after ?? before;
  if (!context || !row) return null;
  if (model === "CoachContentEntry" && row.kind === "EDIT_HISTORY") return null;
  const privacy = (policies as Record<string, { fields: Record<string, unknown> }>)[model]?.fields ?? {};
  const changes: MongoRow = {};
  for (const field of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (excluded.has(field) || field.endsWith("PiiIndex") || field.endsWith("Encrypted")) continue;
    // Attachment bytes can be 5MiB: never enumerate or JSON-stringify them.
    // The public fields below still use the existing scalar comparison policy.
    if (model === "AnnouncementAttachment" && field === "data") {
      const left = before?.data, right = after?.data;
      if (left instanceof Uint8Array && right instanceof Uint8Array && left.byteLength === right.byteLength
        && Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(Buffer.from(right.buffer, right.byteOffset, right.byteLength))) continue;
      changes.data = { redacted: true };
      continue;
    }
    // PG distinguishes absent INSERT/DELETE sides from a present JSON null.
    // Extend only the two announcement models; unrelated models stay unchanged.
    const distinguishPresence = model === "OmRequest" || model === "CoachContentEntry" || model === "Announcement" || model === "AnnouncementAttachment";
    if (!forceChangedFields.includes(field) && stableMongoValue(before?.[field]) === stableMongoValue(after?.[field])
      && (!distinguishPresence || Object.hasOwn(before ?? {}, field) === Object.hasOwn(after ?? {}, field))) continue;
    changes[column(model, field)] = allowed[model]?.has(field) && !privacy[field]
      ? { before: safeValue(before?.[field], model, field), after: safeValue(after?.[field], model, field) }
      : { redacted: true };
  }
  if (before && after && Object.keys(changes).length === 0) return null;
  const action = !before ? "create" : !after || !before.deletedAt && after.deletedAt ? "delete" : before.deletedAt && !after.deletedAt ? "restore" : "update";
  const contract = mongoRuntimeContracts[model];
  const targetId = contract.primaryKey.length === 1 ? String(row[contract.primaryKey[0]])
    : `[${contract.primaryKey.map(key => JSON.stringify(row[key])).join(", ")}]`;
  return completeMongoRow("ActivityChange", {
    id: randomUUID(), occurredAt: new Date(), ...context,
    targetType: contract.collection, targetId, action, changes
  });
}
