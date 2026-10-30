import assert from "node:assert/strict";
import test from "node:test";
import type { OperationSession } from "./operationTypes";
import { mergeCourseAndRoundNoteField, planMergeCourseAndRoundNotes } from "./mergeCourseAndRoundNotes";

function row(values: Partial<OperationSession>): OperationSession {
  return { courseRecordId: "course-1", specialNotes: "", operationIssue: "", omUpdate: "", roundNo: "1", ...values } as OperationSession;
}

test("과정공통만 있고 회차는 비어있으면 그대로 둔다", () => {
  const result = mergeCourseAndRoundNoteField("공통 내용", []);
  assert.deepEqual(result, { value: "공통 내용", changed: false });
});

test("회차만 있고 모두 비어있지 않으면 접두사 없이 올린다", () => {
  const result = mergeCourseAndRoundNoteField("", [{ roundNo: "1", value: "회차 내용" }]);
  assert.deepEqual(result, { value: "회차 내용", changed: true });
});

test("둘 다 같으면(완전히 같은 문자열) 변경 없음으로 본다", () => {
  const result = mergeCourseAndRoundNoteField("같은 내용", [
    { roundNo: "1", value: "같은 내용" },
    { roundNo: "2", value: "같은 내용" }
  ]);
  assert.deepEqual(result, { value: "같은 내용", changed: false });
});

test("회차별 값이 전부 같지만 과정공통과는 다르면 접두사 없이 이어붙인다", () => {
  const result = mergeCourseAndRoundNoteField("공통", [
    { roundNo: "1", value: "회차공통값" },
    { roundNo: "2", value: "회차공통값" }
  ]);
  assert.deepEqual(result, { value: "공통\n회차공통값", changed: true });
});

test("회차끼리 서로 다르면 회차 번호 접두사를 붙여 이어붙인다", () => {
  const result = mergeCourseAndRoundNoteField("", [
    { roundNo: "1", value: "첫 회차 내용" },
    { roundNo: "2", value: "둘째 회차 내용" }
  ]);
  assert.deepEqual(result, { value: "[1회차] 첫 회차 내용\n[2회차] 둘째 회차 내용", changed: true });
});

test("과정공통 값이 있고 회차끼리도 서로 다르면 공통은 접두사 없이, 회차는 접두사를 붙여 모두 남긴다", () => {
  const result = mergeCourseAndRoundNoteField("공통 내용", [
    { roundNo: "1", value: "첫 회차 내용" },
    { roundNo: "2", value: "둘째 회차 내용" }
  ]);
  assert.deepEqual(result, { value: "공통 내용\n[1회차] 첫 회차 내용\n[2회차] 둘째 회차 내용", changed: true });
});

test("회차 값이 과정공통과 글자 그대로 같으면 그 회차는 중복 추가하지 않는다", () => {
  const result = mergeCourseAndRoundNoteField("공통 내용", [
    { roundNo: "1", value: "공통 내용" },
    { roundNo: "2", value: "둘째 회차 내용" }
  ]);
  assert.deepEqual(result, { value: "공통 내용\n[2회차] 둘째 회차 내용", changed: true });
});

test("회차 번호 순서대로 접두사가 붙는다(입력 순서가 섞여 있어도)", () => {
  const result = mergeCourseAndRoundNoteField("", [
    { roundNo: "3", value: "셋째" },
    { roundNo: "1", value: "첫째" },
    { roundNo: "2", value: "둘째" }
  ]);
  assert.deepEqual(result, { value: "[1회차] 첫째\n[2회차] 둘째\n[3회차] 셋째", changed: true });
});

test("재실행(멱등성): 이미 합쳐진 결과를 다시 넣으면 더 늘어나지 않는다", () => {
  const first = mergeCourseAndRoundNoteField("공통 내용", [
    { roundNo: "1", value: "첫 회차 내용" },
    { roundNo: "2", value: "둘째 회차 내용" }
  ]);
  const second = mergeCourseAndRoundNoteField(first.value, [
    { roundNo: "1", value: "첫 회차 내용" },
    { roundNo: "2", value: "둘째 회차 내용" }
  ]);
  assert.deepEqual(second, { value: first.value, changed: false });
});

