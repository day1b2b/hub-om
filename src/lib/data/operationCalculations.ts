import type {
  ArchiveStatus,
  EducationFormat,
  OnsiteRequired,
  OperationChannel,
  OperationSession,
  OperationStatus,
  OperationSummary,
  OperationType,
  ResultReportStatus,
  SatisfactionSurveyStatus,
  ValidationStatus
} from "./operationTypes";
import { satisfactionNumber } from "./satisfaction";

export const ASSIGNMENT_NEEDED_VALUES = new Set(["★배정필요", "배정필요"]);
const ASSIGNMENT_PLANNED_VALUES = new Set(["★배정 예정", "배정 예정", "배정예정"]);
const EDUCATION_FORMATS = new Set<EducationFormat>([
  "오프라인",
  "비대면",
  "블렌디드",
  "플립러닝"
]);
const OPERATION_TYPES = new Set<OperationType>([
  "특강",
  "단기",
  "중기",
  "중장기",
  "준장기",
  "장기",
  "연간",
  "상시형"
]);

export function isSameCourse(a: OperationSession, b: OperationSession): boolean {
  return a.courseId === b.courseId && a.courseName === b.courseName && a.companyName === b.companyName;
}

/** Course.processSeq(DB 채번)를 화면에 보이는 "과정ID" 코드로 바꾼다. */
export function formatProcessId(processSeq: number): string {
  return `PRC-${String(processSeq).padStart(6, "0")}`;
}

export function normalizeCourseId(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\.0$/, "");
}

export function normalizeEducationFormat(rawValue: string): EducationFormat {
  const value = rawValue.trim();
  if (value === "플랫폼(온라인운영)") return "비대면";
  if (value === "온/오프라인" || value === "블랜디드") return "블렌디드";

  const normalized = value as EducationFormat;
  return EDUCATION_FORMATS.has(normalized) ? normalized : "검토필요";
}

export function deriveOperationChannel(rawValue: string): OperationChannel {
  const value = rawValue.trim();

  if (value === "오프라인") return "onsite";
  if (value === "비대면") return "live_online";
  if (value === "플랫폼(온라인운영)") return "online_platform";
  if (value === "블렌디드" || value === "블랜디드" || value === "온/오프라인" || value === "플립러닝") return "blended";

  return "needs_review";
}

export function normalizeOperationType(rawValue: string): OperationType {
  const simplified = rawValue
    .replace(/\(~?1주\)/g, "")
    .replace(/\(~?1개월\)/g, "")
    .replace(/\(~?3개월\)/g, "")
    .replace(/\(~?6개월\)/g, "")
    .replace(/\(6개월이상\)/g, "")
    .replace("상시", "상시형")
    .trim() as OperationType;

  return OPERATION_TYPES.has(simplified) ? simplified : "검토필요";
}

export function deriveOperationStatus(om: string, endDate: string, hasArchiveData: boolean): OperationStatus {
  const normalizedOm = om.trim();

  if (!normalizedOm || ASSIGNMENT_NEEDED_VALUES.has(normalizedOm)) {
    return "배정필요";
  }

  if (ASSIGNMENT_PLANNED_VALUES.has(normalizedOm)) {
    return "배정예정";
  }

  if (isPastDate(endDate)) {
    return hasArchiveData ? "회고완료" : "아카이빙필요";
  }

  return "진행중";
}

export interface ArchiveCompletionInput {
  courseId: string;
  lectureManagementNote: string;
  avgSatisfaction: string;
  hasSatisfactionSurvey: SatisfactionSurveyStatus;
  hasResultReport: ResultReportStatus;
  resultReportLink: string;
}

export function deriveArchiveStatus(endDate: string, input: ArchiveCompletionInput): ArchiveStatus {
  if (!isPastDate(endDate)) {
    return "아카이빙전";
  }

  return isArchiveComplete(input) ? "완료" : "아카이빙필요";
}

/**
 * 아카이빙 완료 조건: 코스ID, 강의관리 시트, (만족도 조사를 하는 회차면) 만족도 등록,
 * (결과보고서가 필요한 회차면) 결과보고서 링크 등록.
 *
 * 조사하지 않기로 한 회차(만족도 조사 여부 = 불필요)는 채울 값 자체가 없으므로 만족도를
 * 요구하지 않는다. 요구하면 나머지를 다 정리해도 영원히 "아카이빙필요"에 남는다.
 * 결과보고서가 "유"일 때만 링크를 요구하는 것과 같은 구조다.
 */
export function isArchiveComplete(input: ArchiveCompletionInput): boolean {
  const hasCourseId = Boolean(input.courseId.trim());
  const hasLectureManagementNote = Boolean(input.lectureManagementNote.trim());
  const hasRequiredSatisfaction =
    input.hasSatisfactionSurvey === "불필요" || Boolean(input.avgSatisfaction.trim());
  const hasRequiredResultReportLink =
    input.hasResultReport !== "유" || Boolean(input.resultReportLink.trim());

  return hasCourseId && hasLectureManagementNote && hasRequiredSatisfaction && hasRequiredResultReportLink;
}

