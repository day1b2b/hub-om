export interface EngagementKey {
  courseName: string;
  startDate: string;
  endDate: string;
}

export interface OperationCandidate {
  id: string;
  courseName: string;
  startDate: string;
  endDate: string;
}

/**
 * 코치 투입이력(engagement)을 운영 세션(operation)에 매칭한다.
 *
 * 매칭 규칙: courseName 정규화(trim + 내부 연속공백 1칸 + 소문자) 일치 AND
 * startDate 일치 AND endDate 일치하는 후보가 정확히 1건이면 그 id를 반환하고,
 * 0건이거나 2건 이상이면 null을 반환한다. (이름/사번 기반 매칭은 하지 않는다.)
 */
export function matchOperation(
  engagement: EngagementKey,
  candidates: OperationCandidate[]
): string | null {
  const targetCourseName = normalizeCourseName(engagement.courseName);

  const matches = candidates.filter(
    (candidate) =>
      normalizeCourseName(candidate.courseName) === targetCourseName &&
      candidate.startDate === engagement.startDate &&
      candidate.endDate === engagement.endDate
  );

  return matches.length === 1 ? matches[0].id : null;
}

function normalizeCourseName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
