import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleCoachEngagements } from "./coachEngagementDedup";
import type { CoachEngagementView } from "../data/coachTypes";

function view(overrides: Partial<CoachEngagementView> & { id: string }): CoachEngagementView {
  return {
    id: overrides.id,
    courseName: overrides.courseName ?? "삼성 AI",
    operationSessionId: overrides.operationSessionId ?? null,
    status: overrides.status ?? "scheduled",
    source: overrides.source ?? "manual",
    startDate: overrides.startDate ?? "2026-11-16",
    endDate: overrides.endDate ?? "2026-11-20",
    startTime: overrides.startTime ?? "09:00",
    endTime: overrides.endTime ?? "18:00",
    rating: overrides.rating ?? null,
    rehire: overrides.rehire ?? null,
    feedback: overrides.feedback ?? null,
    linkedSession: overrides.linkedSession ?? null,
    operationBacked: overrides.operationBacked
  };
}

const ids = (list: CoachEngagementView[]) => list.map((e) => e.id);

test("운영현황 출신(operationBacked)만 남기고 보조 소스는 숨긴다", () => {
  const out = visibleCoachEngagements([
    view({ id: "op", operationBacked: true }),
    view({ id: "sheet", operationBacked: false })
  ]);
  assert.deepEqual(ids(out), ["op"]);
});

test("보조 소스라도 평가(protected)·rating·feedback·rehire 달린 줄은 보존한다", () => {
  const out = visibleCoachEngagements(
    [
      view({ id: "op", operationBacked: true }),
      view({ id: "s-eval", operationBacked: false }),
      view({ id: "s-rating", operationBacked: false, rating: 5 }),
      view({ id: "s-fb", operationBacked: false, feedback: "좋았음" }),
      view({ id: "s-rehire", operationBacked: false, rehire: true }),
      view({ id: "s-plain", operationBacked: false }) // 보호 없음 → 숨김
    ],
    new Set(["s-eval"])
  );
  assert.deepEqual(ids(out), ["op", "s-eval", "s-rating", "s-fb", "s-rehire"]);
});

test("operationBacked 미지정(undefined)이면 판정 불가로 보고 숨기지 않는다", () => {
  const out = visibleCoachEngagements([view({ id: "a" }), view({ id: "b", operationBacked: undefined })]);
  assert.deepEqual(ids(out), ["a", "b"]);
});

test("빈 feedback은 보호 사유가 아니다(공백만)", () => {
  const out = visibleCoachEngagements([view({ id: "s", operationBacked: false, feedback: "   " })]);
  assert.deepEqual(ids(out), []);
});

test("입력 순서를 보존한다", () => {
  const out = visibleCoachEngagements([
    view({ id: "s-hide", operationBacked: false }),
    view({ id: "op", operationBacked: true }),
    view({ id: "s-keep", operationBacked: false, rating: 4 })
  ]);
  assert.deepEqual(ids(out), ["op", "s-keep"]);
});

test("모두 운영현황 출신이면 그대로 둔다", () => {
  const out = visibleCoachEngagements([
    view({ id: "a", operationBacked: true }),
    view({ id: "b", operationBacked: true })
  ]);
  assert.deepEqual(ids(out), ["a", "b"]);
});