/**
 * 아카이빙에서 빠진 항목 이름들. isArchiveComplete와 같은 기준을 쓴다.
 *
 * "아카이빙 필요"라고만 보여주면 무엇을 채워야 하는지 알 수 없어 운영 상세를 열어봐야 한다.
 * 판정과 표시가 어긋나지 않도록 조건을 여기 한 곳에만 둔다.
 */
export function missingArchiveItems(input: ArchiveCompletionInput): string[] {
  const missing: string[] = [];
  if (!input.courseId.trim()) missing.push("코스ID");
  if (!input.lectureManagementNote.trim()) missing.push("강의관리");
  // 조사하지 않기로 한 회차는 채울 값이 없으므로 요구하지 않는다.
  if (input.hasSatisfactionSurvey !== "불필요" && !input.avgSatisfaction.trim()) missing.push("만족도");
  // 결과보고서가 "유"일 때만 링크를 요구한다.
  if (input.hasResultReport === "유" && !input.resultReportLink.trim()) missing.push("결과보고서 링크");
  return missing;
}

export function deriveSessionDurationDays(startDate: string, endDate: string): number | null {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (!start || !end || end < start) {
    return null;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / dayMs) + 1;
}

export function deriveSessionDurationType(durationDays: number | null): OperationType {
  if (durationDays === null) {
    return "검토필요";
  }

  if (durationDays <= 1) return "특강";
  if (durationDays <= 7) return "단기";
  if (durationDays <= 31) return "중기";
  if (durationDays <= 93) return "준장기";
  if (durationDays <= 186) return "장기";
  return "상시형";
}

export function normalizeOnsiteRequired(rawValue: string): OnsiteRequired {
  const value = rawValue.trim().toUpperCase();
  if (!value) return "UNKNOWN";
  if (value === "Y") return "Y";
  if (value === "N") return "N";
  if (value.includes("일부") || value.includes("PARTIAL")) return "PARTIAL";
  return "UNKNOWN";
}

export function normalizeResultReportStatus(rawValue: string): ResultReportStatus {
  const value = rawValue.trim();
  if (["유", "有", "Y", "YES"].includes(value.toUpperCase())) return "유";
  if (["무", "無", "N", "NO"].includes(value.toUpperCase())) return "무";
  if (value === "불필요") return "불필요";
  return "확인필요";
}

