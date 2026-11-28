import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeInstructorName } from "./instructorContractMatch";
import { parseSessionInstructorNames, planSessionInstructorSync, planSessionInstructorsByIds, type ExistingSessionInstructorEngagement } from "./sessionInstructorSync";

function nameMap(...names: Array<[string, string]>): Map<string, string> {
  return new Map(names.map(([name, id]) => [normalizeInstructorName(name), id]));
}

function eng(id: string, instructorNoteId: string, source: "CONTRACT" | "MANUAL", status = "SCHEDULED"): ExistingSessionInstructorEngagement {
  return { id, instructorNoteId, source, status };
}

test("parseSessionInstructorNames: 콤마·슬래시 구분, 괄호 소속주석·공백 제거", () => {
  assert.deepEqual(parseSessionInstructorNames("최선신"), ["최선신"]);
  assert.deepEqual(parseSessionInstructorNames("이요한(존코바)"), ["이요한"]);
  assert.deepEqual(parseSessionInstructorNames("최선신, 정을수"), ["최선신", "정을수"]);
  assert.deepEqual(parseSessionInstructorNames("최선신 / 정을수"), ["최선신", "정을수"]);
  assert.deepEqual(parseSessionInstructorNames(""), []);
  assert.deepEqual(parseSessionInstructorNames(null), []);
});

test("명단에 있고 투입이 없으면 MANUAL 생성 대상", () => {
  const plan = planSessionInstructorSync("최선신", [], nameMap(["최선신", "n1"]));
  assert.deepEqual(plan.createInstructorNoteIds, ["n1"]);
  assert.deepEqual(plan.convertEngagementIds, []);
  assert.deepEqual(plan.reactivateEngagementIds, []);
  assert.deepEqual(plan.cancelEngagementIds, []);
  assert.deepEqual(plan.unmatchedNames, []);
});

test("이미 활성 MANUAL 투입이 있으면 다시 만들지 않는다(멱등)", () => {
  const plan = planSessionInstructorSync("최선신", [eng("e1", "n1", "MANUAL")], nameMap(["최선신", "n1"]));
  assert.deepEqual(plan.createInstructorNoteIds, []);
  assert.deepEqual(plan.convertEngagementIds, []);
  assert.deepEqual(plan.reactivateEngagementIds, []);
  assert.deepEqual(plan.cancelEngagementIds, []);
});

test("명단 강사의 활성 CONTRACT 투입은 MANUAL로 전환(삭제·재생성 아님)", () => {
  const plan = planSessionInstructorSync("최선신", [eng("c1", "n1", "CONTRACT")], nameMap(["최선신", "n1"]));
  assert.deepEqual(plan.createInstructorNoteIds, []);
  assert.deepEqual(plan.convertEngagementIds, ["c1"]);
  assert.deepEqual(plan.cancelEngagementIds, []);
});

test("CONTRACT가 있어도 이미 활성 MANUAL이 있으면 전환하지 않음(중복 방지)", () => {
  const plan = planSessionInstructorSync("최선신", [eng("m1", "n1", "MANUAL"), eng("c1", "n1", "CONTRACT")], nameMap(["최선신", "n1"]));
  assert.deepEqual(plan.createInstructorNoteIds, []);
  assert.deepEqual(plan.convertEngagementIds, []);
});

// --- B: status 반영 (재활성 / 재생성·재취소 방지) ---

test("명단에 다시 든 강사의 취소된 MANUAL은 재활성(재생성 아님)", () => {
  const plan = planSessionInstructorSync("최선신", [eng("m1", "n1", "MANUAL", "CANCELLED")], nameMap(["최선신", "n1"]));
  assert.deepEqual(plan.reactivateEngagementIds, ["m1"]);
  assert.deepEqual(plan.createInstructorNoteIds, []);
  assert.deepEqual(plan.cancelEngagementIds, []);
});

test("취소된 MANUAL은 '존재'로 치지 않아 명단에서 빠져도 다시 취소하지 않는다", () => {
  const plan = planSessionInstructorSync("최선신", [eng("m1", "n1", "MANUAL"), eng("m2", "n2", "MANUAL", "CANCELLED")], nameMap(["최선신", "n1"], ["정을수", "n2"]));
  assert.deepEqual(plan.cancelEngagementIds, []);
});

// --- A: 취소 가드 (완전 해석된 회차에서만 취소) ---

test("명단에서 명백히 빠진 활성 MANUAL은 취소(완전 해석된 회차)", () => {
  const existing: ExistingSessionInstructorEngagement[] = [eng("e1", "n1", "MANUAL"), eng("e2", "n2", "MANUAL")];
  const plan = planSessionInstructorSync("최선신", existing, nameMap(["최선신", "n1"], ["정을수", "n2"]));
  assert.deepEqual(plan.cancelEngagementIds, ["e2"]);
});

test("instructorsText가 비면 취소하지 않는다(미기입과 '제거'를 구분 못 하므로 보류)", () => {
  const plan = planSessionInstructorSync("", [eng("e1", "n1", "MANUAL")], nameMap(["최선신", "n1"]));
  assert.deepEqual(plan.cancelEngagementIds, []);
  assert.deepEqual(plan.createInstructorNoteIds, []);
});

test("명단에 못 푼 이름이 하나라도 있으면 그 회차는 취소 보류(동명이인·오타 보호)", () => {
  const existing: ExistingSessionInstructorEngagement[] = [eng("e2", "n2", "MANUAL")];
  const plan = planSessionInstructorSync("최선신, 없는강사", existing, nameMap(["최선신", "n1"]));
  assert.deepEqual(plan.unmatchedNames, ["없는강사"]);
  assert.deepEqual(plan.createInstructorNoteIds, ["n1"]);
  assert.deepEqual(plan.cancelEngagementIds, []);
});

test("강사위키에서 못 찾은 이름은 투입을 만들지 않고 unmatched로 모은다", () => {
  const plan = planSessionInstructorSync("최선신, 없는강사", [], nameMap(["최선신", "n1"]));
  assert.deepEqual(plan.createInstructorNoteIds, ["n1"]);
  assert.deepEqual(plan.unmatchedNames, ["없는강사"]);
});

test("instructorsText가 비어도 CONTRACT 투입은 건드리지 않음(계약 정본은 그대로)", () => {
  const plan = planSessionInstructorSync("", [eng("c1", "n1", "CONTRACT")], nameMap(["최선신", "n1"]));
  assert.deepEqual(plan.createInstructorNoteIds, []);
  assert.deepEqual(plan.convertEngagementIds, []);
  assert.deepEqual(plan.cancelEngagementIds, []);
});

// --- ID 직접 선택 경로(운영현황 입력) ---

test("planSessionInstructorsByIds: 선택 ID로 생성/취소, allowCancel 가드", () => {
  // n1 선택, n2는 기존 활성 MANUAL. allowCancel=true면 n2 취소, n1 생성.
  const existing: ExistingSessionInstructorEngagement[] = [eng("e2", "n2", "MANUAL")];
  const on = planSessionInstructorsByIds(["n1"], existing, true);
  assert.deepEqual(on.createInstructorNoteIds, ["n1"]);
  assert.deepEqual(on.cancelEngagementIds, ["e2"]);
  // allowCancel=false(빈 선택 보호 대칭)면 취소 안 함
  const off = planSessionInstructorsByIds(["n1"], existing, false);
  assert.deepEqual(off.cancelEngagementIds, []);
});
