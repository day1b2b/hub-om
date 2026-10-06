/** Runtime row-to-DTO mapping; deliberately independent of Prisma, MongoDB and schema files. */
import type {
  ArchiveStatus, EducationFormat, OnsiteRequired, OperationChannel, OperationSession,
  OperationStatus, OperationType, ResultReportStatus, SatisfactionSurveyStatus, SourceTeam
} from "./operationTypes";
import { deriveArchiveStatus, deriveProfit, formatProcessId } from "./operationCalculations";
import { normalizeRoleAssigneeText } from "./roleAssignees";
import type { TeamMemberRole, TeamMemberRoleRoster } from "./teamMemberRepository";

export type RowMoney = string | number | { toString(): string } | null;
export interface OperationCompanyRow { id: string; name: string }
export interface OperationCourseRow {
  id: string;
  processSeq: number;
  companyId: string;
  courseId: string;
  name: string;
  operationType: string;
  courseCategory: string | null;
  tools: string | null;
  revenue: RowMoney;
  company: OperationCompanyRow;
}
export interface OperationSourceRow { sourceTeam: string }
export interface OperationSessionRow {
  id: string;
  operationId: string;
  course: OperationCourseRow;
  /** Latest source first, matching the PostgreSQL repository include order. */
  sourceRecords: OperationSourceRow[];
  operationStatus: string;
  educationFormat: string;
  operationChannel: string;
  onsiteRequired: OnsiteRequired;
  hasSatisfactionSurvey: string;
  hasResultReport: string;
  startDate: Date;
  endDate: Date;
  educationDates: Date[];
  sessionDurationDays: number | null;
  sessionDurationType: string | null;
  totalCost: RowMoney;
  instructorCost: RowMoney;
  operationCost: RowMoney;
  validationErrors: unknown;
  educationFormatRaw: string | null;
  roundNo: string | null;
  educationDays: string | null;
  operationMonth: string | null;
  timeText: string | null;
  omName: string | null;
  ldName: string | null;
  onsiteOmName: string | null;
  instructorsText: string | null;
  coachText: string | null;
  region: string | null;
  onsiteText: string | null;
  specialNotes: string | null;
  operationIssue: string | null;
  omUpdate: string | null;
  driveLink: string | null;
  operationDetail: string | null;
  companyWikiLink: string | null;
  instructorWikiLink: string | null;
  costRaw: string | null;
  profitRaw: string | null;
  avgSatisfaction: string | null;
  instructorSatisfaction: string | null;
  resultReportLink: string | null;
  lectureManagementLink: string | null;
  lectureManagementNote: string | null;
  padletLink: string | null;
}

export const OPERATION_STATUS: Record<string, OperationStatus> = {
  ASSIGNMENT_NEEDED: "배정필요",
  ASSIGNMENT_PLANNED: "배정예정",
  ACTIVE: "진행중",
  DONE: "완료",
  RETROSPECTIVE_DONE: "회고완료",
  ARCHIVE_NEEDED: "아카이빙필요"
};

export const EDUCATION_FORMAT: Record<string, EducationFormat> = {
  OFFLINE: "오프라인",
  REMOTE: "비대면",
  BLENDED: "블렌디드",
  FLIPPED: "플립러닝",
  NEEDS_REVIEW: "검토필요"
};

export const OPERATION_CHANNEL: Record<string, OperationChannel> = {
  ONSITE: "onsite",
  LIVE_ONLINE: "live_online",
  ONLINE_PLATFORM: "online_platform",
  BLENDED: "blended",
  NEEDS_REVIEW: "needs_review"
};

export const OPERATION_TYPE: Record<string, OperationType> = {
  LECTURE: "특강",
  SHORT: "단기",
  MEDIUM: "중기",
  MID_TERM_LONG: "중장기",
  MID_LONG: "준장기",
  LONG: "장기",
  ANNUAL: "연간",
  ALWAYS_ON: "상시형",
  NEEDS_REVIEW: "검토필요"
};