test("재실행(멱등성): 회차끼리 값이 전부 같은 경우도 다시 늘어나지 않는다", () => {
  const first = mergeCourseAndRoundNoteField("", [
    { roundNo: "1", value: "회차공통값" },
    { roundNo: "2", value: "회차공통값" }
  ]);
  const second = mergeCourseAndRoundNoteField(first.value, [
    { roundNo: "1", value: "회차공통값" },
    { roundNo: "2", value: "회차공통값" }
  ]);
  assert.deepEqual(second, { value: first.value, changed: false });
});

test("빈 값은 무시한다", () => {
  const result = mergeCourseAndRoundNoteField("  ", [{ roundNo: "1", value: "   " }, { roundNo: "2", value: "실제값" }]);
  assert.deepEqual(result, { value: "실제값", changed: true });
});

test("회차 번호가 같은 값을 여러 회차가 공유하면 라벨을 묶는다", () => {
  const result = mergeCourseAndRoundNoteField("", [
    { roundNo: "1", value: "A" },
    { roundNo: "2", value: "A" },
    { roundNo: "3", value: "B" }
  ]);
  assert.deepEqual(result, { value: "[1,2회차] A\n[3회차] B", changed: true });
});

test("planMergeCourseAndRoundNotes: 과정별로 묶어 필드별 집계와 후보를 만든다", () => {
  const plan = planMergeCourseAndRoundNotes([
    row({ id: "1", courseRecordId: "course-1", roundNo: "1", specialNotes: "첫 회차", operationIssue: "같음", omUpdate: "" }),
    row({ id: "2", courseRecordId: "course-1", roundNo: "2", specialNotes: "둘째 회차", operationIssue: "같음", omUpdate: "" })
  ]);
  assert.equal(plan.courseCount, 1);
  assert.equal(plan.summaryByField.specialNotes.merged, 1);
  assert.equal(plan.summaryByField.operationIssue.merged, 1);
  assert.equal(plan.summaryByField.omUpdate.unchanged, 1);
  assert.equal(plan.candidates.length, 1);
  assert.deepEqual(plan.candidates[0]?.input, {
    specialNotes: "[1회차] 첫 회차\n[2회차] 둘째 회차",
    operationIssue: "같음",
    omUpdate: ""
  });
  assert.deepEqual(plan.candidates[0]?.changedFields, ["specialNotes", "operationIssue"]);
});

test("planMergeCourseAndRoundNotes: 과정 식별자가 없으면 집계에 포함하지 않는다", () => {
  const plan = planMergeCourseAndRoundNotes([row({ id: "1", courseRecordId: undefined, specialNotes: "내용" })]);
  assert.equal(plan.courseCount, 0);
  assert.equal(plan.candidates.length, 0);
});

test("planMergeCourseAndRoundNotes: 기존 과정공통 값을 보존하며 추가로 이어붙인다", () => {
  const plan = planMergeCourseAndRoundNotes([
    row({ id: "1", courseRecordId: "course-1", roundNo: "1", specialNotes: "회차값", courseCommonNote: { specialNotes: "기존 공통값", operationIssue: "", omUpdate: "" } })
  ]);
  assert.equal(plan.candidates[0]?.input.specialNotes, "기존 공통값\n회차값");
});

test("planMergeCourseAndRoundNotes: 재실행하면 더 이상 변경 후보가 없다", () => {
  const operations: OperationSession[] = [
    row({ id: "1", courseRecordId: "course-1", roundNo: "1", specialNotes: "첫 회차" }),
    row({ id: "2", courseRecordId: "course-1", roundNo: "2", specialNotes: "둘째 회차" })
  ];
  const first = planMergeCourseAndRoundNotes(operations);
  const merged = first.candidates[0]!.input;
  const second = planMergeCourseAndRoundNotes(
    operations.map((operation) => ({ ...operation, courseCommonNote: merged }))
  );
  assert.equal(second.candidates.length, 0);
  assert.equal(second.summaryByField.specialNotes.unchanged, 1);
});
