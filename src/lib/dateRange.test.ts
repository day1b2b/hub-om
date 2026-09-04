import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALL_RANGE,
  formatDateValue,
  getMonthRange,
  getQuarterRange,
  getYearRange,
  overlapsDateRange,
  parseDateValue
} from "@/lib/dateRange.ts";

const TODAY = new Date(2026, 8, 3); // 2026-09-03

test("Date를 로컬 기준 YYYY-MM-DD로 쓴다", () => {
  // toISOString은 UTC로 밀려 한국 시간대에서 하루 어긋난다.
  assert.equal(formatDateValue(new Date(2026, 0, 1)), "2026-01-01");
  assert.equal(formatDateValue(new Date(2026, 11, 31)), "2026-12-31");
});

test("형식이 아니면 파싱하지 않는다", () => {
  assert.equal(parseDateValue("2026-09-03")?.getDate(), 3);
  for (const bad of ["", "-", "미정", "2026/09/03", "20260903", null, undefined]) {
    assert.equal(parseDateValue(bad), null);
  }
});

test("이번 달 · 다음 달 범위", () => {
  assert.deepEqual(getMonthRange(TODAY, 0), { start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(getMonthRange(TODAY, 1), { start: "2026-10-01", end: "2026-10-31" });
});

test("연말에서 다음 달은 해를 넘긴다", () => {
  assert.deepEqual(getMonthRange(new Date(2026, 11, 15), 1), { start: "2027-01-01", end: "2027-01-31" });
});

test("2월 말일을 정확히 잡는다(윤년 포함)", () => {
  assert.equal(getMonthRange(new Date(2026, 1, 10), 0).end, "2026-02-28");
  assert.equal(getMonthRange(new Date(2028, 1, 10), 0).end, "2028-02-29");
});

test("이번 분기 · 올해 범위", () => {
  assert.deepEqual(getQuarterRange(TODAY), { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(getYearRange(TODAY), { start: "2026-01-01", end: "2026-12-31" });
});

test("분기는 1·4·7·10월에서 시작한다", () => {
  assert.equal(getQuarterRange(new Date(2026, 0, 5)).start, "2026-01-01");
  assert.equal(getQuarterRange(new Date(2026, 3, 5)).start, "2026-04-01");
  assert.equal(getQuarterRange(new Date(2026, 11, 5)).start, "2026-10-01");
});

test("기간이 겹치면 포함한다", () => {
  const september = getMonthRange(TODAY, 0);
  assert.equal(overlapsDateRange("2026-09-15", "2026-09-15", september), true);
  assert.equal(overlapsDateRange("2026-08-28", "2026-09-02", september), true, "경계를 걸치는 과정");
  assert.equal(overlapsDateRange("2026-09-30", "2026-10-05", september), true, "말일에 시작");
  assert.equal(overlapsDateRange("2026-10-01", "2026-10-01", september), false);
  assert.equal(overlapsDateRange("2026-08-31", "2026-08-31", september), false);
});

test("종료일이 없으면 시작일 하루로 본다", () => {
  const september = getMonthRange(TODAY, 0);
  assert.equal(overlapsDateRange("2026-09-15", "", september), true);
  assert.equal(overlapsDateRange("2026-10-15", "", september), false);
});

test("일정이 없는 과정은 기간 필터가 숨기지 않는다", () => {
  // 담당자가 과정을 통째로 놓치는 것보다 한 줄 더 보이는 편이 낫다.
  const september = getMonthRange(TODAY, 0);
  assert.equal(overlapsDateRange("-", "-", september), true);
  assert.equal(overlapsDateRange("", "", september), true);
});

test("전체 범위는 아무것도 걸러내지 않는다", () => {
  assert.equal(overlapsDateRange("2020-01-01", "2020-01-01", ALL_RANGE), true);
  assert.equal(overlapsDateRange("2099-12-31", "2099-12-31", ALL_RANGE), true);
});
