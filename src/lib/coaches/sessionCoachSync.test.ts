import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCoachName } from "./accessToken";
import { parseSessionCoachNames, planSessionCoachSync, type ExistingSessionEngagement } from "./sessionCoachSync";

function nameMap(...names: Array<[string, string]>): Map<string, string> {
  return new Map(names.map(([name, id]) => [normalizeCoachName(name), id]));
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
  assert.deepEqual(plan.removeEngagementIds, []);
  assert.deepEqual(plan.supersedeEngagementIds, []);
  assert.deepEqual(plan.unmatchedNames, []);
});

test("이미 MANUAL 투입이 있으면 다시 만들지 않는다(멱등)", () => {
  const existing: ExistingSessionEngagement[] = [{ id: "e1", coachId: "c1", source: "MANUAL" }];
  const plan = planSessionCoachSync("김시은", existing, nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.createCoachIds, []);
  assert.deepEqual(plan.removeEngagementIds, []);
});

test("명단에서 빠진 MANUAL 투입은 제거 대상", () => {
  const existing: ExistingSessionEngagement[] = [
    { id: "e1", coachId: "c1", source: "MANUAL" },
    { id: "e2", coachId: "c2", source: "MANUAL" }
  ];
  // 명단엔 c1(김시은)만 남음 → c2 투입 제거
  const plan = planSessionCoachSync("김시은", existing, nameMap(["김시은", "c1"], ["이영희", "c2"]));
  assert.deepEqual(plan.createCoachIds, []);
  assert.deepEqual(plan.removeEngagementIds, ["e2"]);
});

test("명단 코치의 기존 SHEET 투입은 MANUAL이 대체(supersede)", () => {
  const existing: ExistingSessionEngagement[] = [{ id: "s1", coachId: "c1", source: "SHEET" }];
  const plan = planSessionCoachSync("김시은", existing, nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.createCoachIds, ["c1"]); // MANUAL 신규 생성
  assert.deepEqual(plan.supersedeEngagementIds, ["s1"]); // 같은 회차 SHEET 투입은 대체
});

test("코치위키에서 못 찾은 이름은 투입을 만들지 않고 unmatched로 모은다", () => {
  const plan = planSessionCoachSync("김시은, 없는코치", [], nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.createCoachIds, ["c1"]);
  assert.deepEqual(plan.unmatchedNames, ["없는코치"]);
});

test("실습코치 칸이 비면 이 회차의 MANUAL 투입을 모두 제거(코치 미확정/취소)", () => {
  const existing: ExistingSessionEngagement[] = [{ id: "e1", coachId: "c1", source: "MANUAL" }];
  const plan = planSessionCoachSync("", existing, nameMap(["김시은", "c1"]));
  assert.deepEqual(plan.removeEngagementIds, ["e1"]);
  assert.deepEqual(plan.createCoachIds, []);
});
