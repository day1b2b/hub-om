import { summarizeSatisfactionValue } from "@/lib/data/satisfaction";
import {
  DEFAULT_MATCH_OPTIONS,
  matchOperation,
  rankOperationCandidates,
  type EngagementKey,
  type OperationCandidate,
  type RankedOperationCandidate
} from "@/lib/data/operationMatch/matchOperation";

/**
 * eduops_log 만족도 집계 시트의 한 행을 표준 형태로 정리한다.
 *
 * 시트 헤더(영문 snake_case)를 키로 사용하며, 컬럼 순서에 의존하지 않는다.
 * 알려진 헤더: record_id, courseId, client, course, degree, date, audience,
 * instructor, n, target, overall, pos_pct, manager, created_at, received_at
 */
export interface SatisfactionSheetRow {
  recordId: string;
  courseId: string;
  client: string;
  course: string;
  degree: string;
  /** 원본 시트 값 (예: "260724") */
  rawDate: string;
  /** 정규화된 ISO 날짜 (예: "2026-07-24"), 파싱 실패 시 "" */
  date: string;
  audience: string;
  /** 원본 강사 표기 (예: "김기호 강사") */
  rawInstructor: string;
  /** 정규화된 강사명 (예: "김기호") */
  instructor: string;
  respondents: number | null;
  /** 전체 만족도 원본 값 */
  rawOverall: string;
  /** 정규화된 전체 만족도 (0~5, 소수 2자리) 또는 "" */
  overall: string;
  /** 긍정 응답 비율(%) 또는 null */
  posPct: number | null;
}

const HEADER_ALIASES: Record<keyof RowLookup, string[]> = {
  recordId: ["record_id", "recordid"],
  courseId: ["courseid", "course_id"],
  client: ["client", "고객사"],
  course: ["course", "과정", "과정명"],
  degree: ["degree", "차수", "기수"],
  date: ["date", "일자", "강의일정"],
  audience: ["audience", "대상"],
  instructor: ["instructor", "강사", "강사명"],
  respondents: ["n", "응답수", "응답자수"],
  overall: ["overall", "전체만족도", "평균만족도", "만족도"],
  posPct: ["pos_pct", "pospct", "긍정률", "긍정비율"]
};

interface RowLookup {
  recordId: string;
  courseId: string;
  client: string;
  course: string;
  degree: string;
  date: string;
  audience: string;
  instructor: string;
  respondents: string;
  overall: string;
  posPct: string;
}

function normalizeHeader(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
}

function pick(record: Record<string, string>, aliases: string[]): string {
  const normalized = new Map(Object.entries(record).map(([key, value]) => [normalizeHeader(key), value]));
  for (const alias of aliases) {
    const hit = normalized.get(normalizeHeader(alias));
    if (hit != null && String(hit).trim() !== "") return String(hit).trim();
  }
  return "";
}

/** "260724" → "2026-07-24". 이미 ISO면 그대로. 실패 시 "". */
export function normalizeSheetDate(value: string): string {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length === 6) {
    const year = 2000 + Number(digits.slice(0, 2));
    const month = digits.slice(2, 4);
    const day = digits.slice(4, 6);
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month}-${day}`;
    }
  }
  if (digits.length === 8) {
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month}-${day}`;
    }
  }
  return "";
}

