import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditCoachEvaluation,
  canViewCoachEvaluations,
  coachPolicyOwnerEmails,
  evaluationAverage,
  evidenceRequired,
  isEngagementEvaluable,
  validateOmEvaluationInput
} from "./coachEvaluationRules";

const allFours = { practiceSupport: 4, fieldOperation: 4, communication: 4, leading: 4, punctuality: 4 };

test("역할에 맞는 항목만 받고 나머지 점수는 버린다", () => {
  const result = validateOmEvaluationInput({ role: "OPERATION_ASSISTANT", scores: allFours, rehire: "YES" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.scores, { practiceSupport: null, fieldOperation: 4, communication: 4, leading: null, punctuality: 4 });

  const coach = validateOmEvaluationInput({ role: "PRACTICE_COACH", scores: allFours, rehire: "YES" });
  assert.equal(coach.ok && coach.value.scores.leading, null);
  const lead = validateOmEvaluationInput({ role: "LEAD", scores: allFours, rehire: "YES" });
  assert.equal(lead.ok && lead.value.scores.leading, 4);
});

test("역할·점수·재투입 의향이 빠지면 거절한다", () => {
  assert.match((validateOmEvaluationInput({ scores: allFours, rehire: "YES" }) as { error: string }).error, /역할/);
  assert.match((validateOmEvaluationInput({ role: "LEAD", scores: { ...allFours, leading: null }, rehire: "YES" }) as { error: string }).error, /리딩/);
  assert.match((validateOmEvaluationInput({ role: "LEAD", scores: allFours }) as { error: string }).error, /재투입/);
});

test("시간 준수는 최고 4점, 다른 항목은 1~5점", () => {
  assert.equal(validateOmEvaluationInput({ role: "PRACTICE_COACH", scores: { ...allFours, punctuality: 5 }, rehire: "YES" }).ok, false);
  assert.equal(validateOmEvaluationInput({ role: "PRACTICE_COACH", scores: { ...allFours, communication: 0 }, rehire: "YES" }).ok, false);
  assert.equal(validateOmEvaluationInput({ role: "PRACTICE_COACH", scores: { ...allFours, communication: 4.5 }, rehire: "YES" }).ok, false);
});

test("5점이나 3점 이하가 있으면 근거가 필요하다", () => {
  assert.equal(evidenceRequired("PRACTICE_COACH", allFours), false);
  assert.equal(evidenceRequired("PRACTICE_COACH", { ...allFours, communication: 5 }), true);
  assert.equal(evidenceRequired("PRACTICE_COACH", { ...allFours, punctuality: 3 }), true);
  // 역할에 해당하지 않는 항목은 따지지 않는다.
  assert.equal(evidenceRequired("PRACTICE_COACH", { ...allFours, leading: 2 }), false);

  const missing = validateOmEvaluationInput({ role: "PRACTICE_COACH", scores: { ...allFours, communication: 5 }, rehire: "YES", evidence: "  " });
  assert.equal(missing.ok, false);
  const given = validateOmEvaluationInput({ role: "PRACTICE_COACH", scores: { ...allFours, communication: 5 }, rehire: "YES", evidence: " 교육생 반응이 좋았음 " });
  assert.equal(given.ok && given.value.evidence, "교육생 반응이 좋았음");
});

test("조건부·아니오는 사유가 필요하고, 예는 사유를 저장하지 않는다", () => {
  assert.equal(validateOmEvaluationInput({ role: "PRACTICE_COACH", scores: allFours, rehire: "NO" }).ok, false);
  assert.equal(validateOmEvaluationInput({ role: "PRACTICE_COACH", scores: allFours, rehire: "CONDITIONAL" }).ok, false);
  const yes = validateOmEvaluationInput({ role: "PRACTICE_COACH", scores: allFours, rehire: "YES", rehireReason: "남은 메모" });
  assert.equal(yes.ok && yes.value.rehireReason, null);
});

test("선택 칸은 허용된 값만 남긴다", () => {
  const result = validateOmEvaluationInput({ role: "PRACTICE_COACH", scores: allFours, rehire: "YES", practiceDifficulty: "Z", audience: "EXECUTIVE", isNewClient: "yes" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.detail, { role: "PRACTICE_COACH", practiceDifficulty: null, audience: "EXECUTIVE", isNewClient: null });
});

test("평균은 시간 준수를 빼고 역할 항목만 계산한다", () => {
  assert.equal(evaluationAverage("PRACTICE_COACH", { practiceSupport: 5, fieldOperation: 4, communication: 3, leading: 1, punctuality: 1 }), 4);
  assert.equal(evaluationAverage("OPERATION_ASSISTANT", { practiceSupport: 1, fieldOperation: 4, communication: 5, leading: null, punctuality: 2 }), 4.5);
  assert.equal(evaluationAverage("LEAD", { practiceSupport: 4, fieldOperation: 4, communication: 4, leading: 5, punctuality: 4 }), 4.25);
  assert.equal(evaluationAverage("LEAD", {}), null);
});

test("원문 열람은 OM·LD·정책 담당자, 수정은 작성자·정책 담당자", () => {
  const om = { email: "om@day1company.co.kr", roles: ["om"] as const, isPolicyOwner: false };
  const intern = { email: "intern@day1company.co.kr", roles: [] as const, isPolicyOwner: false };
  const owner = { email: "owner@day1company.co.kr", roles: [] as const, isPolicyOwner: true };
  assert.equal(canViewCoachEvaluations(om), true);
  assert.equal(canViewCoachEvaluations(intern), false);
  assert.equal(canViewCoachEvaluations(owner), true);
  assert.equal(canEditCoachEvaluation(om, " OM@day1company.co.kr "), true);
  assert.equal(canEditCoachEvaluation(om, "other@day1company.co.kr"), false);
  assert.equal(canEditCoachEvaluation(owner, "other@day1company.co.kr"), true);
});

test("정책 담당자 목록은 소문자·공백 제거, 비어 있으면 없음", () => {
  assert.deepEqual(coachPolicyOwnerEmails({ COACH_POLICY_OWNER_EMAILS: " A@day1company.co.kr, ,b@day1company.co.kr " }), ["a@day1company.co.kr", "b@day1company.co.kr"]);
  assert.deepEqual(coachPolicyOwnerEmails({}), []);
});

test("평가는 끝난 투입(종료일 당일 포함)에만 쓴다", () => {
  assert.equal(isEngagementEvaluable("2026-10-24", "2026-10-25"), true);
  assert.equal(isEngagementEvaluable("2026-10-25", "2026-10-25"), true);
  assert.equal(isEngagementEvaluable("2026-10-26", "2026-10-25"), false);
});
