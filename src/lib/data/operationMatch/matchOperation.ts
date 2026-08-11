export interface EngagementKey {
  courseName: string;
  /** 과정코드. 후보와 정확히 일치하면 과정명 표기 흔들림과 무관하게 강하게 매칭한다. */
  courseId?: string | null;
  coachName?: string | null;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  scheduleDates?: string[];
  scheduleTimes?: ScheduleTimeRange[];
}

export interface OperationCandidate {
  id: string;
  operationId?: string | null;
  courseName: string;
  /** 운영의 과정코드(OperationSession.courseId). engagement와 일치하면 매칭 우선키가 된다. */
  courseId?: string | null;
  companyName?: string | null;
  startDate: string;
  endDate: string;
  timeText?: string | null;
  coachText?: string | null;
  instructorsText?: string | null;
}

export interface ScheduleTimeRange {
  startTime: string;
  endTime: string;
}

export interface RankedOperationCandidate {
  candidate: OperationCandidate;
  score: number;
  courseScore: number;
  dateScore: number;
  timeScore: number;
  coachScore: number;
}

/**
 * 매칭 판정 기준값. 기능(만족도·코치 등)별로 다르게 조절할 수 있도록 옵션으로 뺀다.
 * 값을 넘기지 않으면 아래 기본값을 쓴다(기존 동작과 동일).
 */
export interface MatchOptions {
  /** 매칭 확정 최소 점수 (기본 150) */
  minMatchScore?: number;
  /** 1등과 2등 점수 차가 이보다 작으면 모호로 보고 매칭하지 않음 (기본 10) */
  minMargin?: number;
  /** 과정 점수가 이 미만이면 후보에서 제외 (기본 70) */
  courseGate?: number;
  /** 날짜 점수가 이 미만이면 후보에서 제외 (기본 65) */
  dateGate?: number;
}

export const DEFAULT_MATCH_OPTIONS: Required<MatchOptions> = {
  minMatchScore: 150,
  minMargin: 10,
  courseGate: 70,
  dateGate: 65
};

function resolveOptions(options?: MatchOptions): Required<MatchOptions> {
  return { ...DEFAULT_MATCH_OPTIONS, ...options };
}

/**
 * 어떤 대상(engagement)을 운영 세션(operation)에 매칭한다.
 *
 * 특정 기능에 종속되지 않는 공용 엔진이다. 만족도 시트, 코치 투입이력 등
 * 각 기능은 자기 데이터를 EngagementKey로 변환(얇은 어댑터)해 이 엔진을 호출하고,
 * 필요하면 MatchOptions로 자기 기준값만 조절한다.
 *
 * 매칭 규칙:
 *   0. courseId가 대상·후보 양쪽에 있고 일치하면 과정명 조건을 대체한다(강한 신호).
 *   1. (courseId로 확정되지 않으면) 과정명이 충분히 유사해야 한다.
 *   2. 일정은 정확히 같거나 기간이 충분히 겹쳐야 한다.
 *   3. 시간 정보가 있으면 보조 점수로만 사용한다.
 *
 * 가장 높은 점수의 후보가 명확히 1건일 때만 id를 반환한다.
 * 후보가 없거나, 상위 후보들이 비슷하면 오매칭 방지를 위해 null을 반환한다.
 * 이름/사번 기반 매칭은 하지 않는다.
 */
export function matchOperation(
  engagement: EngagementKey,
  candidates: OperationCandidate[],
  options?: MatchOptions
): string | null {
  const resolved = resolveOptions(options);
  const scored = rankOperationCandidates(engagement, candidates, options).filter(
    (entry) => entry.score >= resolved.minMatchScore
  );

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < resolved.minMargin) return null;

  return scored[0].candidate.id;
}

export function rankOperationCandidates(
  engagement: EngagementKey,
  candidates: OperationCandidate[],
  options?: MatchOptions
): RankedOperationCandidate[] {
  const resolved = resolveOptions(options);
  return candidates
    .map((candidate) => scoreCandidate(engagement, candidate, resolved))
    .filter((entry) => entry.courseScore > 0 || entry.dateScore > 0)
    .sort((a, b) => b.score - a.score);
}