/** "김기호 강사" → "김기호". 뒤따르는 직함/괄호 표기를 제거한다. */
export function normalizeInstructorName(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\([^)]*\)/g, " ")
    .replace(/(강사|교수|강사님|튜터|코치)\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumberOrNull(value: string): number | null {
  const text = String(value ?? "").replace(/[^0-9.\-]/g, "");
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toSatisfactionSheetRow(record: Record<string, string>): SatisfactionSheetRow {
  const rawDate = pick(record, HEADER_ALIASES.date);
  const rawInstructor = pick(record, HEADER_ALIASES.instructor);
  const rawOverall = pick(record, HEADER_ALIASES.overall);

  return {
    recordId: pick(record, HEADER_ALIASES.recordId),
    courseId: pick(record, HEADER_ALIASES.courseId),
    client: pick(record, HEADER_ALIASES.client),
    course: pick(record, HEADER_ALIASES.course),
    degree: pick(record, HEADER_ALIASES.degree),
    rawDate,
    date: normalizeSheetDate(rawDate),
    audience: pick(record, HEADER_ALIASES.audience),
    rawInstructor,
    instructor: normalizeInstructorName(rawInstructor),
    respondents: toNumberOrNull(pick(record, HEADER_ALIASES.respondents)),
    rawOverall,
    overall: summarizeSatisfactionValue(rawOverall),
    posPct: toNumberOrNull(pick(record, HEADER_ALIASES.posPct))
  };
}

/** 시트 행을 기존 매칭 엔진이 이해하는 EngagementKey로 변환한다. */
export function toEngagementKey(row: SatisfactionSheetRow): EngagementKey {
  return {
    courseName: row.course,
    courseId: row.courseId || null,
    coachName: row.instructor || null,
    startDate: row.date,
    endDate: row.date,
    scheduleDates: row.date ? [row.date] : []
  };
}

export type SatisfactionMatchStatus = "matched" | "ambiguous" | "unmatched";

export interface SatisfactionMatchResult {
  row: SatisfactionSheetRow;
  status: SatisfactionMatchStatus;
  operationId: string | null;
  ranked: RankedOperationCandidate[];
  /** 매칭되지 않은 이유 (운영자가 무엇을 고쳐야 하는지 바로 알 수 있게) */
  reason?: string;
}

/** 미매칭 사유를 운영자 언어로 설명한다. 시트에서 무엇을 고치면 되는지가 드러나야 한다. */
function explainUnmatched(row: SatisfactionSheetRow, ranked: RankedOperationCandidate[]): string {
  if (!row.courseId) return "시트에 코스ID가 비어 있어요. 시트에서 코스ID를 채워주세요.";
  if (!row.date) return "시트의 강의일정을 읽지 못했어요. 날짜 형식을 확인해 주세요.";
  if (ranked.length === 0) return `코스ID ${row.courseId}와 일정(${row.date})에 맞는 운영이 없어요.`;

  const sameCourseId = ranked.some((entry) => entry.courseScore >= 100);
  if (sameCourseId) {
    return `코스ID ${row.courseId} 운영은 찾았지만 일정(${row.date})이 운영 기간과 맞지 않아요. 시트 일정 또는 운영 기간을 확인해 주세요.`;
  }
  return `코스ID ${row.courseId}와 같은 운영을 찾지 못했어요. 운영 현황의 코스ID가 비어 있거나 다른 번호일 수 있어요.`;
}

/**
 * 만족도 시트 한 행을 운영 후보들과 매칭한다.
 * 기존 matchOperation 엔진을 재사용하며, DB에 아무것도 쓰지 않는다(드라이런 안전).
 *
 * 상태 판정:
 *   - matched   : 엔진이 1건으로 확정
 *   - ambiguous : 기준 점수를 넘긴 후보가 2건 이상이라 사람이 골라야 함
 *   - unmatched : 확정도 아니고, 기준을 넘긴 후보도 없음(점수 0짜리 후보만 남은 경우 포함)
 * ★기준 미달(score 0) 후보는 "확인할 거리"가 아니다. 이걸 모호로 분류하면 기간이 긴 운영이
 *   모든 행의 후보로 달라붙어 "모호 N건"이 실제보다 부풀고, 운영자는 고칠 게 없는 목록을 뒤지게 된다.
 */
export function matchSatisfactionRow(
  row: SatisfactionSheetRow,
  candidates: OperationCandidate[]
): SatisfactionMatchResult {
  const engagement = toEngagementKey(row);
  const ranked = rankOperationCandidates(engagement, candidates);
  const operationId = matchOperation(engagement, candidates);
  const scoredCandidates = ranked.filter((entry) => entry.score >= DEFAULT_MATCH_OPTIONS.minMatchScore);

  if (operationId) {
    return { row, status: "matched", operationId, ranked };
  }
  if (scoredCandidates.length > 0) {
    return { row, status: "ambiguous", operationId: null, ranked: scoredCandidates };
  }
  return { row, status: "unmatched", operationId: null, ranked, reason: explainUnmatched(row, ranked) };
}

/** 최소 CSV 파서: 따옴표, 필드 내 쉼표/줄바꿈, CRLF, BOM 처리. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const content = String(text ?? "").replace(/^﻿/, "");

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // CRLF의 \r는 무시
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/**
 * 2차원 시트 값(헤더 포함)을 표준 만족도 행 배열로 변환한다.
 * headerRowNumber는 1부터 시작(구글시트 행 번호와 동일). 빈 행은 제외한다.
 */
export function sheetValuesToRows(values: string[][], headerRowNumber = 1): SatisfactionSheetRow[] {
  if (!Array.isArray(values) || values.length === 0) return [];
  const headerIndex = Math.max(0, Math.floor(headerRowNumber) - 1);
  const header = (values[headerIndex] ?? []).map((cell) => String(cell ?? "").trim());
  if (header.length === 0) return [];

  return values
    .slice(headerIndex + 1)
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((key, index) => {
        if (key) record[key] = String(cells[index] ?? "");
      });
      return toSatisfactionSheetRow(record);
    })
    .filter((row) => row.course !== "" || row.overall !== "" || row.instructor !== "");
}

/** CSV 텍스트(헤더 포함)를 표준 만족도 행 배열로 변환한다. */
export function parseSatisfactionCsv(text: string): SatisfactionSheetRow[] {
  return sheetValuesToRows(parseCsv(text), 1);
}