export const RESULT_REPORT_STATUS: Record<string, ResultReportStatus> = {
  YES: "유",
  NO: "무",
  NOT_REQUIRED: "불필요",
  NEEDS_REVIEW: "확인필요"
};

export const SATISFACTION_SURVEY_STATUS: Record<string, SatisfactionSurveyStatus> = {
  NOT_REQUIRED: "불필요",
  NEEDS_REVIEW: "확인필요"
};

export const SOURCE_TEAM: Record<string, SourceTeam> = {
  TEAM_1: "1팀",
  TEAM_2: "2팀",
  UNKNOWN: "미분류"
};

export const DB_OPERATION_STATUS: Record<OperationStatus, string> = {
  "배정필요": "ASSIGNMENT_NEEDED",
  "배정예정": "ASSIGNMENT_PLANNED",
  "진행중": "ACTIVE",
  "완료": "DONE",
  "회고완료": "RETROSPECTIVE_DONE",
  "아카이빙필요": "ARCHIVE_NEEDED"
};

export const DB_ARCHIVE_STATUS: Record<ArchiveStatus, string> = {
  "아카이빙전": "NOT_READY",
  "아카이빙필요": "NEEDED",
  "완료": "DONE"
};

export const DB_RESULT_REPORT_STATUS: Record<ResultReportStatus, string> = {
  "유": "YES",
  "무": "NO",
  "불필요": "NOT_REQUIRED",
  "확인필요": "NEEDS_REVIEW"
};

export const DB_SATISFACTION_SURVEY_STATUS: Record<SatisfactionSurveyStatus, string> = {
  "불필요": "NOT_REQUIRED",
  "확인필요": "NEEDS_REVIEW"
};

export const DB_EDUCATION_FORMAT: Record<EducationFormat, string> = {
  "오프라인": "OFFLINE",
  "비대면": "REMOTE",
  "블렌디드": "BLENDED",
  "플립러닝": "FLIPPED",
  "검토필요": "NEEDS_REVIEW"
};

export const DB_OPERATION_TYPE: Record<OperationType, string> = {
  "특강": "LECTURE",
  "단기": "SHORT",
  "중기": "MEDIUM",
  "중장기": "MID_TERM_LONG",
  "준장기": "MID_LONG",
  "장기": "LONG",
  "연간": "ANNUAL",
  "상시형": "ALWAYS_ON",
  "검토필요": "NEEDS_REVIEW"
};

