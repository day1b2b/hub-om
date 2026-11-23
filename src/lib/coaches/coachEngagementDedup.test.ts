import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeCoachEngagements } from "./coachEngagementDedup";
import type { CoachEngagementView } from "../data/coachTypes";

function view(overrides: Partial<CoachEngagementView> & { id: string; source: string }): CoachEngagementView {
  return {
    id: overrides.id,
    courseName: overrides.courseName ?? "삼성 AI",
    operationSessionId: overrides.operationSessionId ?? null,
    status: overrides.status ?? "scheduled",
    source: overrides.source,
    startDate: overrides.startDate ?? "2026-11-16",
    endDate: overrides.endDate ?? "2026-11-20",
    startTime: overrides.startTime ?? "09:00",
    endTime: overrides.endTime ?? "18:00",
    rating: overrides.rating ?? null,
    rehire: overrides.rehire ?? null,
    feedback: overrides.feedback ?? null,
    linkedSession: overrides.linkedSession ?? null
  };
}

const ids = (list: CoachEngagementView[]) => list.map((e) => e.id);

test("날짜 겹치는 SHEET는 숨기고 운영현황(MANUAL)을 남긴다", () => {
  const out = dedupeCoachEngagements([
    view({ id: "m1", source: "manual", operationSessionId: "S1" }),
    view({ id: "s1", source: "sheet" }) // 같은 날짜 → 숨김
  ]);
  assert.deepEqual(ids(out), ["m1"]);
});

test("겹치지 않는 SHEET는 그대로 둔다", () => {
  const out = dedupeCoachEngagements([
    view({ id: "m1", source: "manual", startDate: "2026-11-16", endDate: "2026-11-20" }),
    view({ id: "s1", source: "sheet", startDate: "2026-12-01", endDate: "2026-12-05" })
  ]);
  assert.deepEqual(ids(out), ["m1", "s1"]);
});

test("운영현황(MANUAL)이 없으면 아무것도 숨기지 않는다", () => {
  const out = dedupeCoachEngagements([view({ id: "s1", source: "sheet" }), view({ id: "s2", source: "sheet" })]);
  assert.deepEqual(ids(out), ["s1", "s2"]);
});

test("평가(protected)·rating·feedback 달린 SHEET는 겹쳐도 숨기지 않는다", () => {
  const list = [
    view({ id: "m1", source: "manual" }),
    view({ id: "s-eval", source: "sheet" }),     // protectedEngagementIds
    view({ id: "s-rating", source: "sheet", rating: 5 }),
    view({ id: "s-fb", source: "sheet", feedback: "좋았음" }),
    view({ id: "s-plain", source: "sheet" })     // 보호 없음 → 숨김
  ];
  const out = dedupeCoachEngagements(list, new Set(["s-eval"]));
  assert.deepEqual(ids(out), ["m1", "s-eval", "s-rating", "s-fb"]);
});

test("취소된 MANUAL은 SHEET를 숨기는 근거가 되지 않는다", () => {
  const out = dedupeCoachEngagements([
    view({ id: "m1", source: "manual", status: "cancelled" }),
    view({ id: "s1", source: "sheet" })
  ]);
  assert.deepEqual(ids(out), ["m1", "s1"]); // 취소된 MANUAL은 덮어쓰지 못함 → SHEET 유지
});

test("활성 MANUAL과 겹치면 취소된 SHEET도 숨긴다(평가 없으면)", () => {
  const out = dedupeCoachEngagements([
    view({ id: "m1", source: "manual" }),
    view({ id: "s1", source: "sheet", status: "cancelled" })
  ]);
  assert.deepEqual(ids(out), ["m1"]);
});

test("같은 날 '다른 과정'은 숨기지 않는다(같은 코치 하루 2건 보호)", () => {
  const out = dedupeCoachEngagements([
    view({ id: "m-A", source: "manual", courseName: "삼성 AI 과정", operationSessionId: "S-A" }),
    view({ id: "s-B", source: "sheet", courseName: "현대 리더십 과정" }) // 같은 날, 다른 과정 → 유지
  ]);
  assert.deepEqual(ids(out), ["m-A", "s-B"]);
});

test("같은 날 같은 과정(공백·대소문자 흔들림)은 숨긴다", () => {
  const out = dedupeCoachEngagements([
    view({ id: "m1", source: "manual", courseName: "삼성  AI 과정" }), // 공백 흔들림
    view({ id: "s1", source: "sheet", courseName: "삼성 ai 과정" }) // 대소문자 흔들림 → 정규화 일치
  ]);
  assert.deepEqual(ids(out), ["m1"]);
});

test("괄호 꼬리표로만 다른 과정(기초/심화)은 숨기지 않는다", () => {
  const out = dedupeCoachEngagements([
    view({ id: "m1", source: "manual", courseName: "리더십 과정 (기초)", operationSessionId: "S1" }),
    view({ id: "s1", source: "sheet", courseName: "리더십 과정 (심화)" }) // 꼬리표 다름 → 다른 투입 → 유지
  ]);
  assert.deepEqual(ids(out), ["m1", "s1"]);
});

test("분반(1반/2반)이 다르면 숨기지 않는다", () => {
  const out = dedupeCoachEngagements([
    view({ id: "m1", source: "manual", courseName: "현대차 리더십 (1반)", operationSessionId: "S1" }),
    view({ id: "s1", source: "sheet", courseName: "현대차 리더십 (2반)" }) // 분반 다름 → 유지
  ]);
  assert.deepEqual(ids(out), ["m1", "s1"]);
});

test("같은 회차(operationSessionId 일치)면 과정명이 달라도 숨긴다", () => {
  const out = dedupeCoachEngagements([
    view({ id: "m1", source: "manual", courseName: "삼성 AI", operationSessionId: "S1" }),
    view({ id: "s1", source: "sheet", courseName: "표기 완전히 다른 과정", operationSessionId: "S1" })
  ]);
  assert.deepEqual(ids(out), ["m1"]);
});

test("과정명이 비어 있으면(판정 불가) 숨기지 않는다", () => {
  const out = dedupeCoachEngagements([
    view({ id: "m1", source: "manual", courseName: "", operationSessionId: null }),
    view({ id: "s1", source: "sheet", courseName: "" })
  ]);
  assert.deepEqual(ids(out), ["m1", "s1"]);
});

test("입력 순서를 보존한다", () => {
  const out = dedupeCoachEngagements([
    view({ id: "s-keep", source: "sheet", startDate: "2026-12-01", endDate: "2026-12-05" }),
    view({ id: "m1", source: "manual" }),
    view({ id: "s-hide", source: "sheet" })
  ]);
  assert.deepEqual(ids(out), ["s-keep", "m1"]);
});
