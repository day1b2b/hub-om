import assert from "node:assert/strict";
import test from "node:test";
import { formatPeopleDate, parseSatisfaction, peopleStatusFromFacts } from "./peopleStatus";

const fact = (startDate: string, endDate = startDate, cancelled = false) => ({ startDate, endDate, cancelled });

test("people status: booked when a live engagement ends today or later", () => {
  assert.equal(peopleStatusFromFacts([fact("2026-11-02")], "2026-10-23", 6), "booked");
  // 진행 중(시작은 지났고 끝은 남음)도 진행·예정이다.
  assert.equal(peopleStatusFromFacts([fact("2026-10-01", "2026-10-30")], "2026-10-23", 6), "booked");
  // 취소된 예정은 세지 않는다.
  assert.equal(peopleStatusFromFacts([fact("2026-11-02", "2026-11-02", true)], "2026-10-23", 6), "dormant");
  // 강사는 운영 현황 진행상태로 진행·예정을 판단할 수 있다.
  assert.equal(peopleStatusFromFacts([fact("2025-01-01")], "2026-10-23", 6, true), "booked");
});

test("people status: active within the window, dormant after it, never without facts", () => {
  assert.equal(peopleStatusFromFacts([], "2026-10-23", 6), "never");
  assert.equal(peopleStatusFromFacts([fact("2026-04-23")], "2026-10-23", 6), "active");
  assert.equal(peopleStatusFromFacts([fact("2026-04-22")], "2026-10-23", 6), "dormant");
  // 끝난 날 기준이라 길게 이어진 과정은 끝난 날로 본다.
  assert.equal(peopleStatusFromFacts([fact("2026-01-05", "2026-05-01")], "2026-10-23", 6), "active");
  // 날짜가 빈 이력은 판단할 수 없어 휴면으로 둔다(이력은 있으므로 미투입이 아니다).
  assert.equal(peopleStatusFromFacts([fact("", "")], "2026-10-23", 6), "dormant");
});

test("formatPeopleDate keeps the year only for other years", () => {
  assert.equal(formatPeopleDate("2026-10-06", "2026-10-28"), "10.6");
  assert.equal(formatPeopleDate("2025-02-14", "2026-10-28"), "2025.2.14");
});

test("parseSatisfaction accepts 5-point scores only", () => {
  assert.equal(parseSatisfaction("4.72"), 4.72);
  assert.equal(parseSatisfaction(""), null);
  assert.equal(parseSatisfaction("6.1"), null);
  assert.equal(parseSatisfaction("-"), null);
});
