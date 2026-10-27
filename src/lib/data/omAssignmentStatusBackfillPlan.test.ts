import assert from "node:assert/strict";
import { test } from "node:test";

import { countOmStatusBackfill, omStatusBackfillValue, type OmStatusBackfillInput } from "@/lib/data/omAssignmentStatusBackfillPlan.ts";

const archived: OmStatusBackfillInput = {
  endDate: new Date("2020-01-02"), courseId: "C-1", lectureManagementNote: "강의관리 시트", avgSatisfaction: "",
  hasSatisfactionSurvey: "NOT_REQUIRED", hasResultReport: "NOT_REQUIRED", resultReportLink: ""
};

test("끝나지 않은 교육만 배정예정으로 올린다", () => {
  assert.equal(omStatusBackfillValue({ ...archived, endDate: new Date("2099-01-02") }), "ASSIGNMENT_PLANNED");
});

test("끝난 교육은 아카이빙 완료 여부로 회고완료/아카이빙필요를 정한다", () => {
  assert.equal(omStatusBackfillValue(archived), "RETROSPECTIVE_DONE");
  assert.equal(omStatusBackfillValue({ ...archived, courseId: null }), "ARCHIVE_NEEDED");
  assert.equal(omStatusBackfillValue({ ...archived, lectureManagementNote: " " }), "ARCHIVE_NEEDED");
  // 결과보고서가 있다고 했는데 링크가 없으면 아카이빙이 끝나지 않았다.
  assert.equal(omStatusBackfillValue({ ...archived, hasResultReport: "YES" }), "ARCHIVE_NEEDED");
  assert.equal(omStatusBackfillValue({ ...archived, hasResultReport: "YES", resultReportLink: "https://example.invalid/report" }), "RETROSPECTIVE_DONE");
  // 만족도 조사를 하는 회차는 만족도 값이 있어야 한다.
  assert.equal(omStatusBackfillValue({ ...archived, hasSatisfactionSurvey: "NEEDS_REVIEW" }), "ARCHIVE_NEEDED");
  assert.equal(omStatusBackfillValue({ ...archived, hasSatisfactionSurvey: "NEEDS_REVIEW", avgSatisfaction: "4.5" }), "RETROSPECTIVE_DONE");
});

test("미리보기 건수는 상태별로 나눠 센다", () => {
  assert.deepEqual(countOmStatusBackfill(["ASSIGNMENT_PLANNED", "ARCHIVE_NEEDED", "ARCHIVE_NEEDED", "RETROSPECTIVE_DONE"]),
    { total: 4, planned: 1, archiveNeeded: 2, retrospectiveDone: 1 });
  assert.deepEqual(countOmStatusBackfill([]), { total: 0, planned: 0, archiveNeeded: 0, retrospectiveDone: 0 });
});