function normalizeCourseName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function simplifyCourseName(value: string): string {
  return normalizeCourseName(value)
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^0-9a-z가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCandidate(
  engagement: EngagementKey,
  candidate: OperationCandidate,
  options: Required<MatchOptions>
): RankedOperationCandidate {
  const courseScore = scoreCourseName(engagement, candidate);
  const dateScore = scoreDateRange(engagement, candidate);
  const timeScore = scoreTime(engagement, candidate);
  const coachScore = scoreCoach(engagement, candidate);

  if (courseScore < options.courseGate || dateScore < options.dateGate) {
    return { candidate, courseScore, dateScore, timeScore, coachScore, score: 0 };
  }

  return {
    candidate,
    courseScore,
    dateScore,
    timeScore,
    coachScore,
    score: courseScore + dateScore + timeScore + coachScore
  };
}

/**
 * 과정코드 비교용 정규화.
 * 원천 데이터(운영 시트)의 과정코드에는 눈에 보이지 않는 문자(zero-width space 등)가 섞여 들어온다.
 * 이걸 지우지 않으면 화면에는 같은 "255413"으로 보여도 문자열 비교가 어긋나 매칭이 전부 실패한다.
 * 적재 경로의 normalizeCourseId(operationCalculations)와 같은 규칙을 쓴다.
 */
function normalizeCourseId(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\.0$/, "");
}

function scoreCourseName(engagement: EngagementKey, candidate: OperationCandidate): number {
  // courseId가 양쪽에 있고 정확히 일치하면, 과정명 표기가 흔들려도 강하게 매칭한다.
  // (같은 courseId 안에 여러 세션이 있어도 이후 날짜 게이트가 계속 구분하므로 오매칭되지 않는다.)
  const engagementCourseId = normalizeCourseId(engagement.courseId);
  const candidateCourseId = normalizeCourseId(candidate.courseId);
  if (engagementCourseId && candidateCourseId && engagementCourseId === candidateCourseId) {
    return 100;
  }

  const engagementName = normalizeCourseName(engagement.courseName);
  const candidateName = normalizeCourseName(candidate.courseName);
  if (engagementName === candidateName) return 100;

  const engagementSimple = simplifyCourseName(engagement.courseName);
  const candidateSimple = simplifyCourseName(candidate.courseName);
  if (engagementSimple && engagementSimple === candidateSimple) return 95;

  const candidateWithCompany = simplifyCourseName(
    `${candidate.companyName ?? ""} ${candidate.courseName}`
  );
  if (engagementSimple && engagementSimple === candidateWithCompany) return 95;

  const shorter = engagementSimple.length < candidateSimple.length ? engagementSimple : candidateSimple;
  const longer = engagementSimple.length < candidateSimple.length ? candidateSimple : engagementSimple;
  if (shorter.length >= 6 && longer.includes(shorter)) return 85;

  const overlap = tokenOverlap(engagementSimple, candidateSimple);
  if (overlap >= 0.8) return 80;
  if (overlap >= 0.65) return 70;

  return 0;
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = uniqueTokens(left);
  const rightTokens = uniqueTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const rightSet = new Set(rightTokens);
  const matched = leftTokens.filter((token) => rightSet.has(token)).length;
  return matched / Math.max(leftTokens.length, rightTokens.length);
}

function uniqueTokens(value: string): string[] {
  return [...new Set(value.split(" ").filter((token) => token.length >= 2))];
}

