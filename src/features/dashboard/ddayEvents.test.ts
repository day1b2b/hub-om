import assert from "node:assert/strict";
import { test } from "node:test";

import { selectDdayEvents, type DdayCandidate } from "@/features/dashboard/ddayEvents.ts";

const TODAY = new Date(2026, 9, 7); // 2026-10-07
const ev = (
  label: string,
  day: number,
  source: DdayCandidate["source"] = "operation",
  course = "과정"
): DdayCandidate & { label: string } => ({ label, course, source, start: new Date(2026, 9, day) });

test("담당 관리(업무요청)에서 온 일정은 D-day에 넣지 않는다", () => {
  // 실제 제보: 배정되지 않은 콜마그룹·CJONS 건이 D-day 상단을 차지했다.
  const picked = selectDdayEvents(
    [ev("콜마그룹", 27, "request"), ev("운영배정건", 30, "operation")],
    TODAY,
    4
  );
  assert.deepEqual(picked.map((e) => e.label), ["운영배정건"]);
});

test("운영 현황 일정이 없으면 빈 목록", () => {
  const picked = selectDdayEvents([ev("콜마그룹", 27, "request")], TODAY, 4);
  assert.deepEqual(picked, []);
});

test("임박한 순으로 limit만큼 고른다", () => {
  const picked = selectDdayEvents(
    [ev("넷", 30), ev("하나", 9), ev("셋", 20), ev("둘", 12), ev("다섯", 31)],
    TODAY,
    4
  );
  assert.deepEqual(picked.map((e) => e.label), ["하나", "둘", "셋", "넷"]);
});

test("오늘 시작하는 과정은 남긴다", () => {
  const picked = selectDdayEvents([ev("오늘", 7)], TODAY, 4);
  assert.deepEqual(picked.map((e) => e.label), ["오늘"]);
});

test("지난 과정은 뺀다", () => {
  const picked = selectDdayEvents([ev("어제", 6), ev("내일", 8)], TODAY, 4);
  assert.deepEqual(picked.map((e) => e.label), ["내일"]);
});

test("같은 날이면 기업명 순, 그다음 과정명 순", () => {
  const picked = selectDdayEvents(
    [ev("나기업", 20, "operation", "나과정"), ev("가기업", 20), ev("나기업", 20, "operation", "가과정")],
    TODAY,
    4
  );
  assert.deepEqual(picked.map((e) => `${e.label}/${e.course}`), ["가기업/과정", "나기업/가과정", "나기업/나과정"]);
});

test("시각이 들어 있어도 오늘 것은 남긴다", () => {
  // 오늘 09시 시작을 "이미 지났다"로 걸러내면 당일 과정이 사라진다.
  const morning = { label: "오늘아침", course: "과정", source: "operation" as const, start: new Date(2026, 9, 7, 9) };
  assert.equal(selectDdayEvents([morning], new Date(2026, 9, 7, 18), 4).length, 1);
});
