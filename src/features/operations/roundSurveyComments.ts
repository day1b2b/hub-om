// 운영 회차 상세의 "수강생 코멘트" 계산. 화면은 이 결과만 그린다(DB 접근 없음, 테스트로 고정).
// 원천은 회차별 만족도 결과(SessionSurveyResult) — OM이 survey_analysis에서 [hub-om 반영]을 누를 때 쌓인다.

import type { SessionSurveyResult, SurveyCommentAxis, SurveyCommentStatus } from "@/lib/data/sessionSurveyResultTypes";
import { SURVEY_COMMENT_AXES } from "@/lib/data/sessionSurveyResultTypes";

export const SURVEY_COMMENT_AXIS_LABEL: Record<SurveyCommentAxis, string> = {
  positive: "👍 좋았던 점",
  instructorImprove: "🔧 강사 개선",
  hrdImprove: "🏢 운영·환경 보완",
  followup: "➕ 후속 니즈"
};

export interface RoundSurveyCommentRow {
  operationId: string;
  label: string;
  /** 측정값 한 줄: "응답 26명 · 긍정 96% · 종합 4.6 · 강사 4.7" */
  measured: string;
  /** null = 코멘트를 보내지 않는 구버전 앱으로만 반영된 회차 */
  status: SurveyCommentStatus | null;
  axes: { axis: SurveyCommentAxis; label: string; lines: string[] }[];
  appliedAt: string;
}

/** 회차 목록 순서대로, 결과가 있는 회차만. */
export function buildRoundSurveyComments(
  rounds: readonly { operationId: string; label: string }[],
  results: readonly SessionSurveyResult[]
): RoundSurveyCommentRow[] {
  const byOperation = new Map(results.map((result) => [result.operationId, result]));
  return rounds.flatMap((round) => {
    const result = byOperation.get(round.operationId);
    if (!result) return [];
    const measured = [
      result.respondents !== null ? `응답 ${result.respondents}명` : null,
      result.positiveRate ? `긍정 ${result.positiveRate}%` : null,
      result.overall ? `종합 ${result.overall}` : null,
      result.instructorSatisfaction ? `강사 ${result.instructorSatisfaction}` : null
    ].filter(Boolean).join(" · ");
    const comments = result.comments;
    return [{
      operationId: round.operationId,
      label: round.label,
      measured,
      status: comments?.status ?? null,
      axes: comments?.status === "ok"
        ? SURVEY_COMMENT_AXES.map((axis) => ({ axis, label: SURVEY_COMMENT_AXIS_LABEL[axis], lines: comments[axis] }))
        : [],
      appliedAt: result.appliedAt
    }];
  });
}
