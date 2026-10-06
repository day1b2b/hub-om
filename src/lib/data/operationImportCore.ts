import { ArchiveStatus, EducationFormat, OnsiteRequired, OperationChannel, OperationStatus, OperationType, ResultReportStatus, SourceTeam } from "@prisma/client";
import type { OperationImportDependencies, OperationImportEntry, OperationImportSummary } from "./operationImportRepository";
import { normalizeAssigneeNames, roleNamesFromRoster } from "./roleAssignees";

const OPERATION_STATUS: Record<string, OperationStatus> = { "배정필요": OperationStatus.ASSIGNMENT_NEEDED, "배정예정": OperationStatus.ASSIGNMENT_PLANNED, "진행중": OperationStatus.ACTIVE, "완료": OperationStatus.DONE, "회고완료": OperationStatus.RETROSPECTIVE_DONE, "아카이빙필요": OperationStatus.ARCHIVE_NEEDED };
const ARCHIVE_STATUS: Record<string, ArchiveStatus> = { "아카이빙전": ArchiveStatus.NOT_READY, "아카이빙필요": ArchiveStatus.NEEDED, "완료": ArchiveStatus.DONE };
const EDUCATION_FORMAT: Record<string, EducationFormat> = { "오프라인": EducationFormat.OFFLINE, "비대면": EducationFormat.REMOTE, "블렌디드": EducationFormat.BLENDED, "블랜디드": EducationFormat.BLENDED, "플립러닝": EducationFormat.FLIPPED, "검토필요": EducationFormat.NEEDS_REVIEW };
const OPERATION_CHANNEL: Record<string, OperationChannel> = { onsite: OperationChannel.ONSITE, live_online: OperationChannel.LIVE_ONLINE, online_platform: OperationChannel.ONLINE_PLATFORM, blended: OperationChannel.BLENDED, needs_review: OperationChannel.NEEDS_REVIEW };
const OPERATION_TYPE: Record<string, OperationType> = { "특강": OperationType.LECTURE, "단기": OperationType.SHORT, "중기": OperationType.MEDIUM, "중장기": OperationType.MID_TERM_LONG, "준장기": OperationType.MID_LONG, "장기": OperationType.LONG, "연간": OperationType.ANNUAL, "상시형": OperationType.ALWAYS_ON, "검토필요": OperationType.NEEDS_REVIEW };
const ONSITE_REQUIRED: Record<string, OnsiteRequired> = { Y: OnsiteRequired.Y, N: OnsiteRequired.N, PARTIAL: OnsiteRequired.PARTIAL, UNKNOWN: OnsiteRequired.UNKNOWN };
const RESULT_REPORT_STATUS: Record<string, ResultReportStatus> = { "유": ResultReportStatus.YES, "무": ResultReportStatus.NO, "불필요": ResultReportStatus.NOT_REQUIRED, "확인필요": ResultReportStatus.NEEDS_REVIEW, "검토필요": ResultReportStatus.NEEDS_REVIEW };
const SOURCE_TEAM: Record<string, SourceTeam> = { "1팀": SourceTeam.TEAM_1, "2팀": SourceTeam.TEAM_2, "미분류": SourceTeam.UNKNOWN };

export class OperationImportDryRun extends Error {
  readonly summary: OperationImportSummary;
  constructor(summary: OperationImportSummary) { super("OPERATION_IMPORT_DRY_RUN"); this.summary = summary; }
}

export async function importOperationRows(input: OperationImportDependencies, entries: readonly OperationImportEntry[], fileName: string): Promise<OperationImportSummary> {
  const summary = { operations: entries.length, inserted: 0, updated: 0, sourceRecordsInserted: 0, sourceRecordsSkipped: 0 };
  const importRun = await input.port.createImportRun(fileName, entries.length);

  for (const [index, operation] of entries.entries()) {
    const startDate = exactDate(operation.startDate), endDate = exactDate(operation.endDate);
    const existing = (await input.port.findOperationById(operation.operationId))?.id
      ?? (await input.port.findOperationByBusinessKey({ companyName: operation.companyName, courseName: operation.courseName, startDate, endDate }))?.id;
    const sourceFingerprint = `legacy-json:${operation.operationId}`;
    let sessionId = existing;

    const company = await input.port.upsertCompany({ name: operation.companyName, normalizedName: normalizeName(operation.companyName) });
    const course = await input.port.upsertCourse({ companyId: company.id, courseId: operation.courseId, name: operation.courseName,
      operationType: enumValue(OPERATION_TYPE, text(operation.operationType), OperationType.NEEDS_REVIEW), revenue: numberValue(operation.revenue), revenueRaw: nullableText(operation.revenueRaw ?? operation.revenue) });
    const values = operationValues(operation, input.roster, sourceFingerprint, startDate, endDate);
    if (sessionId) await input.port.updateOperation(sessionId, course.id, values);
    else sessionId = (await input.port.createOperation({ operationId: operation.operationId, courseRecordId: course.id, values })).id;

    if (existing) summary.updated++; else summary.inserted++;
    const sourceExists = await input.port.sourceRecordExists(sessionId, sourceFingerprint);
    if (sourceExists) summary.sourceRecordsSkipped++;
    else {
      await input.port.createSourceRecord({ importRunId: importRun.id, operationSessionId: sessionId, rowNumber: index + 1,
        sourceFingerprint, sourceTeam: enumValue(SOURCE_TEAM, text(operation.sourceTeam), SourceTeam.UNKNOWN), snapshot: operation });
      summary.sourceRecordsInserted++;
    }
  }
  await input.port.finishImportRun(importRun.id, entries.length, summary.inserted + summary.updated);
  return summary;
}

