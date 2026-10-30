import assert from "node:assert/strict";
import test from "node:test";
import type { OperationSession } from "./operationTypes";
import { normalizeForComparison, planCourseLevelReportLinksBackfill } from "./courseLevelReportLinksBackfill";

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

test("과정 레벨에 값이 없고 회차 값이 하나뿐이면 자동 반영 후보가 된다", () => {
  const plan = planCourseLevelReportLinksBackfill([
    row({ id: "1", resultReportLink: "https://docs.example/a" }),
    row({ id: "2", resultReportLink: "" })
  ]);
  assert.equal(plan.courseCount, 1);
  assert.deepEqual(plan.summaryByField.resultReportLink, { preserved: 0, candidates: 1, conflicts: 0, empty: 0 });
  assert.deepEqual(plan.courses[0]?.fields.resultReportLink, { kind: "candidate", value: "https://docs.example/a" });
});

test("쿼리스트링/해시만 다른 링크는 충돌로 보지 않는다(같은 문서로 정규화)", () => {
  const plan = planCourseLevelReportLinksBackfill([
    row({ id: "1", resultReportLink: "https://docs.example/a?gid=1#range" }),
    row({ id: "2", resultReportLink: "https://docs.example/a?gid=2" })
  ]);
  assert.equal(normalizeForComparison("https://docs.example/a?gid=1#range"), normalizeForComparison("https://docs.example/a?gid=2"));
  assert.deepEqual(plan.courses[0]?.fields.resultReportLink, { kind: "candidate", value: "https://docs.example/a?gid=1#range" });
  assert.equal(plan.summaryByField.resultReportLink.conflicts, 0);
});

test("정규화 기준으로도 서로 다른 값이 둘 이상이면 충돌로 남기고 반영하지 않는다", () => {
  const plan = planCourseLevelReportLinksBackfill([
    row({ id: "1", lectureManagementLink: "https://docs.example/a" }),
    row({ id: "2", lectureManagementLink: "https://docs.example/b" })
  ]);
  assert.deepEqual(plan.courses[0]?.fields.lectureManagementLink, { kind: "conflict" });
  assert.equal(plan.summaryByField.lectureManagementLink.conflicts, 1);
  assert.equal(plan.summaryByField.lectureManagementLink.candidates, 0);
});

test("이미 과정 레벨에 값이 있으면 덮어쓰지 않고 보존으로 집계한다", () => {
  const plan = planCourseLevelReportLinksBackfill([
    row({ id: "1", resultReportLink: "round-value", courseResultReportLink: "existing-course-value" })
  ]);
  assert.deepEqual(plan.courses[0]?.fields.resultReportLink, { kind: "preserved", value: "existing-course-value" });
  assert.equal(plan.summaryByField.resultReportLink.preserved, 1);
});

test("모든 회차가 비어 있으면 전부 비어있음으로 집계한다", () => {
  const plan = planCourseLevelReportLinksBackfill([
    row({ id: "1", lectureManagementNote: "" }),
    row({ id: "2", lectureManagementNote: "" })
  ]);
  assert.deepEqual(plan.courses[0]?.fields.lectureManagementNote, { kind: "empty" });
  assert.equal(plan.summaryByField.lectureManagementNote.empty, 1);
});

test("과정 식별자가 없으면 집계 대상에서 제외한다", () => {
  const plan = planCourseLevelReportLinksBackfill([row({ id: "1", courseRecordId: undefined })]);
  assert.equal(plan.courseCount, 0);
  assert.equal(plan.courses.length, 0);
});

test("세 필드는 서로 독립적으로 판정한다", () => {
  const plan = planCourseLevelReportLinksBackfill([
    row({ id: "1", resultReportLink: "https://docs.example/a", lectureManagementLink: "https://docs.example/b", lectureManagementNote: "" }),
    row({ id: "2", resultReportLink: "https://docs.example/a", lectureManagementLink: "https://docs.example/different", lectureManagementNote: "" })
  ]);
  assert.equal(plan.courses[0]?.fields.resultReportLink.kind, "candidate");
  assert.equal(plan.courses[0]?.fields.lectureManagementLink.kind, "conflict");
  assert.equal(plan.courses[0]?.fields.lectureManagementNote.kind, "empty");
});
