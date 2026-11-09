import type { CoachSummary } from "@/lib/data/coachTypes";
import { formatPeopleDate, peopleStatusFromFacts, type PeopleStatus } from "@/lib/people/peopleStatus";

// =============================================================================
// 코치 위키 "코치 추천". 지금 있는 데이터만 쓴다(DB 변경 없음).
// 강사 추천은 "같은 분야 과정 N회" 이력으로 순위를 매기지만, 코치는 투입 이력에 과정 카테고리가
// 없고(날짜·평가만) 전문분야 태그도 과정 카테고리와 매핑이 맞지 않는다. 그래서 코치의 강점인
// "그날 투입 가능 + OM 평가"로 적합도를 낸다.
//   순위: OM 평가 높은순 → 투입 경험 많은순 → 최근 투입 → 이름.
//   입력: 교육일(필수 아님)·전문분야(선택). 교육일을 주면 그날 투입 일정이 겹치는 코치는 따로 보여 준다.
//   제외: 비노출(isActive=false)·삭제된 코치.
// =============================================================================

export interface CoachCandidate {
  id: string;
  name: string;
  href: string;
  status: PeopleStatus;
  rating: number | null;
  ratingCount: number;
  deployCount: number;
  lastDate: string;
  reasons: string[];
}

export interface CoachConflictEntry {
  id: string;
  name: string;
  href: string;
  date: string;
  endDate: string;
}

export interface CoachRecommendation {
  /** 교육일·전문분야를 아무것도 고르지 않으면 추천하지 않는다. */
  needsInput: boolean;
  field: string;
  date: string;
  candidates: CoachCandidate[];
  conflicts: CoachConflictEntry[];
}

export function recommendCoachesByCriteria({
  field,
  date,
  coaches,
  today,
  dormantMonths,
  limit = 10
}: {
  field: string;
  date: string;
  coaches: CoachSummary[];
  today: string;
  dormantMonths: number;
  limit?: number;
}): CoachRecommendation {
  const trimmedField = field.trim();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  const empty = { field: trimmedField, date: validDate, candidates: [], conflicts: [] };
  if (!trimmedField && !validDate) return { needsInput: true, ...empty };

  const candidates: CoachCandidate[] = [];
  const conflicts: CoachConflictEntry[] = [];

  for (const coach of coaches) {
    // 비노출·삭제 코치는 섭외 대상이 아니다.
    if (coach.deletedAt || !coach.isActive) continue;
    if (trimmedField && !coach.fields.includes(trimmedField)) continue;

    const facts = coach.engagementFacts.filter((fact) => !fact.cancelled);
    const href = `/coaches/${coach.id}`;

    // 교육일을 주면 그날 투입이 잡힌 코치는 후보에서 빼고 따로 모은다.
    if (validDate) {
      const clash = facts.find(
        (fact) => fact.startDate && fact.startDate <= validDate && (fact.endDate || fact.startDate) >= validDate
      );
      if (clash) {
        conflicts.push({ id: coach.id, name: coach.name, href, date: clash.startDate, endDate: clash.endDate || clash.startDate });
        continue;
      }
    }

    const status = peopleStatusFromFacts(
      facts.map((fact) => ({ startDate: fact.startDate, endDate: fact.endDate })),
      today,
      dormantMonths
    );
    const deployCount = facts.length;
    const lastDate = facts.map((fact) => fact.startDate).filter((value) => value && value <= today).sort().at(-1) ?? "";
    const reasons = [
      coach.recentAvgRating !== null
        ? `OM 평가 ${coach.recentAvgRating.toFixed(1)}`
        : coach.recentRatingCount > 0
          ? `평가 ${coach.recentRatingCount}건`
          : "평가 없음",
      `투입 ${deployCount}회`,
      lastDate ? `최근 ${formatPeopleDate(lastDate, today)}` : "투입 이력 없음"
    ];
    candidates.push({
      id: coach.id,
      name: coach.name,
      href,
      status,
      rating: coach.recentAvgRating,
      ratingCount: coach.recentRatingCount,
      deployCount,
      lastDate,
      reasons
    });
  }

  candidates.sort(
    (a, b) =>
      (b.rating ?? -1) - (a.rating ?? -1) ||
      b.deployCount - a.deployCount ||
      b.lastDate.localeCompare(a.lastDate) ||
      a.name.localeCompare(b.name, "ko")
  );

  return { needsInput: false, field: trimmedField, date: validDate, candidates: candidates.slice(0, limit), conflicts: conflicts.slice(0, 5) };
}
