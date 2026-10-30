import assert from "node:assert/strict";
import test from "node:test";
import type { OperationSession, ResultReportStatus } from "./operationTypes";
import { decideCourseResultReportStatus, planResultReportStatusPromotion } from "./resultReportStatusPromotion";

function row(values: Partial<OperationSession>): OperationSession {
  return {
    courseRecordId: "course-1",
    companyName: "샘플기업",
    courseName: "샘플과정",
    hasResultReport: "확인필요",
    ...values
  } as OperationSession;
}

test("하나라도 유면 과정 레벨은 유", () => {
  assert.equal(decideCourseResultReportStatus(["무", "유", "확인필요"]), "유");
  assert.equal(decideCourseResultReportStatus(["불필요", "유"]), "유");
});

test("전부 불필요면 과정 레벨은 불필요", () => {
  assert.equal(decideCourseResultReportStatus(["불필요", "불필요"]), "불필요");
  assert.equal(decideCourseResultReportStatus(["불필요"]), "불필요");
});

test("유는 없고 불필요가 일부만 섞이면 확인필요로 남긴다", () => {
  assert.equal(decideCourseResultReportStatus(["불필요", "무"]), "확인필요");
  assert.equal(decideCourseResultReportStatus(["불필요", "확인필요"]), "확인필요");
  assert.equal(decideCourseResultReportStatus(["불필요", "무", "확인필요"]), "확인필요");
});

test("전부 무면 과정 레벨은 무", () => {
  assert.equal(decideCourseResultReportStatus(["무", "무"]), "무");
  assert.equal(decideCourseResultReportStatus(["무"]), "무");
});

test("불필요/유 없이 확인필요가 섞이면 확인필요로 기운다", () => {
  assert.equal(decideCourseResultReportStatus(["무", "확인필요"]), "확인필요");
  assert.equal(decideCourseResultReportStatus(["확인필요", "확인필요"]), "확인필요");
  assert.equal(decideCourseResultReportStatus(["확인필요"]), "확인필요");
});

test("과정 레벨에 이미 값이 있으면 보존하고 회차 값을 다시 계산하지 않는다", () => {
  const plan = planResultReportStatusPromotion([
    row({ id: "1", hasResultReport: "무", courseHasResultReport: "유" as ResultReportStatus }),
    row({ id: "2", hasResultReport: "무" })
  ]);
  assert.equal(plan.courseCount, 1);
  assert.equal(plan.summary.preserved, 1);
  assert.equal(plan.summary.promotedYes, 0);
  assert.deepEqual(plan.courses[0]?.decision, { kind: "preserved", value: "유" });
});

test("과정 레벨에 값이 없으면 회차 값으로 승격 후보를 만든다", () => {
  const plan = planResultReportStatusPromotion([
    row({ id: "1", hasResultReport: "유" }),
    row({ id: "2", hasResultReport: "무" })
  ]);
  assert.equal(plan.summary.preserved, 0);
  assert.equal(plan.summary.promotedYes, 1);
  assert.deepEqual(plan.courses[0]?.decision, { kind: "promote", value: "유" });
});

test("과정 식별자가 없는 회차는 집계에서 제외한다", () => {
  const plan = planResultReportStatusPromotion([row({ id: "1", courseRecordId: undefined })]);
  assert.equal(plan.courseCount, 0);
  assert.equal(plan.courses.length, 0);
});

test("여러 과정을 각각 독립적으로 판정한다", () => {
  const plan = planResultReportStatusPromotion([
    row({ id: "1", courseRecordId: "course-1", hasResultReport: "불필요" }),
    row({ id: "2", courseRecordId: "course-1", hasResultReport: "불필요" }),
    row({ id: "3", courseRecordId: "course-2", hasResultReport: "무" }),
    row({ id: "4", courseRecordId: "course-2", hasResultReport: "확인필요" })
  ]);
  assert.equal(plan.courseCount, 2);
  const byId = new Map(plan.courses.map(course => [course.courseRecordId, course.decision]));
  assert.deepEqual(byId.get("course-1"), { kind: "promote", value: "불필요" });
  assert.deepEqual(byId.get("course-2"), { kind: "promote", value: "확인필요" });
  assert.equal(plan.summary.promotedNotRequired, 1);
  assert.equal(plan.summary.promotedNeedsReview, 1);
});
