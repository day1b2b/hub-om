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

test("입력 순서를 보존한다", () => {
  const out = dedupeCoachEngagements([
    view({ id: "s-keep", source: "sheet", startDate: "2026-12-01", endDate: "2026-12-05" }),
    view({ id: "m1", source: "manual" }),
    view({ id: "s-hide", source: "sheet" })
  ]);
  assert.deepEqual(ids(out), ["s-keep", "m1"]);
});
