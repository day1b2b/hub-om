import assert from "node:assert/strict";
import test from "node:test";
import { getCourseNoteCandidates } from "./CourseNotesCandidates";
import type { OperationSession } from "@/lib/data/operationTypes";

function operation(values: Partial<OperationSession>): OperationSession {
  return {
    id: "id", operationId: "operation", courseId: "course", courseIdLabel: "", companyName: "company",
    courseName: "course", courseCategory: "", tools: "", om: "", ld: "", onsiteOm: "", operationStatus: "배정필요",
    archiveStatus: "아카이빙전", educationFormat: "오프라인", educationFormatRaw: "", operationChannel: "onsite",
    operationType: "단기", operationTypeRaw: "", roundNo: "1", educationDays: "1", educationDates: [], startDate: "2099-01-01",
    endDate: "2099-01-01", operationMonth: "2099-01", sessionDurationDays: null, sessionDurationType: "단기", timeText: "",
    instructors: "", coach: "", region: "", onsiteRequired: "N", onsiteText: "", specialNotes: "", operationIssue: "",
    omUpdate: "", driveLink: "", operationDetail: "", companyWikiLink: "", instructorWikiLink: "", revenue: null, costRaw: "",
    profitRaw: "", totalCost: null, instructorCost: null, operationCost: null, profit: null, avgSatisfaction: "",
    instructorSatisfaction: "", hasSatisfactionSurvey: "불필요", hasResultReport: "무", resultReportLink: "", lectureManagementLink: "",
    lectureManagementNote: "", padletLink: "", validationStatus: "정상", validationErrors: [], ...values
  };
}

test("같은 메모가 두 회차에 있으면 공통 후보로 표시한다", () => {
  const rows = getCourseNoteCandidates([
    operation({ roundNo: "1", specialNotes: "공통 내용" }),
    operation({ id: "id2", operationId: "operation2", roundNo: "2", specialNotes: "공통 내용" })
  ]);
  assert.equal(rows.find((row) => row.field === "specialNotes")?.commonCandidate, true);
});

test("회차별 내용이 다르면 공통 후보로 이동하지 않는다", () => {
  const rows = getCourseNoteCandidates([
    operation({ roundNo: "1", specialNotes: "첫 회차" }),
    operation({ id: "id2", operationId: "operation2", roundNo: "2", specialNotes: "둘째 회차" })
  ]);
  assert.equal(rows.find((row) => row.field === "specialNotes")?.commonCandidate, false);
});
