import assert from "node:assert/strict";
import test from "node:test";
import { parseDates, parseMonthRange, parseScheduleDate, parseSchedules } from "./coachScheduleValidation";

test("month ranges use UTC and the actual leap-year calendar, including years below 100", () => {
  for (const [month, last] of [["2024-02", "2024-02-29"], ["2025-02", "2025-02-28"], ["2000-02", "2000-02-29"], ["1900-02", "1900-02-28"], ["0099-02", "0099-02-28"], ["9999-12", "9999-12-31"]]) {
    const result = parseMonthRange(month);
    assert.ok(result);
    assert.equal(result.start.toISOString(), `${month}-01T00:00:00.000Z`);
    assert.equal(result.end.toISOString(), `${last}T00:00:00.000Z`);
  }
  for (const value of [null, undefined, {}, 202409, "0000-01", "2024-00", "2024-13", "2024-2", "2024-02-01", " 2024-02", "2024-02\n"]) assert.equal(parseMonthRange(value), null);
});

test("calendar days reject rollover, year zero, noncanonical strings and non-string values", () => {
  assert.equal(parseScheduleDate("2024-02-29")?.toISOString(), "2024-02-29T00:00:00.000Z");
  for (const value of ["2025-02-29", "1900-02-29", "2024-04-31", "2024-02-30", "2024-01-00", "2024-13-01", "0000-01-01", "2024-1-01", "2024-01-01T00:00:00Z", "2024-01-01\n", null, {}, 20240101]) assert.equal(parseScheduleDate(value), null);
});

test("monthly schedule parsing deduplicates exact intervals and preserves distinct intervals and order", () => {
  const a = { date: "2024-02-29", startTime: "09:00", endTime: "12:00" };
  const b = { date: "2024-02-29", startTime: "13:00", endTime: "18:00" };
  assert.deepEqual(parseSchedules([a, b, a], "2024-02"), { ok: true, value: [a, b] });
  assert.deepEqual(parseSchedules([], "2024-02"), { ok: true, value: [] });
  assert.deepEqual(parseSchedules([], "invalid"), { ok: false, error: "월 형식이 올바르지 않습니다." });
});

test("null bodies, null entries and missing fields return the existing Korean validation errors", () => {
  for (const body of [null, undefined, {}, "schedule"]) assert.deepEqual(parseSchedules(body, "2024-02"), { ok: false, error: "스케줄 형식이 올바르지 않습니다." });
  for (const item of [null, undefined, [], {}, 1, { date: "2024-02-01", startTime: null, endTime: "12:00" }]) assert.deepEqual(parseSchedules([item], "2024-02"), { ok: false, error: "스케줄 항목 형식이 올바르지 않습니다." });
});

test("monthly schedule validation rejects invalid days, outside months and invalid time ranges", () => {
  for (const date of ["2025-02-29", "2025-03-01", "2025-02-30", "2025-2-01"]) assert.deepEqual(parseSchedules([{ date, startTime: "09:00", endTime: "12:00" }], "2025-02"), { ok: false, error: "선택한 월 밖의 날짜가 포함되어 있습니다." });
  for (const [startTime, endTime] of [["24:00", "25:00"], ["09:60", "12:00"], ["9:00", "12:00"], ["12:00", "12:00"], ["12:00", "09:00"], ["09:00\n", "12:00"]]) assert.deepEqual(parseSchedules([{ date: "2024-02-01", startTime, endTime }], "2024-02"), { ok: false, error: "시간 형식이 올바르지 않습니다." });
});

test("reservation dates require a nonempty valid calendar list and retain first-seen order", () => {
  assert.deepEqual(parseDates(["2024-03-01", "2024-02-29", "2024-03-01"]), ["2024-03-01", "2024-02-29"]);
  for (const value of [null, undefined, {}, [], [null], ["2025-02-29"], ["2024-02-29", "2024-04-31"], ["2024-02-29", 2], ["2024-02-29\n"]]) assert.equal(parseDates(value), null);
});
