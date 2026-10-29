import { shiftMonths } from "@/lib/coaches/coachActivity";

// =============================================================================
// 강사 위키·코치 위키 공통 상태
// - 두 화면이 같은 말로 사람을 구분하도록 한 곳에서 정한다.
// - 진행·예정: 지금 진행 중이거나 앞으로 잡힌 투입이 있음
//   활동: 최근 N개월 안에 현장에 나감 / 휴면: N개월을 넘김 / 미투입: 투입 이력 없음
// - N은 코치 활동 정책(COACH_DORMANT_MONTHS)과 같은 값을 받아 쓴다.
// =============================================================================

export type PeopleStatus = "booked" | "active" | "dormant" | "never";

export const PEOPLE_STATUS_ORDER: PeopleStatus[] = ["booked", "active", "dormant", "never"];

export const PEOPLE_STATUS_LABEL: Record<PeopleStatus, string> = {
  booked: "진행·예정",
  active: "활동",
  dormant: "휴면",
  never: "미투입"
};

export interface PeopleStatusFact {
  startDate: string;
  endDate: string;
  cancelled?: boolean;
}

/**
 * 투입 날짜로 상태를 정한다. 날짜가 빈 투입은 날짜로 판단할 수 없어 건너뛴다.
 * hasBooking을 넘기면(강사: 운영 현황 진행상태가 배정필요·배정예정·진행중) 날짜와 별개로 진행·예정으로 본다.
 */
export function peopleStatusFromFacts(
  facts: ReadonlyArray<PeopleStatusFact>,
  today: string,
  dormantMonths: number,
  hasBooking = false
): PeopleStatus {
  const live = facts.filter((fact) => !fact.cancelled && fact.startDate);
  if (hasBooking || live.some((fact) => (fact.endDate || fact.startDate) >= today)) return "booked";

  const lastActiveDate = live.reduce<string | null>((latest, fact) => {
    const end = fact.endDate || fact.startDate;
    return latest === null || end > latest ? end : latest;
  }, null);
  if (lastActiveDate === null) return facts.length > 0 ? "dormant" : "never";
  return lastActiveDate < shiftMonths(today, -dormantMonths) ? "dormant" : "active";
}

/** 올해면 "10.16", 아니면 "2025.10.16". */
export function formatPeopleDate(dateKey: string, today: string): string {
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  const short = `${Number(month)}.${Number(day)}`;
  return year === today.slice(0, 4) ? short : `${year}.${short}`;
}

/** 강사 만족도 칸(문자열)을 숫자로. 5점 척도 밖이거나 숫자가 아니면 버린다. */
export function parseSatisfaction(value: string): number | null {
  const score = Number.parseFloat(value);
  return Number.isFinite(score) && score > 0 && score <= 5 ? score : null;
}

export function averageOf(values: ReadonlyArray<number>): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
