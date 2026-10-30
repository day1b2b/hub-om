import assert from "node:assert/strict";
import test from "node:test";
import type { OperationSession } from "./operationTypes";
import { runResultReportStatusPromotionCommand } from "./resultReportStatusPromotionCommand";

function row(values: Partial<OperationSession>): OperationSession {
  return {
    courseRecordId: "course-1",
    companyName: "샘플기업",
    courseName: "샘플과정",
    hasResultReport: "확인필요",
    ...values
  } as OperationSession;
}

test("dry-run은 쓰지 않고 apply는 두 확인 플래그가 있어야 쓴다", async () => {
  const writes: string[] = [];
  const repository = {
    async listOperations() {
      return [row({ id: "1", hasResultReport: "유" })];
    },
    async upsertCourseResultReportStatus(courseRecordId: string, value: string) { writes.push(`${courseRecordId}:${value}`); return value; }
  };
  const dependencies = { repository: () => repository as never, close: async () => {} };

  const dry = await runResultReportStatusPromotionCommand([], () => {}, dependencies);
  assert.equal(dry.summary.promotedYes, 1);
  assert.equal(writes.length, 0);

  await assert.rejects(
    runResultReportStatusPromotionCommand(["--apply"], () => {}, dependencies),
    /RESULT_REPORT_STATUS_PROMOTION_CONFIRMATION_REQUIRED/
  );
  assert.equal(writes.length, 0);

  const applied = await runResultReportStatusPromotionCommand(["--apply", "--backup-confirmed", "--maintenance-confirmed"], () => {}, dependencies);
  assert.equal(applied.updatedCourseCount, 1);
  assert.deepEqual(writes, ["course-1:유"]);
});

test("이미 과정 레벨 값이 있는 과정은 apply에서도 다시 쓰지 않는다", async () => {
  const writes: string[] = [];
  const repository = {
    async listOperations() {
      return [row({ id: "1", courseHasResultReport: "불필요" as never, hasResultReport: "무" })];
    },
    async upsertCourseResultReportStatus(courseRecordId: string, value: string) { writes.push(`${courseRecordId}:${value}`); return value; }
  };
  const dependencies = { repository: () => repository as never, close: async () => {} };

  const applied = await runResultReportStatusPromotionCommand(["--apply", "--backup-confirmed", "--maintenance-confirmed"], () => {}, dependencies);
  assert.equal(applied.updatedCourseCount, 0);
  assert.equal(applied.summary.preserved, 1);
  assert.equal(writes.length, 0);
});
