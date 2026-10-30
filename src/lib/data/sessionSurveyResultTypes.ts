// 회차별 만족도 결과(SessionSurveyResult) 표준 타입과 입력 정리 규칙.
// 저장소(Mongo·Postgres)와 round-apply 라우트, 운영 회차 상세 화면이 모두 이 모양만 본다.

/** survey_analysis가 보내는 코멘트 상태. 화면은 이 값으로 "비어 있는 게 정상"인지 가린다. */
export type SurveyCommentStatus = "ok" | "no_subjective" | "no_summary";

/** survey_analysis AI 요약(summary)의 네 갈래. 키는 summary와 1:1로 맞춘다. */
export const SURVEY_COMMENT_AXES = ["positive", "instructorImprove", "hrdImprove", "followup"] as const;
export type SurveyCommentAxis = (typeof SURVEY_COMMENT_AXES)[number];
export type SurveyCommentLists = Record<SurveyCommentAxis, string[]>;

/** round-apply 요청 본문의 키 — survey_analysis #61과 합의한 이름. */
const REQUEST_KEYS: Record<SurveyCommentAxis, string> = {
  positive: "comment_positive",
  instructorImprove: "comment_instructor_improve",
  hrdImprove: "comment_hrd_improve",
  followup: "comment_followup"
};

export interface SurveyComments extends SurveyCommentLists {
  status: SurveyCommentStatus;
}

export interface SessionSurveyResult {
  /** OperationSession.operationId (업무 키) */
  operationId: string;
  recordId: string | null;
  overall: string | null;
  instructorSatisfaction: string | null;
  respondents: number | null;
  positiveRate: string | null;
  /** null = 코멘트를 보내지 않는 구버전 앱으로만 반영된 회차 */
  comments: SurveyComments | null;
  appliedBy: string | null;
  appliedAt: string;
}

export interface SessionSurveyResultInput {
  operationId: string;
  recordId: string | null;
  overall: string | null;
  instructorSatisfaction: string | null;
  respondents: number | null;
  positiveRate: string | null;
  /** undefined = 이번 요청에 코멘트가 없음 → 저장된 코멘트를 그대로 둔다(구버전 앱 보호). */
  comments?: SurveyComments;
  appliedBy: string | null;
}

/** survey_analysis와 같은 상한. 실제 요약은 갈래당 5줄이라 보통 닿지 않는다. */
export const SURVEY_COMMENT_MAX_LINES = 10;
export const SURVEY_COMMENT_MAX_CHARS = 200;

const STATUSES: readonly SurveyCommentStatus[] = ["ok", "no_subjective", "no_summary"];
const DB_STATUS = { ok: "OK", no_subjective: "NO_SUBJECTIVE", no_summary: "NO_SUMMARY" } as const;
export type SurveyCommentStatusRecord = (typeof DB_STATUS)[SurveyCommentStatus];

export function commentStatusToRecord(status: SurveyCommentStatus): SurveyCommentStatusRecord {
  return DB_STATUS[status];
}

export function commentStatusFromRecord(value: unknown): SurveyCommentStatus | null {
  const found = (Object.keys(DB_STATUS) as SurveyCommentStatus[]).find((key) => DB_STATUS[key] === value);
  return found ?? null;
}

function cleanLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const line = value.replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > SURVEY_COMMENT_MAX_CHARS ? `${line.slice(0, SURVEY_COMMENT_MAX_CHARS - 1)}…` : line;
}

/** 목록 값을 문자열 목록으로 정리한다. 모양이 다르면 빈 목록. */
export function commentLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanLine).filter((line): line is string => line !== null).slice(0, SURVEY_COMMENT_MAX_LINES);
}

export function emptyCommentLists(): SurveyCommentLists {
  return { positive: [], instructorImprove: [], hrdImprove: [], followup: [] };
}

/** 저장된 JSON 한 칸(네 갈래 객체)을 목록으로 되돌린다. 모르는 키는 버리고 없는 갈래는 빈 목록. */
export function commentListsFromRecord(value: unknown): SurveyCommentLists {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const lists = emptyCommentLists();
  for (const axis of SURVEY_COMMENT_AXES) lists[axis] = commentLines(record[axis]);
  return lists;
}

/** 저장용: 상태를 뺀 네 갈래만. 축이 늘어도 칸(마이그레이션)은 그대로다. */
export function commentListsToRecord(comments: SurveyComments): SurveyCommentLists {
  const lists = emptyCommentLists();
  for (const axis of SURVEY_COMMENT_AXES) lists[axis] = comments[axis];
  return lists;
}

export function hasCommentLines(comments: SurveyCommentLists): boolean {
  return SURVEY_COMMENT_AXES.some((axis) => comments[axis].length > 0);
}

/**
 * round-apply 요청 본문의 comment_* 키를 코멘트로 바꾼다.
 * - comment_status 키가 없으면 undefined(= 저장된 코멘트 유지). 구버전 앱은 키를 아예 보내지 않는다.
 * - 상태 값이 약속과 다르거나 목록이 배열이 아니면 "invalid" — 라우트가 400으로 돌려보낸다(조용히 버리지 않는다).
 * - ok가 아니면 목록은 비운다(요약이 없다는 상태와 목록이 어긋나지 않게).
 */
export function parseSurveyComments(body: Record<string, unknown>): SurveyComments | undefined | "invalid" {
  if (!("comment_status" in body) || body.comment_status === undefined || body.comment_status === null) return undefined;
  const status = body.comment_status;
  if (typeof status !== "string" || !STATUSES.includes(status as SurveyCommentStatus)) return "invalid";
  for (const key of Object.values(REQUEST_KEYS)) {
    if (body[key] !== undefined && body[key] !== null && !Array.isArray(body[key])) return "invalid";
  }
  const lists = emptyCommentLists();
  if (status === "ok") {
    for (const axis of SURVEY_COMMENT_AXES) lists[axis] = commentLines(body[REQUEST_KEYS[axis]]);
  }
  return { status: status as SurveyCommentStatus, ...lists };
}

/** 응답자 수 문자열("26", "26.0")을 정수로. 읽을 수 없으면 null. */
export function parseRespondents(value: unknown): number | null {
  const number = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

export function optionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