export function parseMoney(value: unknown): number | null {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function deriveProfit(revenue: number | null, totalCost: number | null): number | null {
  if (revenue === null || totalCost === null) return null;
  return revenue - totalCost;
}

export function buildValidationStatus(errors: string[]): ValidationStatus {
  return errors.length > 0 ? "검토필요" : "정상";
}

export function summarizeOperations(operations: OperationSession[]): OperationSummary {
  return {
    total: operations.length,
    active: operations.filter((operation) => operation.operationStatus === "진행중").length,
    assignmentNeeded: operations.filter((operation) => operation.operationStatus === "배정필요").length,
    archiveNeeded: operations.filter((operation) => operation.archiveStatus === "아카이빙필요").length,
    missingSatisfaction: operations.filter((operation) => satisfactionNumber(operation.avgSatisfaction) === null).length,
    missingResultReport: operations.filter(
      (operation) => operation.hasResultReport === "유" && !operation.resultReportLink.trim()
    ).length
  };
}

export function buildOperationMonth(startDate: string): string {
  const parsed = parseDate(startDate);
  if (!parsed) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

const EDUCATION_DATE_TOKEN_PATTERN = /^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/;

export interface ParsedEducationDates {
  dates: string[];
  errors: string[];
}

/**
 * 쉼표/줄바꿈으로 구분해 붙여넣은 실제 교육일 목록을 파싱한다("2026-09-03, 2026-09-04, 2026-09-07"
 * 같은 입력을 가정). 월/일만 있고 연도가 없는 입력은 어느 해인지 단정할 수 없어 형식 오류로 취급한다.
 * 중복은 제거하고 날짜순으로 정렬해 돌려준다.
 */
export function parseEducationDatesText(value: string): ParsedEducationDates {
  const tokens = value
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const errors: string[] = [];
  const dateSet = new Set<string>();

  for (const token of tokens) {
    const normalized = normalizeEducationDateToken(token);

    if (!normalized) {
      errors.push(`"${token}" 날짜 형식을 확인해주세요 (예: 2026-09-03).`);
      continue;
    }

    dateSet.add(normalized);
  }

  return { dates: Array.from(dateSet).sort(), errors };
}

function normalizeEducationDateToken(token: string): string | null {
  const match = EDUCATION_DATE_TOKEN_PATTERN.exec(token);
  if (!match) return null;

  const [, year, month, day] = match;
  const isoDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return parseDate(isoDate) ? isoDate : null;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 실제 교육일 목록을 짧은 표시용 문자열로 만든다. 연속된 날짜는 구간으로 묶고
 * ("9/8~9/25"), 구간 사이에 쉬는 날이 있으면 쉼표로 나눠 보여준다
 * (예: "9/3, 9/7"이면 "9/3, 9/7", "9/8~9/10, 9/14~9/16"이면 두 구간).
 */
export function formatEducationDatesList(dates: string[]): string {
  const validDates: Date[] = [];
  const invalidTokens: string[] = [];

  for (const date of dates) {
    const parsed = parseDate(date);
    if (parsed) {
      validDates.push(parsed);
    } else {
      invalidTokens.push(date);
    }
  }

  validDates.sort((a, b) => a.getTime() - b.getTime());

  const ranges: { start: Date; end: Date }[] = [];

  for (const parsed of validDates) {
    const lastRange = ranges[ranges.length - 1];

    if (lastRange && parsed.getTime() - lastRange.end.getTime() === ONE_DAY_MS) {
      lastRange.end = parsed;
    } else {
      ranges.push({ start: parsed, end: parsed });
    }
  }

  const rangeLabels = ranges.map(({ start, end }) =>
    start.getTime() === end.getTime() ? formatMonthDay(start) : `${formatMonthDay(start)}~${formatMonthDay(end)}`
  );

  return [...rangeLabels, ...invalidTokens].join(", ");
}

function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 알림용 축약 표기. 연속된 날짜는 구간으로 묶고(화면용 formatEducationDatesList와 같은 방침),
 * 첫 날짜만 YY.MM.DD로 쓰고 이어지는 날짜는 같은 달이면 일자만, 달이 바뀌면 MM.DD,
 * 해가 바뀌면 다시 YY.MM.DD로 쓴다. 일자는 두 자리를 유지해 "7"이 7월로 읽히지 않게 한다.
 *
 * 예) 9/4, 9/7, 9/8        → "26.09.04, 07~08"
 *     9/4 ~ 9/8 (연속 5일) → "26.09.04~08"
 *     9/30, 10/1           → "26.09.30~10.01"
 *     12/30, 12/31, 1/5    → "26.12.30~31, 27.01.05"
 *
 * 화면은 M/D 표기(formatEducationDatesList)를 쓴다. 둘을 섞지 않는다.
 */
export function formatEducationDatesCompact(dates: string[]): string {
  const parsed = dates
    .map((date) => parseDate(date))
    .filter((value): value is Date => value !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (parsed.length === 0) return "";

  const runs: { start: Date; end: Date }[] = [];
  for (const value of parsed) {
    const last = runs[runs.length - 1];

    if (last && value.getTime() - last.end.getTime() === ONE_DAY_MS) {
      last.end = value;
      continue;
    }

    if (last && value.getTime() === last.end.getTime()) continue;

    runs.push({ start: value, end: value });
  }

  const pad = (value: number) => String(value).padStart(2, "0");
  let lastYear = -1;
  let lastMonth = -1;

  // 직전에 쓴 날짜와 같은 해·달이면 생략한다. 구간의 끝은 시작을 기준으로 줄인다.
  const shorten = (value: Date) => {
    const year = value.getFullYear();
    const month = value.getMonth() + 1;
    const day = pad(value.getDate());
    const sameYear = year === lastYear;
    const sameMonth = sameYear && month === lastMonth;

    lastYear = year;
    lastMonth = month;

    if (sameMonth) return day;
    if (sameYear) return `${pad(month)}.${day}`;

    return `${pad(year % 100)}.${pad(month)}.${day}`;
  };

  return runs
    .map(({ start, end }) => {
      const startLabel = shorten(start);

      return start.getTime() === end.getTime() ? startLabel : `${startLabel}~${shorten(end)}`;
    })
    .join(", ");
}

/** 실제 교육일 목록에서 startDate/endDate(최소/최대)를 계산한다. 빈 목록이면 null. */
export function deriveDateRangeFromEducationDates(
  dates: string[]
): { startDate: string; endDate: string } | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return { startDate: sorted[0], endDate: sorted[sorted.length - 1] };
}

/** startDate~endDate 사이 모든 날짜(양끝 포함)를 나열한다. 실제 교육일이 아직 없는 회차를
 * 달력에서 편집할 때 "일단 전체 기간을 선택된 상태로 보여주고 쉬는 날만 해제"할 수 있게 쓴다. */
export function enumerateDateRange(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || end < start) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function isPastDate(value: string): boolean {
  const parsed = parseDate(value);
  if (!parsed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed < today;
}

function parseDate(value: string): Date | null {
  if (!value.trim()) return null;
  const parsed = new Date(`${value.trim()}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
