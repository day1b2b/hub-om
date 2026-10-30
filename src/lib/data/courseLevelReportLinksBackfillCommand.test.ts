import assert from "node:assert/strict";
import test from "node:test";
import type { OperationSession } from "./operationTypes";
import { runCourseLevelReportLinksBackfillCommand } from "./courseLevelReportLinksBackfillCommand";

function row(values: Partial<OperationSession>): OperationSession {
  return {
    courseRecordId: "course-1",
    companyName: "샘플기업",
    courseName: "샘플과정",
    resultReportLink: "",
    lectureManagementLink: "",
    lectureManagementNote: "",
    ...values
  } as OperationSession;
}

test("dry-run은 쓰지 않고 apply는 두 확인 플래그가 있어야 쓴다", async () => {
  const writes: string[] = [];
  const repository = {
    async listOperations() {
      return [row({ id: "1", resultReportLink: "https://docs.example/a", lectureManagementLink: "https://docs.example/b" })];
    },
    async upsertCourseReportLink() { writes.push("report-link"); return "https://docs.example/a"; },
    async upsertCourseLectureManagement() { writes.push("lecture-management"); return { lectureManagementLink: "https://docs.example/b", lectureManagementNote: "" }; }
  };
  const dependencies = { repository: () => repository as never, close: async () => {} };

  const dry = await runCourseLevelReportLinksBackfillCommand([], () => {}, dependencies);
  assert.equal(dry.summaryByField.resultReportLink.candidates, 1);
  assert.equal(dry.summaryByField.lectureManagementLink.candidates, 1);
  assert.equal(writes.length, 0);

  await assert.rejects(
    runCourseLevelReportLinksBackfillCommand(["--apply"], () => {}, dependencies),
    /COURSE_LEVEL_REPORT_LINKS_BACKFILL_CONFIRMATION_REQUIRED/
  );
  assert.equal(writes.length, 0);

  const applied = await runCourseLevelReportLinksBackfillCommand(["--apply", "--backup-confirmed", "--maintenance-confirmed"], () => {}, dependencies);
  assert.equal(applied.updatedCourseCount, 1);
  assert.deepEqual(writes, ["report-link", "lecture-management"]);
});

test("충돌 목록에는 과정명/기업명만 담고 실제 값은 담지 않는다", async () => {
  const repository = {
    async listOperations() {
      return [
        row({ id: "1", lectureManagementLink: "https://docs.example/a" }),
        row({ id: "2", lectureManagementLink: "https://docs.example/different" })
      ];
    },
    async upsertCourseReportLink() { return ""; },
    async upsertCourseLectureManagement() { return { lectureManagementLink: "", lectureManagementNote: "" }; }
  };
  const dependencies = { repository: () => repository as never, close: async () => {} };

  const result = await runCourseLevelReportLinksBackfillCommand([], () => {}, dependencies);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(Object.keys(result.conflicts[0]).sort(), ["companyName", "courseName", "courseRecordId", "field"]);
  assert.equal(result.conflicts[0].field, "lectureManagementLink");
});
