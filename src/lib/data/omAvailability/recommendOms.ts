import type { OmRequestSession } from "../omRequest/omRequestTypes";

export interface OmRecommendationTier {
  rank: 1 | 2 | 3;
  label: string;
  missingDays: number;
  oms: string[];
}

const TIER_LABELS = ["전부 가능", "1일 제외 가능", "2일 제외 가능"];

export function expandDateRange(start: string, end?: string): string[] {
  if (!start) return [];
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : startDate;
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return [start];
  }

  const dates: string[] = [];
  for (const cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function collectSessionDates(sessions: OmRequestSession[]): string[] {
  const dates = new Set<string>();
  sessions.forEach((session) => expandDateRange(session.date, session.dateEnd).forEach((date) => dates.add(date)));
  return Array.from(dates);
}

// 강의일정 날짜와, 리소스 캘린더 기준 이미 잡혀있는 강의관리 일정(busyDatesByOm)이 겹치는 날 수로 1~3순위(0~2일 결측)까지만 추천한다.
export function recommendOms(
  sessions: OmRequestSession[],
  omNames: string[],
  busyDatesByOm: Map<string, Set<string>>
): OmRecommendationTier[] {
  const sessionDates = collectSessionDates(sessions);
  if (sessionDates.length === 0 || omNames.length === 0) return [];

  const scored = omNames.map((name) => {
    const busy = busyDatesByOm.get(name);
    const missingDays = busy ? sessionDates.filter((date) => busy.has(date)).length : 0;
    return { name, missingDays };
  });

  return [0, 1, 2]
    .map((missingDays) => ({
      rank: (missingDays + 1) as 1 | 2 | 3,
      label: TIER_LABELS[missingDays],
      missingDays,
      oms: scored.filter((om) => om.missingDays === missingDays).map((om) => om.name)
    }))
    .filter((tier) => tier.oms.length > 0);
}
