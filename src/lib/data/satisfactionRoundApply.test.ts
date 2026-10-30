import assert from "node:assert/strict";
import { test } from "node:test";

import { planInstructorSatisfaction, planRoundApply, planSurveyResult } from "@/lib/data/satisfactionRoundApply";
import type { RoundApplyTarget } from "@/lib/data/satisfactionRoundApply";
import type { SatisfactionMatchResult, SatisfactionSheetRow } from "@/lib/data/satisfactionSheet";

function row(overall = "4.55"): SatisfactionSheetRow {
  return {
    recordId: "r_1",
    courseId: "260455",
    client: "삼성전자DX",
    course: "AI Essential",
    degree: "",
    rawDate: "260708",
    date: "2026-07-08",
    audience: "",
    rawInstructor: "강수현",
    instructor: "강수현",
    respondents: 113,
    rawOverall: overall,
    overall,
    posPct: null
  };
}

function matched(operationId = "op-1"): SatisfactionMatchResult {
  return { row: row(), status: "matched", operationId, ranked: [] };
}

function target(avgSatisfaction: null | string): RoundApplyTarget {
  // ★ id(행 id)와 operationId(업무 키)를 일부러 다르게 둔다 —
  //   updateOperation 은 업무 키로 찾는다. 둘을 헷갈리면 매칭은 맞는데 쓰기만 실패한다.
  return { id: "op-1", operationId: "OP-260455", companyName: "삼성전자DX", courseName: "AI Essential", avgSatisfaction };
}

const find = (op: RoundApplyTarget | undefined) => () => op;

test("빈 칸이면 채운다", () => {
  const d = planRoundApply("4.55", matched(), find(target("")));
  assert.equal(d.write, true);
  assert.equal(d.status, "filled");
  assert.equal(d.value, "4.55");
  assert.equal(d.previous, null);
});

test("기존 값이 있어도 덮어쓴다 — 시트가 원본이다", () => {
  const d = planRoundApply("4.55", matched(), find(target("4.20")));
  assert.equal(d.write, true);
  assert.equal(d.status, "overwritten");
  assert.equal(d.previous, "4.20");
  assert.match(d.message, /4\.20/);
  assert.match(d.message, /4\.55/);
});

test("값이 같으면 쓰지 않는다", () => {
  const d = planRoundApply("4.55", matched(), find(target("4.55")));
  assert.equal(d.write, false);
  assert.equal(d.status, "same");
});

test("만족도가 비면 쓰지 않는다", () => {
  const d = planRoundApply("", matched(), find(target("")));
  assert.equal(d.write, false);
  assert.equal(d.status, "empty");
});

test("모호하면 쓰지 않는다", () => {
  const m: SatisfactionMatchResult = { row: row(), status: "ambiguous", operationId: null, ranked: [] };
  const d = planRoundApply("4.55", m, find(target("")));
  assert.equal(d.write, false);
  assert.equal(d.status, "ambiguous");
  assert.match(d.message, /코스ID/);
});

test("미매칭이면 쓰지 않고 사유를 그대로 전한다", () => {
  const m: SatisfactionMatchResult = {
    row: row(),
    status: "unmatched",
    operationId: null,
    ranked: [],
    reason: "코스ID 260455와 같은 운영을 찾지 못했어요."
  };
  const d = planRoundApply("4.55", m, find(target("")));
  assert.equal(d.write, false);
  assert.equal(d.status, "unmatched");
  assert.equal(d.message, "코스ID 260455와 같은 운영을 찾지 못했어요.");
});

test("매칭됐는데 운영 정보를 못 찾으면 조용히 넘기지 않는다", () => {
  const d = planRoundApply("4.55", matched(), find(undefined));
  assert.equal(d.write, false);
  assert.equal(d.status, "missing");
});

test("쓰기 키는 행 id 가 아니라 업무 키(operationId) 다", () => {
  // 2026-09-03: 행 id 를 넘겨 "No record was found for an update" 로 쓰기만 실패했다.
  const d = planRoundApply("4.55", matched("op-1"), find(target("")));
  assert.equal(d.write, true);
  assert.equal(d.operationId, "OP-260455");
  assert.notEqual(d.operationId, "op-1");
});

test("값이 같아 안 쓰는 경우에도 키는 업무 키다", () => {
  const d = planRoundApply("4.55", matched("op-1"), find(target("4.55")));
  assert.equal(d.operationId, "OP-260455");
});

test("업무 키가 없으면 쓰지 않고 알린다", () => {
  const noKey: RoundApplyTarget = { id: "op-1", companyName: "삼성전자DX", courseName: "AI Essential", avgSatisfaction: "" };
  const d = planRoundApply("4.55", matched("op-1"), find(noKey));
  assert.equal(d.write, false);
  assert.equal(d.status, "missing");
  assert.match(d.message, /식별자/);
});

