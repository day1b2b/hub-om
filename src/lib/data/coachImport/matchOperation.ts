export interface EngagementKey {
  courseName: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
}

export interface OperationCandidate {
  id: string;
  courseName: string;
  companyName?: string | null;
  startDate: string;
  endDate: string;
  timeText?: string | null;
}

/**
 * 코치 투입이력(engagement)을 운영 세션(operation)에 매칭한다.
 *
 * 매칭 규칙:
 *   1. 과정명이 충분히 유사해야 한다.
 *   2. 일정은 정확히 같거나 기간이 충분히 겹쳐야 한다.
 *   3. 시간 정보가 있으면 보조 점수로만 사용한다.
 *
 * 가장 높은 점수의 후보가 명확히 1건일 때만 id를 반환한다.
 * 후보가 없거나, 상위 후보들이 비슷하면 오매칭 방지를 위해 null을 반환한다.
 * 이름/사번 기반 매칭은 하지 않는다.
 */
export function matchOperation(
  engagement: EngagementKey,
  candidates: OperationCandidate[]
): string | null {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(engagement, candidate)
    }))
    .filter((entry) => entry.score >= 150)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < 10) return null;

  return scored[0].candidate.id;
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

function scoreCandidate(engagement: EngagementKey, candidate: OperationCandidate): number {
  const courseScore = scoreCourseName(engagement.courseName, candidate);
  if (courseScore < 70) return 0;

  const dateScore = scoreDateRange(engagement, candidate);
  if (dateScore < 65) return 0;

  return courseScore + dateScore + scoreTime(engagement, candidate);
}

function scoreCourseName(engagementCourseName: string, candidate: OperationCandidate): number {
  const engagementName = normalizeCourseName(engagementCourseName);
  const candidateName = normalizeCourseName(candidate.courseName);
  if (engagementName === candidateName) return 100;

  const engagementSimple = simplifyCourseName(engagementCourseName);
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

  return 0;
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
  const engagementStart = normalizeTime(engagement.startTime);
  const engagementEnd = normalizeTime(engagement.endTime);
  if (!engagementStart && !engagementEnd) return 0;

  const candidateTimes = extractTimes(candidate.timeText);
  if (candidateTimes.length === 0) return 0;

  const hasStart = engagementStart ? candidateTimes.includes(engagementStart) : false;
  const hasEnd = engagementEnd ? candidateTimes.includes(engagementEnd) : false;
  if (hasStart && hasEnd) return 20;
  if (hasStart || hasEnd) return 10;
  return -10;
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
