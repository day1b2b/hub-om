import assert from "node:assert/strict";
import test from "node:test";
import { parseCreateEngagement, parseDate, parseEngagementStatus, parseReviewCommand, parseUpdateEngagement, weekdayScheduleEntries } from "./engagementApi";
import { toCoachEngagementListItem, toCoachEngagementRecord, type CoachEngagementRow } from "../data/coachEngagementRepository";
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const body = { courseName: " Synthetic course ", startDate: "2026-09-21", endDate: "2026-09-23", rating: null };

test("creation retains explicit unrated null and unknown-status fallback contracts", () => {
  const valid = parseCreateEngagement(body); assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.equal(valid.value.courseName, "Synthetic course"); assert.equal(valid.value.rating, null); assert.equal(valid.value.status, "SCHEDULED");
  assert.deepEqual(parseCreateEngagement({ ...body, rating: undefined }), { ok: false, error: "평점은 1~5 사이 정수여야 합니다." });
  for (const rating of [0, 6, 1.5, "5"]) assert.equal(parseCreateEngagement({ ...body, rating }).ok, false);
  assert.equal(parseEngagementStatus("cancelled"), "CANCELLED"); assert.equal(parseEngagementStatus("unknown"), "SCHEDULED");
  assert.equal(parseCreateEngagement(null).ok, false);
});

test("calendar rollover is rejected while PUT invalid-date fallback remains explicit", () => {
  assert.equal(parseDate("2024-02-29")?.toISOString(), "2024-02-29T00:00:00.000Z");
  for (const value of ["2025-02-29", "2026-04-31", null]) assert.equal(parseDate(value), null);
  assert.deepEqual(parseCreateEngagement({ ...body, startDate: "2025-02-29" }), { ok: false, error: "기간이 필요합니다." });
  assert.deepEqual(parseUpdateEngagement({ startDate: "2025-02-29", endDate: null, courseName: "", status: "unknown" }), { ok: true, value: { startDate: null, endDate: null, courseName: null, status: "SCHEDULED" } });
  assert.deepEqual(parseUpdateEngagement({}), { ok: true, value: {} });
});

test("review commands retain toggle priority, delete priority and nullable edits", () => {
  assert.deepEqual(parseReviewCommand({ toggleFlag: true, deleteReview: true, rating: 99 }), { ok: true, value: { action: "toggleFlag" } });
  assert.deepEqual(parseReviewCommand({ deleteReview: true, rating: 99 }), { ok: true, value: { action: "deleteReview" } });
  assert.deepEqual(parseReviewCommand({ rating: "", feedback: "  comment  ", rehire: false }), { ok: true, value: { action: "edit", rating: null, feedback: "comment", rehire: false } });
  assert.deepEqual(parseReviewCommand({ rehire: true }), { ok: true, value: { action: "edit", rehire: true } });
  assert.equal(parseReviewCommand({ rating: 99 }).ok, false); assert.equal(parseReviewCommand(null).ok, false);
});

test("weekday generation preserves defaults, weekend skipping, reversed range and 366-day cap", () => {
  const entries = weekdayScheduleEntries(day("2026-09-18"), day("2026-09-21"), null, null);
  assert.deepEqual(entries.map(row => ({ ...row, date: row.date.toISOString().slice(0,10) })), [{ date: "2026-09-18", startTime: "09:00", endTime: "18:00" }, { date: "2026-09-21", startTime: "09:00", endTime: "18:00" }]);
  assert.deepEqual(weekdayScheduleEntries(day("2026-09-23"), day("2026-09-21"), null, null), []);
  const long = weekdayScheduleEntries(day("2024-01-01"), day("2026-01-01"), "10:00", "17:00");
  assert.equal(long.length, 262); assert.equal(long.at(-1)?.date.toISOString().slice(0,10), "2024-12-31");
  assert.ok(long.every(row => row.startTime === "10:00" && row.endTime === "17:00"));
});

test("explicit DTOs preserve list/write representations without privacy companions", () => {
  const row: CoachEngagementRow & { feedbackPiiIndex: string } = {
    id: "id", sourceEngagementId: "source", coachId: "coach", operationSessionId: null, courseName: "Synthetic",
    status: "IN_PROGRESS", source: "MANUAL", startDate: day("2026-09-21"), endDate: day("2026-09-23"),
    startTime: null, endTime: null, rating: null, rehire: false, feedback: "Synthetic review", reviewFlaggedAt: null,
    hiredById: null, hiredByText: null, createdAt: day("2026-09-20"), feedbackPiiIndex: "hidden"
  };
  const record = toCoachEngagementRecord(row), list = toCoachEngagementListItem(row);
  assert.equal(Object.keys(record).length, 18); assert.equal(Object.hasOwn(record, "feedbackPiiIndex"), false);
  assert.equal(record.status, "IN_PROGRESS"); assert.equal(record.startDate, "2026-09-21T00:00:00.000Z");
  assert.equal(list.status, "in_progress"); assert.equal(list.source, "manual"); assert.equal(list.startDate, "2026-09-21");
});
