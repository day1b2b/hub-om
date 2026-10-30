import assert from "node:assert/strict";
import test from "node:test";
import type { OmRequest } from "./omRequest/omRequestTypes";
import type { OperationSession } from "./operationTypes";
import { buildCourseMergeReviewRows, courseMergeReviewCsv, planSyncupRequestNoteCleanup } from "./courseMergeReview";

function round(operationId: string, courseRecordId: string, roundNo: string, fields: Partial<OperationSession> = {}): OperationSession {
  return {
    operationId, courseRecordId, roundNo, companyName: "합성기업", courseName: `과정-${courseRecordId}`, om: "OM", ld: "LD",
    startDate: "2026-01-0" + roundNo, endDate: "2026-01-0" + roundNo, operationDetail: "", lectureManagementLink: "", lectureManagementNote: "",
    resultReportLink: "", specialNotes: "", operationIssue: "", omUpdate: "", ...fields
  } as OperationSession;
}
const request = (operationId: string, notes: string) => ({ operationId, notes }) as OmRequest;

test("싱크업: 링크는 유지, 요청사항과 같은 문장만 정리 대상, 다른 글자는 직접 확인", () => {
  const operations = [
    round("a1", "A", "1", { operationDetail: "지난 5월 과정 복제" }),
    round("a2", "A", "2", { operationDetail: "지난 5월 과정 복제" }),
    round("b1", "B", "1", { operationDetail: "https://docs.google.com/syncup" }),
    round("c1", "C", "1", { operationDetail: "사람이 적은 다른 메모" })
  ];
  const plan = planSyncupRequestNoteCleanup(operations, [request("a1", "지난 5월 과정 복제"), request("c1", "요청사항 원문")]);
  assert.deepEqual([plan.roundsWithValue, plan.linkRounds, plan.requestNoteRounds, plan.manualRounds], [4, 1, 2, 1]);
  assert.deepEqual(plan.courses.map((course) => [course.courseRecordId, course.operationIds, course.commonNote.specialNotes]), [["A", ["a1", "a2"], "지난 5월 과정 복제"]]);
  assert.deepEqual(plan.manual.map((item) => item.operationId), ["c1"]);
});

test("싱크업: 공통 특이사항이 이미 있으면 덮어쓰지 않고 뒤에 붙이고, 이미 들어 있으면 그대로 둔다", () => {
  const common = { specialNotes: "기존 특이사항", operationIssue: "이슈", omUpdate: "업데이트" };
  const appended = planSyncupRequestNoteCleanup([round("a1", "A", "1", { operationDetail: "요청 문장", courseCommonNote: common } as Partial<OperationSession>)], [request("a1", "요청 문장")]);
  assert.equal(appended.courses[0].commonNote.specialNotes, "기존 특이사항\n\n[업무 요청 요청사항]\n요청 문장");
  assert.equal(appended.courses[0].commonNote.operationIssue, "이슈");
  assert.equal(appended.courses[0].commonNoteChanged, true);
  const already = planSyncupRequestNoteCleanup([round("a1", "A", "1", { operationDetail: "요청 문장", courseCommonNote: { ...common, specialNotes: "요청 문장" } } as Partial<OperationSession>)], [request("a1", "요청 문장")]);
  assert.equal(already.courses[0].commonNoteChanged, false);
  assert.deepEqual(already.courses[0].operationIds, ["a1"]);
});

test("확인 목록: 회차마다 다른 강의관리 링크·공통 메모·링크 아닌 싱크업만 회차별 값으로 펼친다", () => {
  const operations = [
    round("a1", "A", "1", { lectureManagementLink: "https://x.example/1", specialNotes: "메모1" }),
    round("a2", "A", "2", { lectureManagementLink: "https://y.example/2", specialNotes: "메모1" }),
    round("b1", "B", "1", { operationIssue: "이슈만 1회차", operationDetail: "사람 메모" }),
    round("b2", "B", "2")
  ];
  const rows = buildCourseMergeReviewRows(operations, []);
  assert.deepEqual(rows.map((row) => [row.item, row.operationId, row.value]), [
    ["강의관리 링크", "a1", "https://x.example/1"],
    ["강의관리 링크", "a2", "https://y.example/2"],
    ["공통 메모 - 운영 이슈", "b1", "이슈만 1회차"],
    ["싱크업 (링크 아님)", "b1", "사람 메모"]
  ]);
  const csv = courseMergeReviewCsv([{ ...rows[0], value: "=HYPERLINK(1)" }]);
  assert.ok(csv.startsWith("﻿항목,"));
  assert.ok(csv.includes("'=HYPERLINK(1)"), "엑셀 수식 실행 방지");
});
