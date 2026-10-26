import { getSeoulToday } from "@/lib/seoulDate";
import type { CoachEngagementFact, CoachEngagementStatusValue, CoachSummary } from "@/lib/data/coachTypes";

// =============================================================================
// 코치 활동 상태·최근 평균 계산
// - 저장값을 바꾸지 않고 읽을 때 계산한다. PG·Mongo 어댑터가 같은 함수를 쓴다.
// - 기준값은 운영 정책에서 정한다. 화면 문구에는 숫자를 쓰지 않고, 바꿀 때는 환경변수로 덮어쓴다.
// =============================================================================

function readPositiveInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface CoachActivityPolicy {
  /** 마지막 투입에서 이 개월 수가 지나면 휴면. */
  dormantMonths: number;
  /** 최근 평균에 쓰는 평가 수. */
  recentRatingWindow: number;
  /** 이보다 평가가 적으면 평균을 보여주지 않는다. */
  minRatingsForAverage: number;
}

export const coachActivityPolicy: CoachActivityPolicy = {
  dormantMonths: readPositiveInt("COACH_DORMANT_MONTHS", 6),
  recentRatingWindow: readPositiveInt("COACH_RECENT_RATING_WINDOW", 6),
  minRatingsForAverage: readPositiveInt("COACH_MIN_RATINGS_FOR_AVERAGE", 3)
};

export type CoachEngagementDigest = Pick<CoachSummary, "engagementFacts" | "recentAvgRating" | "recentRatingCount">;

export type CoachEngagementDigestInput = CoachEngagementFact;

/**
 * 최근 평균: 취소가 아닌 투입을 최근 순으로 보고, 평가가 있는 것만 최근 N건 평균.
 * 새 OM 평가(evaluationAverages, 투입 ID → 평균)가 있으면 그 값을, 없으면 예전 평점을 쓴다.
 */
export function recentRatingSummary(
  facts: ReadonlyArray<CoachEngagementFact>,
  evaluationAverages: ReadonlyMap<string, number> = new Map(),
  policy: CoachActivityPolicy = coachActivityPolicy
): Pick<CoachSummary, "recentAvgRating" | "recentRatingCount"> {
  const recentRatings = [...facts]
    .sort((a, b) => b.endDate.localeCompare(a.endDate) || b.startDate.localeCompare(a.startDate))
    .filter((fact) => !fact.cancelled)
    .map((fact) => evaluationAverages.get(fact.engagementId) ?? fact.rating)
    .filter((rating): rating is number => typeof rating === "number")
    .slice(0, policy.recentRatingWindow);
  const recentAvgRating =
    recentRatings.length >= policy.minRatingsForAverage
      ? recentRatings.reduce((sum, rating) => sum + rating, 0) / recentRatings.length
      : null;
  return { recentAvgRating, recentRatingCount: recentRatings.length };
}

export function digestCoachEngagements(
  rows: ReadonlyArray<CoachEngagementDigestInput>,
  policy: CoachActivityPolicy = coachActivityPolicy
): CoachEngagementDigest {
  return {
    engagementFacts: [...rows]
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate))
      .map(({ engagementId, startDate, endDate, cancelled, rating }) => ({ engagementId, startDate, endDate, cancelled, rating })),
    ...recentRatingSummary(rows, new Map(), policy)
  };
}

/** 활동: 기간 안에 투입 있음 / 휴면: 마지막 투입 종료가 기간을 넘음 / 미투입: 투입 0회. */
export type CoachActivityStatus = "active" | "dormant" | "never";

export interface CoachActivity {
  status: CoachActivityStatus;
  /** 시작일이 오늘 이전인 투입 수(취소 제외). */
  deployCount: number;
  /** 가장 최근 투입의 시작일. */
  lastDeployDate: string | null;
  /** 아직 시작 전인 투입 수(취소 제외). */
  upcomingCount: number;
}

export function summarizeCoachActivity(
  facts: ReadonlyArray<CoachEngagementFact>,
  today: string,
  policy: CoachActivityPolicy = coachActivityPolicy
): CoachActivity {
  const live = facts.filter((fact) => !fact.cancelled);
  const deployed = live.filter((fact) => fact.startDate <= today);
  const lastDeployDate = deployed.reduce<string | null>(
    (latest, fact) => (latest === null || fact.startDate > latest ? fact.startDate : latest),
    null
  );

  // 휴면은 마지막으로 현장에 나간 날로 판정한다. 진행 중인 투입은 오늘까지 나간 것으로 본다.
  // 시작일로 판정하면 오래 이어지는 과정에 나가고 있는 코치가 휴면으로 보인다.
  const lastActiveDate = deployed.reduce<string | null>((latest, fact) => {
    const activeUntil = fact.endDate < today ? fact.endDate : today;
    return latest === null || activeUntil > latest ? activeUntil : latest;
  }, null);

  let status: CoachActivityStatus = "never";
  if (lastActiveDate !== null) {
    status = lastActiveDate < shiftMonths(today, -policy.dormantMonths) ? "dormant" : "active";
  }

  return {
    status,
    deployCount: deployed.length,
    lastDeployDate,
    upcomingCount: live.length - deployed.length
  };
}

/**
 * 화면에 보여줄 투입 상태. 저장된 상태는 동기화할 때만 계산돼 지난 일정이 "예정"으로 남는다.
 * 취소·완료는 그대로 두고, 나머지는 날짜로 다시 정한다.
 */
export function effectiveEngagementStatus(
  engagement: { status: CoachEngagementStatusValue; startDate: string; endDate: string },
  today: string
): CoachEngagementStatusValue {
  if (engagement.status === "cancelled" || engagement.status === "completed") return engagement.status;
  if (engagement.endDate < today) return "completed";
  if (engagement.startDate <= today) return "in_progress";
  return "scheduled";
}

/** 한국 기준 오늘(YYYY-MM-DD). */
export function seoulTodayKey(now: Date = new Date()): string {
  const today = getSeoulToday(now);
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
}

/** YYYY-MM-DD에서 개월을 더하거나 뺀다. 말일이 없으면 그 달 말일로 맞춘다(3/31 - 1개월 = 2/28). */
export function shiftMonths(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}
