import type { PeopleRow } from "@/features/people/PeopleDirectory";
import { averageOf, formatPeopleDate, parseSatisfaction, peopleStatusFromFacts } from "@/lib/people/peopleStatus";
import { cleanCourseName, hasOperationHistory, instructorWikiHref, type InstructorWikiEntry } from "./instructorWikiModel";

// 저표본(3건 미만) 만족도 평균은 1~2건이 전체를 왜곡해 "만족도 높은순" 정렬을 무너뜨린다.
// 코치 위키(COACH_MIN_RATINGS_FOR_AVERAGE 기본 3)와 같은 기준으로, 3건 미만이면 평균을 숨기고
// 건수만 표기한다. 값이 없으면 "-", 1~2건이면 "(N건)". 정렬에서는 rating=null이 뒤로 간다.
const MIN_RATINGS_FOR_AVERAGE = 3;

function ratingWithFloor(scores: number[]): { rating: number | null; label: string } {
  if (scores.length === 0) return { rating: null, label: "-" };
  if (scores.length < MIN_RATINGS_FOR_AVERAGE) return { rating: null, label: `(${scores.length}건)` };
  const rating = averageOf(scores);
  return rating !== null
    ? { rating, label: `${rating.toFixed(1)} (${scores.length}건)` }
    : { rating: null, label: "-" };
}

// 강사위키 목록 한 줄(PeopleRow)을 서버에서 만든다.
// 예전엔 전체 entries(코스 상세 포함)를 클라이언트로 내려 toRow를 거기서 돌렸는데,
// 목록은 요약만 쓰고 코스 상세는 별도 상세 라우트에서만 쓰므로 요약만 계산해 넘겨 payload를 줄인다.
export function buildInstructorRows(
  entries: InstructorWikiEntry[],
  recruitAvoidNames: string[],
  today: string,
  dormantMonths: number
): PeopleRow[] {
  const avoidSet = new Set(recruitAvoidNames);
  return entries.map((entry) => toRow(entry, avoidSet.has(entry.name), today, dormantMonths));
}

function toRow(entry: InstructorWikiEntry, recruitAvoid: boolean, today: string, dormantMonths: number): PeopleRow {
  // 최근 투입은 이미 시작한 과정 기준. 앞으로 잡힌 과정만 있으면 "예정"으로 보여 준다.
  const past = entry.courses.find((course) => course.startDate && course.startDate <= today);
  const upcoming = past ? undefined : entry.courses.find((course) => course.startDate > today);
  const recent = past ?? upcoming;
  // 전문분야는 노션 강사 DB(강사 정본)를 우선하고 코치 DB로 폴백한다(상세 InstructorWikiDetail와 같은 우선순위).
  // coach.fields는 '코치로 등록한 분야'라 강의 전문분야와 다를 수 있어, 정본인 노션 카테고리를 우선한다.
  const fields = entry.categories.length > 0 ? entry.categories : entry.coach?.fields ?? [];
  // 종합만족도(전체 총평) = avgSatisfaction, 강사만족도 = instructorSatisfaction. 둘을 따로 집계한다.
  // 저표본은 ratingWithFloor로 평균을 숨긴다(위 주석 참고).
  const courseSat = ratingWithFloor(
    entry.courses.map((course) => parseSatisfaction(course.avgSatisfaction)).filter((score): score is number => score !== null)
  );
  const instructorSat = ratingWithFloor(
    entry.courses.map((course) => parseSatisfaction(course.instructorSatisfaction)).filter((score): score is number => score !== null)
  );

  return {
    id: entry.id,
    href: instructorWikiHref(entry),
    name: entry.name,
    // 진행·예정은 날짜로만 판단한다. 운영현황 진행상태는 지난 회차가 "배정필요"로 남아 있는 경우가 많아 믿을 수 없다.
    status: peopleStatusFromFacts(
      entry.courses.map((course) => ({ startDate: course.startDate, endDate: course.endDate })),
      today,
      dormantMonths
    ),
    fields,
    flags: recruitAvoid ? [{ label: "⛔ 섭외지양", tone: "bad" }] : [],
    recent: recent
      ? [upcoming ? "예정" : "", recent.companyName, cleanCourseName(recent.courseName), recent.startDate ? formatPeopleDate(recent.startDate, today) : ""]
          .filter(Boolean)
          .join(" · ")
      : null,
    subline: hasOperationHistory(entry) ? null : "운영 배정 이력 없음",
    recentDate: past?.startDate || null,
    deployCount: entry.courseCount,
    deployLabel: `${entry.courseCount}건`,
    rating: courseSat.rating,
    ratingLabel: courseSat.label,
    secondaryRating: instructorSat.rating,
    secondaryRatingLabel: instructorSat.label,
    secondary: entry.companies,
    // 과정명은 회차마다 중복돼 payload를 불린다 — 정리·중복제거해 담는다(검색은 부분일치라 1회만 있어도 됨).
    searchText: [
      entry.name,
      ...entry.companies,
      ...Array.from(new Set(entry.courses.map((course) => cleanCourseName(course.courseName)))),
      ...entry.categories,
      ...(entry.coach?.fields ?? [])
    ].join(" ")
  };
}
