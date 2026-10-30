import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRoundSurveyComments } from "@/features/operations/roundSurveyComments.ts";
import type { SessionSurveyResult } from "@/lib/data/sessionSurveyResultTypes.ts";

function result(operationId: string, comments: SessionSurveyResult["comments"], extra: Partial<SessionSurveyResult> = {}): SessionSurveyResult {
  return {
    operationId,
    recordId: null,
    overall: "4.6",
    instructorSatisfaction: "4.7",
    respondents: 26,
    positiveRate: "96.2",
    comments,
    appliedBy: null,
    appliedAt: "2026-10-30T00:00:00.000Z",
    ...extra
  };
}

const rounds = [
  { operationId: "op-1", label: "1회차" },
  { operationId: "op-2", label: "2회차" },
  { operationId: "op-3", label: "3회차" }
];

test("회차 순서대로, 결과가 있는 회차만 측정값 한 줄과 네 갈래로", () => {
  const rows = buildRoundSurveyComments(rounds, [
    result("op-3", { status: "ok", positive: ["실습 유용"], instructorImprove: [], hrdImprove: ["냉방"], followup: [] }),
    result("op-1", { status: "no_subjective", positive: [], instructorImprove: [], hrdImprove: [], followup: [] }, { respondents: null, instructorSatisfaction: null })
  ]);
  assert.deepEqual(rows.map((row) => [row.label, row.status]), [["1회차", "no_subjective"], ["3회차", "ok"]]);
  assert.equal(rows[0].measured, "긍정 96.2% · 종합 4.6");
  assert.deepEqual(rows[0].axes, []);
  assert.equal(rows[1].measured, "응답 26명 · 긍정 96.2% · 종합 4.6 · 강사 4.7");
  assert.deepEqual(rows[1].axes.map((axis) => [axis.label, axis.lines]), [
    ["👍 좋았던 점", ["실습 유용"]],
    ["🔧 강사 개선", []],
    ["🏢 운영·환경 보완", ["냉방"]],
    ["➕ 후속 니즈", []]
  ]);
});

test("코멘트 없이 반영된 회차(구버전 앱)는 상태 null로 남긴다", () => {
  const [row] = buildRoundSurveyComments(rounds, [result("op-2", null)]);
  assert.equal(row.status, null);
  assert.deepEqual(row.axes, []);
});
