import assert from "node:assert/strict";
import test from "node:test";
import type { OperationSession } from "./operationTypes";
import { planCourseCommonNoteBackfill } from "./courseCommonNoteBackfill";
import { runCourseCommonNoteBackfillCommand } from "./courseCommonNoteBackfillCommand";

function row(values: Partial<OperationSession>): OperationSession {
  return { courseRecordId: "course-1", specialNotes: "", operationIssue: "", omUpdate: "", ...values } as OperationSession;
}

test("같은 회차 메모만 빈 공통 메모의 후보로 만든다", () => {
  const plan = planCourseCommonNoteBackfill([
    row({ id: "1", specialNotes: "same", operationIssue: "first" }),
    row({ id: "2", specialNotes: "same", operationIssue: "second" }),
  ]);
  assert.equal(plan.candidateCount, 1);
  assert.equal(plan.conflictCourseCount, 1);
  assert.deepEqual(plan.candidates[0]?.input, { specialNotes: "same", operationIssue: "", omUpdate: "" });
});

test("기존 공통 메모는 덮어쓰지 않고 없는 항목만 채운다", () => {
  const plan = planCourseCommonNoteBackfill([
    row({ id: "1", specialNotes: "round", omUpdate: "update", courseCommonNote: { specialNotes: "existing", operationIssue: "", omUpdate: "" } }),
  ]);
  assert.deepEqual(plan.candidates[0]?.input, { specialNotes: "existing", operationIssue: "", omUpdate: "update" });
  assert.equal(plan.skippedExistingFieldCount, 1);
});

test("과정 식별자가 없거나 내용이 비어 있으면 반영하지 않는다", () => {
  const plan = planCourseCommonNoteBackfill([row({ id: "1", courseRecordId: undefined })]);
  assert.equal(plan.courseCount, 0);
  assert.equal(plan.candidateCount, 0);
});

test("dry-run은 쓰지 않고 apply는 두 확인 플래그가 있어야 쓴다", async () => {
  let writes = 0;
  const repository = {
    async listOperations() { return [row({ id: "1", specialNotes: "same" })]; },
    async upsertCourseCommonNote() { writes++; return { specialNotes: "same", operationIssue: "", omUpdate: "" }; },
  };
  const dependencies = { repository: () => repository as never, close: async () => {} };
  const dry = await runCourseCommonNoteBackfillCommand([], () => {}, dependencies);
  assert.equal(dry.candidateCount, 1);
  assert.equal(writes, 0);
  await assert.rejects(runCourseCommonNoteBackfillCommand(["--apply"], () => {}, dependencies), /COURSE_COMMON_NOTE_BACKFILL_CONFIRMATION_REQUIRED/);
  const applied = await runCourseCommonNoteBackfillCommand(["--apply", "--backup-confirmed", "--maintenance-confirmed"], () => {}, dependencies);
  assert.equal(applied.updatedCount, 1);
  assert.equal(writes, 1);
});
