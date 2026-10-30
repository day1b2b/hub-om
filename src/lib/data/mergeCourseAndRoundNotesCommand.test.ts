import assert from "node:assert/strict";
import test from "node:test";
import type { OperationSession } from "./operationTypes";
import { runMergeCourseAndRoundNotesCommand } from "./mergeCourseAndRoundNotesCommand";

function row(values: Partial<OperationSession>): OperationSession {
  return { courseRecordId: "course-1", specialNotes: "", operationIssue: "", omUpdate: "", roundNo: "1", ...values } as OperationSession;
}

test("dry-run은 쓰지 않고 apply는 두 확인 플래그가 있어야 쓴다", async () => {
  let writes = 0;
  const repository = {
    async listOperations() {
      return [
        row({ id: "1", roundNo: "1", specialNotes: "첫 회차" }),
        row({ id: "2", roundNo: "2", specialNotes: "둘째 회차" })
      ];
    },
    async upsertCourseCommonNote() { writes++; return { specialNotes: "", operationIssue: "", omUpdate: "" }; }
  };
  const dependencies = { repository: () => repository as never, close: async () => {} };

  const dry = await runMergeCourseAndRoundNotesCommand([], () => {}, dependencies);
  assert.equal(dry.courseCount, 1);
  assert.equal(dry.summaryByField.specialNotes.merged, 1);
  assert.equal(writes, 0);

  await assert.rejects(
    runMergeCourseAndRoundNotesCommand(["--apply"], () => {}, dependencies),
    /MERGE_COURSE_AND_ROUND_NOTES_CONFIRMATION_REQUIRED/
  );

  const applied = await runMergeCourseAndRoundNotesCommand(
    ["--apply", "--backup-confirmed", "--maintenance-confirmed"],
    () => {},
    dependencies
  );
  assert.equal(applied.updatedCount, 1);
  assert.equal(writes, 1);
});

test("변경할 후보가 없으면 apply해도 쓰지 않는다", async () => {
  let writes = 0;
  const repository = {
    async listOperations() {
      return [row({ id: "1", specialNotes: "", operationIssue: "", omUpdate: "" })];
    },
    async upsertCourseCommonNote() { writes++; return { specialNotes: "", operationIssue: "", omUpdate: "" }; }
  };
  const dependencies = { repository: () => repository as never, close: async () => {} };

  const applied = await runMergeCourseAndRoundNotesCommand(
    ["--apply", "--backup-confirmed", "--maintenance-confirmed"],
    () => {},
    dependencies
  );
  assert.equal(applied.updatedCount, 0);
  assert.equal(writes, 0);
});
