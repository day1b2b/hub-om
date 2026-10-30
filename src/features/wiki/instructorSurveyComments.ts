// 강사 위키의 "수강생 코멘트" 계산. 화면은 이 결과만 그린다(DB 접근 없음, 테스트로 고정).
// 원천은 회차별 만족도 결과(SessionSurveyResult) — OM이 survey_analysis에서 [hub-om 반영]을 누를 때 쌓인다.

import type { SessionSurveyResult, SurveyCommentStatus } from "@/lib/data/sessionSurveyResultTypes";
import { cleanCourseName, courseGroupKey, type InstructorCourse } from "./instructorWikiModel";

/** 상단 카드에 모아 보여 줄 최근 과정 수와, 과정마다 갈래별 최대 줄 수. */
export const DIGEST_COURSE_LIMIT = 3;
export const DIGEST_LINES_PER_COURSE = 2;

export interface RoundSurveyComment {
  operationId: string;
  roundNo: string;
  startDate: string;
  status: SurveyCommentStatus;
  positive: string[];
  improve: string[];
  respondents: number | null;
  positiveRate: string | null;
}

export interface DigestLine {
  kind: "positive" | "improve";
  text: string;
  /** 어느 과정에서 나온 말인지 — "가나식품 9.17" */
  source: string;
}

export interface SurveyCommentDigest {
  lines: DigestLine[];
  /** 코멘트를 모은 최근 과정 수 */
  courseCount: number;
  /** 상태별 회차 수 — 화면이 "비어 있는 게 정상"인지 설명할 때 쓴다. */
  counts: Record<SurveyCommentStatus, number>;
}

/** 강사로 들어간 회차만 본다. 실습코치 회차의 설문 코멘트는 강사 평가가 아니다. */
function instructorRounds(courses: InstructorCourse[]): InstructorCourse[] {
  return courses.filter((course) => course.role === "강사");
}

function roundComment(course: InstructorCourse, result: SessionSurveyResult | undefined): RoundSurveyComment | null {
  // comments가 null이면 코멘트를 보내지 않는 구버전 앱으로만 반영된 회차 — 아무것도 표시하지 않는다.
  if (!result?.comments) return null;
  return {
    operationId: course.operationId,
    roundNo: course.roundNo,
    startDate: course.startDate,
    status: result.comments.status,
    positive: result.comments.positive,
    improve: result.comments.improve,
    respondents: result.respondents,
    positiveRate: result.positiveRate
  };
}

/** 과정 묶음 키 → 그 과정 회차들의 코멘트(날짜순). 투입 이력 표의 코멘트 줄에 쓴다. */
export function commentsByCourseGroup(
  courses: InstructorCourse[],
  results: readonly SessionSurveyResult[]
): Map<string, RoundSurveyComment[]> {
  const byOperation = new Map(results.map((result) => [result.operationId, result]));
  const groups = new Map<string, RoundSurveyComment[]>();
  for (const course of instructorRounds(courses)) {
    const comment = roundComment(course, byOperation.get(course.operationId));
    if (!comment) continue;
    const key = courseGroupKey(course);
    groups.set(key, [...(groups.get(key) ?? []), comment]);
  }
  for (const rounds of groups.values()) rounds.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return groups;
}

function shortDate(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(value);
  return match ? `${Number(match[1])}.${Number(match[2])}` : "";
}

/**
 * 상단 카드용 요약: 요약이 있는(ok) 최근 과정 DIGEST_COURSE_LIMIT개에서 갈래마다 DIGEST_LINES_PER_COURSE줄씩.
 * 같은 과정에 여러 회차가 있으면 가장 최근 회차의 요약을 쓴다.
 */
export function buildSurveyCommentDigest(
  courses: InstructorCourse[],
  results: readonly SessionSurveyResult[]
): SurveyCommentDigest {
  const byOperation = new Map(results.map((result) => [result.operationId, result]));
  const counts: Record<SurveyCommentStatus, number> = { ok: 0, no_subjective: 0, no_summary: 0 };
  const latestByGroup = new Map<string, { course: InstructorCourse; comment: RoundSurveyComment }>();

  for (const course of instructorRounds(courses)) {
    const comment = roundComment(course, byOperation.get(course.operationId));
    if (!comment) continue;
    counts[comment.status] += 1;
    if (comment.status !== "ok" || comment.positive.length + comment.improve.length === 0) continue;
    const key = courseGroupKey(course);
    const current = latestByGroup.get(key);
    if (!current || comment.startDate > current.comment.startDate) latestByGroup.set(key, { course, comment });
  }

  const recent = [...latestByGroup.values()]
    .sort((a, b) => b.comment.startDate.localeCompare(a.comment.startDate))
    .slice(0, DIGEST_COURSE_LIMIT);
  const lines: DigestLine[] = [];
  for (const kind of ["positive", "improve"] as const) {
    for (const { course, comment } of recent) {
      const source = [course.companyName || cleanCourseName(course.courseName), shortDate(comment.startDate)].filter(Boolean).join(" ");
      for (const text of comment[kind].slice(0, DIGEST_LINES_PER_COURSE)) lines.push({ kind, text, source });
    }
  }
  return { lines, courseCount: recent.length, counts };
}