function operationValues(operation: OperationImportEntry, roster: OperationImportDependencies["roster"], sourceFingerprint: string, startDate: Date, endDate: Date): Record<string, unknown> {
  return {
    sourceFingerprint, validationErrors: stringArray(operation.validationErrors), operationStatus: enumValue(OPERATION_STATUS, text(operation.operationStatus), OperationStatus.ASSIGNMENT_NEEDED),
    archiveStatus: enumValue(ARCHIVE_STATUS, text(operation.archiveStatus), ArchiveStatus.NOT_READY), educationFormat: enumValue(EDUCATION_FORMAT, text(operation.educationFormat), EducationFormat.NEEDS_REVIEW),
    educationFormatRaw: nullableText(operation.educationFormatRaw), operationChannel: enumValue(OPERATION_CHANNEL, text(operation.operationChannel), OperationChannel.NEEDS_REVIEW),
    roundNo: nullableText(operation.roundNo), educationDays: nullableText(operation.educationDays), startDate, endDate, operationMonth: nullableText(operation.operationMonth),
    sessionDurationDays: integerValue(operation.sessionDurationDays), sessionDurationType: enumValue(OPERATION_TYPE, text(operation.sessionDurationType), OperationType.NEEDS_REVIEW),
    timeText: nullableText(operation.timeText), omName: nullableText(normalizeAssigneeNames(text(operation.om), roleNamesFromRoster(roster, "om"))),
    ldName: nullableText(normalizeAssigneeNames(text(operation.ld), roleNamesFromRoster(roster, "ld"))), instructorsText: nullableText(operation.instructors), coachText: nullableText(operation.coach),
    region: nullableText(operation.region), onsiteRequired: enumValue(ONSITE_REQUIRED, text(operation.onsiteRequired), OnsiteRequired.UNKNOWN), onsiteText: nullableText(operation.onsiteText),
    specialNotes: nullableText(operation.specialNotes), operationIssue: nullableText(operation.operationIssue), omUpdate: nullableText(operation.omUpdate), driveLink: nullableText(operation.driveLink),
    operationDetail: nullableText(operation.operationDetail), companyWikiLink: nullableText(operation.companyWikiLink), instructorWikiLink: nullableText(operation.instructorWikiLink),
    costRaw: nullableText(operation.costRaw), profitRaw: nullableText(operation.profitRaw), totalCost: numberValue(operation.totalCost), instructorCost: numberValue(operation.instructorCost),
    operationCost: numberValue(operation.operationCost), avgSatisfaction: nullableText(operation.avgSatisfaction), instructorSatisfaction: nullableText(operation.instructorSatisfaction),
    hasResultReport: enumValue(RESULT_REPORT_STATUS, text(operation.hasResultReport), ResultReportStatus.NEEDS_REVIEW), resultReportLink: nullableText(operation.resultReportLink),
    lectureManagementLink: nullableText(operation.lectureManagementLink), padletLink: nullableText(operation.padletLink)
  };
}

export function normalizeLegacyOperationText(value: unknown): string { return value === null || value === undefined ? "" : String(value).trim().replace(/\s+/g, " "); }
const text = (value: unknown) => normalizeLegacyOperationText(value);
const nullableText = (value: unknown) => text(value) || null;
const normalizeName = (value: unknown) => text(value).toLowerCase();
const enumValue = <T>(values: Record<string, T>, value: string, fallback: T): T => values[value] ?? fallback;
function numberValue(value: unknown): number | null { if (value === null || value === undefined || value === "") return null; const parsed = Number(String(value).replaceAll(",", "")); return Number.isFinite(parsed) ? parsed : null; }
function integerValue(value: unknown): number | null { const parsed = numberValue(value); return parsed === null ? null : Math.trunc(parsed); }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function exactDate(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
