import { randomUUID } from "node:crypto";
import type { CoachEngagementStatus, CoachReviewCommand, CreateCoachEngagementInput, UpdateCoachEngagementInput } from "../data/coachEngagementRepository";
import { parseScheduleDate } from "./coachScheduleValidation";

export function parseEngagementStatus(value: unknown): CoachEngagementStatus {
  if (value === "scheduled") return "SCHEDULED";
  if (value === "in_progress") return "IN_PROGRESS";
  if (value === "completed") return "COMPLETED";
  if (value === "cancelled") return "CANCELLED";
  return "SCHEDULED";
}
export function parseOptionalEngagementStatus(value: unknown): CoachEngagementStatus | undefined {
  return value === undefined ? undefined : parseEngagementStatus(value);
}
export function parseDate(value: unknown): Date | null { return parseScheduleDate(value); }
export function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
export function parseRating(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) return undefined;
  return value;
}
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
function bodyObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
const bodyError = { ok: false, error: "요청 형식이 올바르지 않습니다." } as const;
const ratingError = { ok: false, error: "평점은 1~5 사이 정수여야 합니다." } as const;
export function parseCreateEngagement(body: unknown): Parsed<CreateCoachEngagementInput> {
  if (!bodyObject(body)) return bodyError;
  const courseName = stringValue(body.courseName), startDate = parseDate(body.startDate), endDate = parseDate(body.endDate), rating = parseRating(body.rating);
  if (!courseName) return { ok: false, error: "과정명이 필요합니다." };
  if (!startDate || !endDate) return { ok: false, error: "기간이 필요합니다." };
  // Preserve the existing POST contract: callers must explicitly send null when no rating exists.
  if (rating === undefined) return ratingError;
  return { ok: true, value: {
    courseName, status: parseEngagementStatus(body.status), startDate, endDate,
    startTime: stringValue(body.startTime), endTime: stringValue(body.endTime), rating,
    feedback: stringValue(body.feedback), rehire: typeof body.rehire === "boolean" ? body.rehire : null, hiredByText: stringValue(body.hiredBy)
  } };
}
export function parseUpdateEngagement(body: unknown): Parsed<UpdateCoachEngagementInput> {
  if (!bodyObject(body)) return bodyError;
  const rating = parseRating(body.rating);
  if (rating === undefined && body.rating !== undefined) return ratingError;
  return { ok: true, value: {
    ...(body.courseName !== undefined ? { courseName: stringValue(body.courseName) } : {}),
    ...(body.status !== undefined ? { status: parseEngagementStatus(body.status) } : {}),
    ...(body.startDate !== undefined ? { startDate: parseDate(body.startDate) } : {}),
    ...(body.endDate !== undefined ? { endDate: parseDate(body.endDate) } : {}),
    ...(body.startTime !== undefined ? { startTime: stringValue(body.startTime) } : {}),
    ...(body.endTime !== undefined ? { endTime: stringValue(body.endTime) } : {}),
    ...(body.rating !== undefined ? { rating: rating ?? null } : {}),
    ...(body.feedback !== undefined ? { feedback: stringValue(body.feedback) } : {}),
    ...(body.rehire !== undefined ? { rehire: typeof body.rehire === "boolean" ? body.rehire : null } : {}),
    ...(body.hiredBy !== undefined ? { hiredByText: stringValue(body.hiredBy) } : {})
  } };
}
export function parseReviewCommand(body: unknown): Parsed<CoachReviewCommand> {
  if (!bodyObject(body)) return bodyError;
  if (body.toggleFlag === true) return { ok: true, value: { action: "toggleFlag" } };
  if (body.deleteReview === true) return { ok: true, value: { action: "deleteReview" } };
  const rating = parseRating(body.rating);
  if (rating === undefined && body.rating !== undefined) return ratingError;
  return { ok: true, value: {
    action: "edit",
    ...(body.rating !== undefined ? { rating: rating ?? null } : {}),
    ...(body.feedback !== undefined ? { feedback: stringValue(body.feedback) } : {}),
    ...(body.rehire !== undefined ? { rehire: typeof body.rehire === "boolean" ? body.rehire : null } : {})
  } };
}

/** Legacy weekday generation: at most 366 calendar days, including weekends in that cap. */
export function weekdayScheduleEntries(startDate: Date, endDate: Date, startTime: string | null, endTime: string | null): Array<{ date: Date; startTime: string; endTime: string }> {
  const rows: Array<{ date: Date; startTime: string; endTime: string }> = [];
  const cursor = new Date(startDate);
  let safety = 0;
  while (cursor <= endDate && safety < 366) {
    const day = cursor.getUTCDay();
    if (day >= 1 && day <= 5) rows.push({ date: new Date(cursor), startTime: startTime || "09:00", endTime: endTime || "18:00" });
    cursor.setUTCDate(cursor.getUTCDate() + 1); safety++;
  }
  return rows;
}
export function manualSourceId(): string { return `hub:${randomUUID()}`; }
export const MANUAL_ENGAGEMENT_SOURCE = "MANUAL" as const;
