import assert from "node:assert/strict";
import { test } from "node:test";

import { planSatisfactionApply, type ApplyTargetOperation } from "@/lib/data/satisfactionApplyPlan.ts";
import type { SatisfactionMatchResult, SatisfactionSheetRow } from "@/lib/data/satisfactionSheet.ts";

function row(overrides: Partial<SatisfactionSheetRow> = {}): SatisfactionSheetRow {
  return {
    recordId: "rec-1",
    courseId: "255413",
    client: "고객사",
    course: "테스트 과정",
    degree: "",
    rawDate: "260212",
    date: "2026-02-12",
    audience: "",
    rawInstructor: "정백 강사",
    instructor: "정백",
    respondents: 26,
    rawOverall: "4.62",
    overall: "4.62",
    posPct: 96.2,
    ...overrides
  };
}

function result(status: SatisfactionMatchResult["status"], operationId: string | null, rowOverrides = {}): SatisfactionMatchResult {
  return { row: row(rowOverrides), status, operationId, ranked: [] };
}

const OP: ApplyTargetOperation = {
  operationId: "op-1",
  avgSatisfaction: "",
  companyName: "고객사",
  courseName: "테스트 과정",
  startDate: "2026-02-11",
  endDate: "2026-02-12"
};

function opMap(...ops: ApplyTargetOperation[]): Map<string, ApplyTargetOperation> {
  return new Map(ops.map((op) => [op.operationId, op]));
}

test("matched + 미입력 회차 → 반영 대상", () => {
  const plan = planSatisfactionApply([result("matched", "op-1")], opMap(OP));
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0].operationId, "op-1");
  assert.equal(plan.apply[0].value, "4.62");
  assert.ok(plan.apply[0].label.includes("테스트 과정"));
  assert.equal(plan.skip.length, 0);
});

test("이미 값이 있는 회차는 절대 덮어쓰지 않는다", () => {
  const plan = planSatisfactionApply(
    [result("matched", "op-1")],
    opMap({ ...OP, avgSatisfaction: "4.10" })
  );
  assert.equal(plan.apply.length, 0);
  assert.equal(plan.skip.length, 1);
  assert.ok(plan.skip[0].reason.includes("4.10"), "기존 값을 사유에 알려야 한다");
});

test("공백만 있는 기존 값은 미입력으로 보고 채운다", () => {
  const plan = planSatisfactionApply([result("matched", "op-1")], opMap({ ...OP, avgSatisfaction: "   " }));
  assert.equal(plan.apply.length, 1);
});

test("모호·미매칭은 반영 대상이 아니다", () => {
  const plan = planSatisfactionApply(
    [result("ambiguous", null), result("unmatched", null)],
    opMap(OP)
  );
  assert.equal(plan.apply.length, 0);
  assert.equal(plan.skip.length, 0, "쓰지 않을 건은 건너뜀 목록에도 넣지 않는다(노이즈 방지)");
});

test("시트 만족도 값이 비면 쓰지 않는다", () => {
  const plan = planSatisfactionApply([result("matched", "op-1", { overall: "" })], opMap(OP));
  assert.equal(plan.apply.length, 0);
  assert.equal(plan.skip.length, 1);
  assert.ok(plan.skip[0].reason.includes("비어"));
});

test("매칭 운영 정보를 못 찾으면 missing으로 드러낸다(조용히 넘기지 않음)", () => {
  const plan = planSatisfactionApply([result("matched", "op-없음")], opMap(OP));
  assert.equal(plan.apply.length, 0);
  assert.equal(plan.missing.length, 1);
});

test("여러 건 혼합: 반영 1 · 보존 1 · 값없음 1", () => {
  const other: ApplyTargetOperation = { ...OP, operationId: "op-2", avgSatisfaction: "4.99" };
  const plan = planSatisfactionApply(
    [
      result("matched", "op-1"),
      result("matched", "op-2", { recordId: "rec-2" }),
      result("matched", "op-1", { recordId: "rec-3", overall: "" }),
      result("unmatched", null, { recordId: "rec-4" })
    ],
    opMap(OP, other)
  );
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.skip.length, 2);
  assert.equal(plan.missing.length, 0);
});