function scoreDateRange(engagement: EngagementKey, candidate: OperationCandidate): number {
  if (candidate.startDate === engagement.startDate && candidate.endDate === engagement.endDate) {
    return 100;
  }
  if (candidate.startDate === engagement.startDate || candidate.endDate === engagement.endDate) {
    return 70;
  }

  const overlap = dateOverlapRatio(
    engagement.startDate,
    engagement.endDate,
    candidate.startDate,
    candidate.endDate
  );
  if (overlap >= 0.8) return 80;
  if (overlap >= 0.5) return 65;

  const scheduleOverlap = scheduleDateOverlapRatio(engagement.scheduleDates, candidate);
  if (scheduleOverlap >= 0.8) return 80;
  if (scheduleOverlap >= 0.5) return 65;

  return 0;
}

function scheduleDateOverlapRatio(
  scheduleDates: string[] | null | undefined,
  candidate: OperationCandidate
): number {
  const dates = (scheduleDates ?? []).filter((date) => toDateMs(date) !== null);
  if (dates.length === 0) return 0;

  const matched = dates.filter((date) => isDateInsideRange(date, candidate.startDate, candidate.endDate)).length;
  return matched / dates.length;
}

function isDateInsideRange(date: string, startDate: string, endDate: string): boolean {
  const dateMs = toDateMs(date);
  const startMs = toDateMs(startDate);
  const endMs = toDateMs(endDate);
  if (dateMs === null || startMs === null || endMs === null) return false;
  return dateMs >= startMs && dateMs <= endMs;
}

function dateOverlapRatio(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): number {
  const leftStartMs = toDateMs(leftStart);
  const leftEndMs = toDateMs(leftEnd);
  const rightStartMs = toDateMs(rightStart);
  const rightEndMs = toDateMs(rightEnd);
  if (leftStartMs === null || leftEndMs === null || rightStartMs === null || rightEndMs === null) {
    return 0;
  }

  const overlapStart = Math.max(leftStartMs, rightStartMs);
  const overlapEnd = Math.min(leftEndMs, rightEndMs);
  if (overlapEnd < overlapStart) return 0;

  const dayMs = 24 * 60 * 60 * 1000;
  const overlapDays = Math.floor((overlapEnd - overlapStart) / dayMs) + 1;
  const leftDays = Math.floor((leftEndMs - leftStartMs) / dayMs) + 1;
  const rightDays = Math.floor((rightEndMs - rightStartMs) / dayMs) + 1;

  return overlapDays / Math.min(leftDays, rightDays);
}

function toDateMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

function scoreTime(engagement: EngagementKey, candidate: OperationCandidate): number {
  const engagementTimes = [
    { startTime: engagement.startTime ?? null, endTime: engagement.endTime ?? null },
    ...(engagement.scheduleTimes ?? [])
  ];

  const candidateTimes = extractTimes(candidate.timeText);
  if (candidateTimes.length === 0) return 0;

  const bestScore = Math.max(
    ...engagementTimes.map((timeRange) => {
      const engagementStart = normalizeTime(timeRange.startTime);
      const engagementEnd = normalizeTime(timeRange.endTime);
      if (!engagementStart && !engagementEnd) return 0;

      const hasStart = engagementStart ? candidateTimes.includes(engagementStart) : false;
      const hasEnd = engagementEnd ? candidateTimes.includes(engagementEnd) : false;
      if (hasStart && hasEnd) return 20;
      if (hasStart || hasEnd) return 10;
      return -10;
    })
  );

  if (bestScore > 0) return bestScore;
  return -10;
}

function scoreCoach(engagement: EngagementKey, candidate: OperationCandidate): number {
  const coachName = simplifyCourseName(engagement.coachName ?? "");
  if (!coachName) return 0;

  const candidatePeopleText = simplifyCourseName(
    `${candidate.coachText ?? ""} ${candidate.instructorsText ?? ""}`
  );
  if (!candidatePeopleText) return 0;

  return candidatePeopleText.includes(coachName) ? 20 : 0;
}

function extractTimes(value: string | null | undefined): string[] {
  const matches = String(value ?? "").match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g);
  return matches ? matches.map((time) => normalizeTime(time)).filter((time): time is string => Boolean(time)) : [];
}

function normalizeTime(value: string | null | undefined): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}