test("어떤 경우에도 사용자에게 보여줄 문장이 있다", () => {
  const cases: SatisfactionMatchResult[] = [
    matched(),
    { row: row(), status: "ambiguous", operationId: null, ranked: [] },
    { row: row(), status: "unmatched", operationId: null, ranked: [] }
  ];
  for (const m of cases) {
    for (const prev of ["", "4.20", "4.55"]) {
      const d = planRoundApply("4.55", m, find(target(prev)));
      assert.ok(d.message.trim().length > 0, `문장이 비었다: ${m.status}/${prev}`);
    }
  }
  assert.ok(planRoundApply("", matched(), find(target(""))).message.trim().length > 0);
});

test("강사 만족도: 종합을 쓸 때는 같이 쓴다", () => {
  const decision = planRoundApply("4.55", matched(), find(target(null)));
  assert.equal(planInstructorSatisfaction(decision, "4.7", target(null)), "4.7");
});

test("강사 만족도: 종합이 같아도 강사 칸이 비어 있으면 강사 값만 채운다", () => {
  const current = { ...target("4.55"), instructorSatisfaction: "" };
  const decision = planRoundApply("4.55", matched(), find(current));
  assert.equal(decision.write, false);
  assert.equal(decision.status, "same");
  assert.equal(planInstructorSatisfaction(decision, "4.7", current), "4.7");
});

test("강사 만족도: 종합이 같고 강사 값이 이미 있으면 바꾸지 않는다", () => {
  const current = { ...target("4.55"), instructorSatisfaction: "4.2" };
  const decision = planRoundApply("4.55", matched(), find(current));
  assert.equal(planInstructorSatisfaction(decision, "4.7", current), null);
});

test("강사 만족도: 비었거나 5점 밖이거나 매칭이 안 되면 쓰지 않는다", () => {
  const decision = planRoundApply("4.55", matched(), find(target(null)));
  assert.equal(planInstructorSatisfaction(decision, "", target(null)), null);
  assert.equal(planInstructorSatisfaction(decision, "8.45", target(null)), null);
  const unmatched = planRoundApply("4.55", { row: row(), status: "unmatched", operationId: null, ranked: [] }, find(target(null)));
  assert.equal(planInstructorSatisfaction(unmatched, "4.7", target(null)), null);
});

test("만족도 결과: 회차가 확정되면 측정값·출처를 업무 키로 남긴다", () => {
  const d = planRoundApply("4.55", matched(), find(target("")));
  const result = planSurveyResult(d, { recordId: " r_1 ", instructorSatisfaction: "4.7", n: "26.0", posPct: "96.2", manager: "om@day1company.co.kr" });
  assert.deepEqual(result, {
    operationId: "OP-260455",
    recordId: "r_1",
    overall: "4.55",
    instructorSatisfaction: "4.7",
    respondents: 26,
    positiveRate: "96.2",
    appliedBy: "om@day1company.co.kr"
  });
});

test("만족도 결과: 종합이 이미 같은 값이어도 남긴다(응답자 수·코멘트는 최신으로)", () => {
  const d = planRoundApply("4.55", matched(), find(target("4.55")));
  const comments = { status: "ok" as const, positive: ["실습이 유용함"], instructorImprove: [], hrdImprove: ["냉방 개선"], followup: [] };
  const result = planSurveyResult(d, { comments });
  assert.equal(result?.operationId, "OP-260455");
  assert.deepEqual(result?.comments, comments);
});

test("만족도 결과: 코멘트 키가 없던 요청은 comments를 빼서 기존 코멘트를 지우지 않는다", () => {
  const d = planRoundApply("4.55", matched(), find(target("")));
  const result = planSurveyResult(d, { n: "10" });
  assert.ok(result);
  assert.equal("comments" in result, false);
});

test("만족도 결과: 모호·미매칭·종합 비어 있음이면 남기지 않고, 5점 밖 강사 값은 비운다", () => {
  assert.equal(planSurveyResult(planRoundApply("4.55", { row: row(), status: "ambiguous", operationId: null, ranked: [] }, find(undefined)), {}), null);
  assert.equal(planSurveyResult(planRoundApply("4.55", { row: row(), status: "unmatched", operationId: null, ranked: [] }, find(undefined)), {}), null);
  assert.equal(planSurveyResult(planRoundApply("", matched(), find(target(""))), {}), null);
  const d = planRoundApply("4.55", matched(), find(target("")));
  assert.equal(planSurveyResult(d, { instructorSatisfaction: "6.2", n: "abc" })?.instructorSatisfaction, null);
  assert.equal(planSurveyResult(d, { n: "abc" })?.respondents, null);
});
