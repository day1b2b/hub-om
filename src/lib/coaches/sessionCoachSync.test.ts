import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCoachName } from "./accessToken";
import { parseSessionCoachNames, planSessionCoachSync, type ExistingSessionEngagement } from "./sessionCoachSync";

function nameMap(...names: Array<[string, string]>): Map<string, string> {
  return new Map(names.map(([name, id]) => [normalizeCoachName(name), id]));
}

function eng(id: string, coachId: string, source: "SHEET" | "MANUAL", status = "SCHEDULED"): ExistingSessionEngagement {
  return { id, coachId, source, status };
}

test("parseSessionCoachNames: 콤마·슬래시 구분, 괄호 주석·공백 제거", () => {
  assert.deepEqual(parseSessionCoachNames("김시은"), ["김시은"]);
  assert.deepEqual(parseSessionCoachNames("김시은(외부인력)"), ["김시은"]);
  assert.deepEqual(parseSessionCoachNames("김시은, 이영희"), ["김시은", "이영희"]);
  assert.deepEqual(parseSessionCoachNames("김시은 / 이영희"), ["김시은", "이영희"]);
  assert.deepEqual(parseSessionCoachNames(""), []);
  assert.deepEqual(parseSessionCoachNames(null), []);
});

test("명단에 있고 투입이 없으면 MANUAL 생성 대상", () => {
  const plan = planSessionCoachSync("김시은", [], nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.createCoachIds, ["c1"]);
  assert.deepEqual(plan.convertEngagementIds, []);
  assert.deepEqual(plan.reactivateEngagementIds, []);
  assert.deepEqual(plan.cancelEngagementIds, []);
  assert.deepEqual(plan.unmatchedNames, []);
});

test("이미 활성 MANUAL 투입이 있으면 다시 만들지 않는다(멱등)", () => {
  const plan = planSessionCoachSync("김시은", [eng("e1", "c1", "MANUAL")], nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.createCoachIds, []);
  assert.deepEqual(plan.convertEngagementIds, []);
  assert.deepEqual(plan.reactivateEngagementIds, []);
  assert.deepEqual(plan.cancelEngagementIds, []);
});

test("명단 코치의 활성 SHEET 투입은 MANUAL로 전환(삭제·재생성 아님 → 평가 보존)", () => {
  const plan = planSessionCoachSync("김시은", [eng("s1", "c1", "SHEET")], nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.createCoachIds, []);
  assert.deepEqual(plan.convertEngagementIds, ["s1"]);
  assert.deepEqual(plan.cancelEngagementIds, []);
});

test("SHEET가 있어도 이미 활성 MANUAL이 있으면 전환하지 않음(중복 방지)", () => {
  const plan = planSessionCoachSync("김시은", [eng("m1", "c1", "MANUAL"), eng("s1", "c1", "SHEET")], nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.createCoachIds, []);
  assert.deepEqual(plan.convertEngagementIds, []);
});

// --- B: status 반영 (재활성 / 재생성·재취소 방지) ---

test("명단에 다시 든 코치의 취소된 MANUAL은 재활성(재생성 아님)", () => {
  const plan = planSessionCoachSync("김시은", [eng("m1", "c1", "MANUAL", "CANCELLED")], nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.reactivateEngagementIds, ["m1"]);
  assert.deepEqual(plan.createCoachIds, []);       // 새로 만들지 않음
  assert.deepEqual(plan.cancelEngagementIds, []);
});

test("취소된 MANUAL은 '존재'로 치지 않아 명단에서 빠져도 다시 취소하지 않는다", () => {
  // c1만 명단. c2의 MANUAL은 이미 CANCELLED → 재취소 대상 아님.
  const plan = planSessionCoachSync("김시은", [eng("m1", "c1", "MANUAL"), eng("m2", "c2", "MANUAL", "CANCELLED")], nameMap(["김시은", "c1"], ["이영희", "c2"]));
  assert.deepEqual(plan.cancelEngagementIds, []);
});

// --- A: 취소 가드 (완전 해석된 회차에서만 취소) ---

test("명단에서 명백히 빠진 활성 MANUAL은 취소(완전 해석된 회차)", () => {
  const existing: ExistingSessionEngagement[] = [eng("e1", "c1", "MANUAL"), eng("e2", "c2", "MANUAL")];
  // 명단에 c1(김시은)만 남고 전부 매칭됨 → c2 취소
  const plan = planSessionCoachSync("김시은", existing, nameMap(["김시은", "c1"], ["이영희", "c2"]));
  assert.deepEqual(plan.cancelEngagementIds, ["e2"]);
});

test("coachText가 비면 취소하지 않는다(미기입과 '제거'를 구분 못 하므로 보류)", () => {
  const plan = planSessionCoachSync("", [eng("e1", "c1", "MANUAL")], nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.cancelEngagementIds, []);
  assert.deepEqual(plan.createCoachIds, []);
});

test("명단에 못 푼 이름이 하나라도 있으면 그 회차는 취소 보류(동명이인·오타 보호)", () => {
  // coachText엔 김시은(c1 매칭)+없는코치(미매칭). c2의 MANUAL이 있지만 미매칭이 있어 취소 보류.
  const existing: ExistingSessionEngagement[] = [eng("e2", "c2", "MANUAL")];
  const plan = planSessionCoachSync("김시은, 없는코치", existing, nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.unmatchedNames, ["없는코치"]);
  assert.deepEqual(plan.createCoachIds, ["c1"]);
  assert.deepEqual(plan.cancelEngagementIds, []); // 미매칭 존재 → 취소 보류
});

test("코치위키에서 못 찾은 이름은 투입을 만들지 않고 unmatched로 모은다", () => {
  const plan = planSessionCoachSync("김시은, 없는코치", [], nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.createCoachIds, ["c1"]);
  assert.deepEqual(plan.unmatchedNames, ["없는코치"]);
});

test("coachText가 비어도 SHEET 투입은 건드리지 않음(계약시트 정본은 그대로)", () => {
  const plan = planSessionCoachSync("", [eng("s1", "c1", "SHEET")], nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.createCoachIds, []);
  assert.deepEqual(plan.convertEngagementIds, []);
  assert.deepEqual(plan.cancelEngagementIds, []);
});