/** DB 행을 화면이 쓰는 표준 OperationSession으로 바꾼다. 목록 읽기와 단건 읽기가 같은 매핑을 쓴다. */
export function toOperationSession(session: OperationSessionRow, courseIdLabel: string): OperationSession {
  const revenue = decimalToNumber(session.course.revenue);
  const totalCost = decimalToNumber(session.totalCost);

  return {
    id: session.id,
    operationId: session.operationId,
    sourceTeam: session.sourceRecords[0]?.sourceTeam ? SOURCE_TEAM[session.sourceRecords[0].sourceTeam] : "미분류",
    processId: formatProcessId(session.course.processSeq),
    courseRecordId: session.course.id,
    courseId: session.course.courseId,
    courseIdLabel,
    companyId: session.course.companyId,
    companyName: session.course.company.name,
    courseName: session.course.name,
    courseCategory: session.course.courseCategory ?? "",
    tools: session.course.tools ?? "",
    om: session.omName ?? "",
    ld: session.ldName ?? "",
    onsiteOm: session.onsiteOmName ?? "",
    operationStatus: OPERATION_STATUS[session.operationStatus],
    archiveStatus: deriveArchiveStatus(toDateString(session.endDate), {
      courseId: session.course.courseId ?? "",
      lectureManagementNote: session.lectureManagementNote ?? "",
      avgSatisfaction: session.avgSatisfaction ?? "",
      hasSatisfactionSurvey: SATISFACTION_SURVEY_STATUS[session.hasSatisfactionSurvey],
      hasResultReport: RESULT_REPORT_STATUS[session.hasResultReport],
      resultReportLink: session.resultReportLink ?? ""
    }),
    educationFormat: EDUCATION_FORMAT[session.educationFormat],
    educationFormatRaw: session.educationFormatRaw ?? "",
    operationChannel: OPERATION_CHANNEL[session.operationChannel],
    operationType: OPERATION_TYPE[session.course.operationType],
    operationTypeRaw: OPERATION_TYPE[session.course.operationType],
    roundNo: session.roundNo ?? "",
    educationDays: session.educationDays ?? "",
    educationDates: session.educationDates.map((date) => toDateString(date)),
    startDate: toDateString(session.startDate),
    endDate: toDateString(session.endDate),
    operationMonth: session.operationMonth ?? "",
    sessionDurationDays: session.sessionDurationDays,
    sessionDurationType: session.sessionDurationType ? OPERATION_TYPE[session.sessionDurationType] : "검토필요",
    timeText: session.timeText ?? "",
    instructors: session.instructorsText ?? "",
    coach: session.coachText ?? "",
    region: session.region ?? "",
    onsiteRequired: session.onsiteRequired as OnsiteRequired,
    onsiteText: session.onsiteText ?? "",
    specialNotes: session.specialNotes ?? "",
    operationIssue: session.operationIssue ?? "",
    omUpdate: session.omUpdate ?? "",
    driveLink: session.driveLink ?? "",
    operationDetail: session.operationDetail ?? "",
    companyWikiLink: session.companyWikiLink ?? "",
    instructorWikiLink: session.instructorWikiLink ?? "",
    revenue,
    costRaw: session.costRaw ?? "",
    profitRaw: session.profitRaw ?? "",
    totalCost,
    instructorCost: decimalToNumber(session.instructorCost),
    operationCost: decimalToNumber(session.operationCost),
    profit: deriveProfit(revenue, totalCost),
    avgSatisfaction: session.avgSatisfaction ?? "",
    instructorSatisfaction: session.instructorSatisfaction ?? "",
    hasSatisfactionSurvey: SATISFACTION_SURVEY_STATUS[session.hasSatisfactionSurvey],
    hasResultReport: RESULT_REPORT_STATUS[session.hasResultReport],
    resultReportLink: session.resultReportLink ?? "",
    lectureManagementLink: session.lectureManagementLink ?? "",
    lectureManagementNote: session.lectureManagementNote ?? "",
    padletLink: session.padletLink ?? "",
    validationStatus: getValidationErrors(session.validationErrors).length > 0 ? "검토필요" : "정상",
    validationErrors: getValidationErrors(session.validationErrors)
  };
}

export function decimalToNumber(value: RowMoney): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

export function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function getValidationErrors(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function normalizeVisibleText(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim().replace(/[^\S\n]+/g, " "))
    .join("\n")
    .trim();
}

export function nullableText(value: string): string | null {
  return normalizeVisibleText(value) || null;
}

export function courseIdLabelKey(companyId: string, courseId: string): string {
  return `${companyId}::${courseId}`;
}

export function normalizeName(value: string): string {
  return normalizeVisibleText(value).toLowerCase();
}

export function resolveAssigneeText(value: string, role: TeamMemberRole, roleRoster: TeamMemberRoleRoster): string {
  const rawText = normalizeVisibleText(value);
  if (!rawText) return "";

  const matchedText = normalizeRoleAssigneeText(rawText, role, roleRoster);
  return matchedText || rawText;
}

export function parseDateInput(value: string, fieldName: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new Error(`${fieldName} must be a valid date.`);
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`${fieldName} must be a valid date.`);
  }

  return date;
}

export function onsiteRequiredLabel(value: OnsiteRequired): string | null {
  if (value === "Y") return "오프라인";
  if (value === "N") return "온라인";
  if (value === "PARTIAL") return "일부 오프라인";
  return null;
}
