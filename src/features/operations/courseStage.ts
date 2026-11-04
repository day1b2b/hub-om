// 교육 상세의 "지금 단계" 계산. 화면은 이 결과로 어느 칸을 강조하고 접을지만 정한다(DB 접근 없음).
// 단계는 교육 날짜와 회차의 강사 칸으로만 본다. 운영현황 진행상태는 지난 회차가 "배정필요"로 남은 경우가
// 많아 기준으로 쓰지 않는다.

export type CourseStage = "assign" | "contract" | "review";

interface StageRound {
  operationId: string;
  label: string;
  instructors?: string | null;
  startDate: string;
  endDate: string;
}

export interface CourseStageResult {
  stage: CourseStage;
  /** 끝났는데 만족도가 아직 반영되지 않은 회차(회차 목록 순서). 수강생 코멘트 칸에 "반영 대기"로 보인다. */
  pendingSurveyLabels: string[];
}

function roundEnd(round: StageRound): string {
  return (round.endDate || round.startDate || "").trim();
}

export function resolveCourseStage(
  rounds: readonly StageRound[],
  surveyedOperationIds: ReadonlySet<string>,
  today: string
): CourseStageResult {
  const assigned = rounds.some((round) => (round.instructors ?? "").trim() !== "");
  const ended = rounds.length > 0 && rounds.every((round) => {
    const end = roundEnd(round);
    return end !== "" && end < today;
  });
  const stage: CourseStage = ended ? "review" : assigned ? "contract" : "assign";
  const pendingSurveyLabels = rounds
    .filter((round) => {
      const end = roundEnd(round);
      return end !== "" && end < today && !surveyedOperationIds.has(round.operationId);
    })
    .map((round) => round.label);
  return { stage, pendingSurveyLabels };
}
