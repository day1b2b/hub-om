import assert from "node:assert/strict";
import test from "node:test";
import {
  DB_EDUCATION_FORMAT, DB_OPERATION_STATUS, DB_OPERATION_TYPE,
  DB_RESULT_REPORT_STATUS, DB_SATISFACTION_SURVEY_STATUS,
  EDUCATION_FORMAT, OPERATION_STATUS, OPERATION_TYPE, RESULT_REPORT_STATUS,
  SATISFACTION_SURVEY_STATUS, normalizeVisibleText, nullableText, parseDateInput,
  resolveAssigneeText, onsiteRequiredLabel, toOperationSession
} from "./operationRowMapping";
import type { OperationSessionRow } from "./operationRowMapping";

function row(): OperationSessionRow {
  return {
    id: "session-fixture", operationId: "operation-fixture",
    course: {
      id: "course-fixture", processSeq: 123, companyId: "company-fixture", courseId: "COURSE-EXAMPLE",
      name: "Synthetic course", operationType: "SHORT", courseCategory: null, tools: null,
      revenue: "1200.50", company: { id: "company-fixture", name: "Synthetic company" }
    },
    sourceRecords: [{ sourceTeam: "TEAM_2" }], operationStatus: "ACTIVE",
    educationFormat: "REMOTE", operationChannel: "LIVE_ONLINE", onsiteRequired: "N",
    hasSatisfactionSurvey: "NOT_REQUIRED", hasResultReport: "NOT_REQUIRED",
    startDate: new Date("2099-09-01T00:00:00Z"), endDate: new Date("2099-09-03T00:00:00Z"),
    educationDates: [new Date("2099-09-01T00:00:00Z"), new Date("2099-09-03T00:00:00Z")],
    sessionDurationDays: 2, sessionDurationType: "SHORT", totalCost: { toString: () => "200.25" },
    instructorCost: null, operationCost: "0.00", validationErrors: ["synthetic validation", 1, null],
    educationFormatRaw: null, roundNo: null, educationDays: null, operationMonth: null,
    timeText: null, omName: "Synthetic OM", ldName: null, onsiteOmName: null, instructorsText: null,
    coachText: null, region: null, onsiteText: null, specialNotes: null, operationIssue: null,
    omUpdate: null, driveLink: null, operationDetail: null, companyWikiLink: null,
    instructorWikiLink: null, costRaw: null, profitRaw: null, avgSatisfaction: null,
    instructorSatisfaction: null, resultReportLink: null, lectureManagementLink: null,
    lectureManagementNote: null, padletLink: null
  };
}

test("row mapping preserves the complete operation DTO and exact decimal inputs", () => {
  assert.deepEqual(toOperationSession(row(), "Synthetic label"), {
    id: "session-fixture", operationId: "operation-fixture", sourceTeam: "2팀", processId: "PRC-000123",
    courseRecordId: "course-fixture", courseId: "COURSE-EXAMPLE", courseIdLabel: "Synthetic label",
    companyId: "company-fixture", companyName: "Synthetic company", courseName: "Synthetic course",
    courseCategory: "", tools: "", om: "Synthetic OM", ld: "", onsiteOm: "", operationStatus: "진행중",
    archiveStatus: "아카이빙전", educationFormat: "비대면", educationFormatRaw: "", operationChannel: "live_online",
    operationType: "단기", operationTypeRaw: "단기", roundNo: "", educationDays: "",
    educationDates: ["2099-09-01", "2099-09-03"], startDate: "2099-09-01", endDate: "2099-09-03",
    operationMonth: "", sessionDurationDays: 2, sessionDurationType: "단기", timeText: "", instructors: "",
    coach: "", region: "", onsiteRequired: "N", onsiteText: "", specialNotes: "", operationIssue: "",
    omUpdate: "", driveLink: "", operationDetail: "", companyWikiLink: "", instructorWikiLink: "",
    revenue: 1200.5, costRaw: "", profitRaw: "", totalCost: 200.25, instructorCost: null, operationCost: 0,
    profit: 1000.25, avgSatisfaction: "", instructorSatisfaction: "", hasSatisfactionSurvey: "불필요",
    hasResultReport: "불필요", resultReportLink: "", lectureManagementLink: "", lectureManagementNote: "",
    padletLink: "", validationStatus: "검토필요", validationErrors: ["synthetic validation"]
  });
});

test("empty source, legacy nullable fields and invalid numeric data keep existing read behavior", () => {
  const input = row();
  input.sourceRecords = [];
  input.sessionDurationType = null;
  input.validationErrors = { ignored: true };
  input.course.revenue = null;
  input.totalCost = "invalid";
  const result = toOperationSession(input, "");
  assert.equal(result.sourceTeam, "미분류");
  assert.equal(result.sessionDurationType, "검토필요");
  assert.equal(result.validationStatus, "정상");
  assert.deepEqual(result.validationErrors, []);
  assert.equal(result.revenue, null);
  assert.equal(result.totalCost, null);
  assert.equal(result.profit, null);
});

test("runtime labels roundtrip all enum values without importing a database client", () => {
  for (const [forward, reverse] of [
    [OPERATION_STATUS, DB_OPERATION_STATUS], [EDUCATION_FORMAT, DB_EDUCATION_FORMAT],
    [OPERATION_TYPE, DB_OPERATION_TYPE], [RESULT_REPORT_STATUS, DB_RESULT_REPORT_STATUS],
    [SATISFACTION_SURVEY_STATUS, DB_SATISFACTION_SURVEY_STATUS]
  ] as [Record<string, string>, Record<string, string>][]) {
    for (const [stored, label] of Object.entries(forward)) assert.equal(reverse[label], stored);
  }
});

test("strict UTC dates accept leap days and reject rollover and timestamps", () => {
  assert.equal(parseDateInput("2024-02-29", "startDate").toISOString(), "2024-02-29T00:00:00.000Z");
  for (const value of ["2025-02-29", "2024-04-31", "2024-00-01", "2024-13-01", "2024-01-00", "2024-1-01", "2024-01-01T00:00:00Z", ""]) {
    assert.throws(() => parseDateInput(value, "startDate"), /startDate must be a valid date/);
  }
});

test("visible text and roster normalization match existing creation semantics", () => {
  assert.equal(normalizeVisibleText("  sample   one \n\t sample two  "), "sample one\nsample two");
  assert.equal(nullableText(" \n \t"), null);
  const roster = { om: { "1팀": ["SyntheticOM"] }, ld: {} };
  assert.equal(resolveAssigneeText(" Synthetic OM ", "om", roster), "SyntheticOM");
  assert.equal(resolveAssigneeText(" Unknown   owner ", "om", roster), "Unknown owner");
  assert.equal(resolveAssigneeText(" ", "ld", roster), "");
  assert.deepEqual(["Y", "N", "PARTIAL", "UNKNOWN"].map((value) => onsiteRequiredLabel(value as OperationSessionRow["onsiteRequired"])), ["오프라인", "온라인", "일부 오프라인", null]);
});
