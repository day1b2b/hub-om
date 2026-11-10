import type { PeopleRow } from "@/features/people/PeopleDirectory";
import { averageOf, formatPeopleDate, parseSatisfaction, peopleStatusFromFacts } from "@/lib/people/peopleStatus";
import { cleanCourseName, hasOperationHistory, instructorWikiHref, type InstructorWikiEntry } from "./instructorWikiModel";

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
  // 목록 "투입"은 완료(시작일 ≤ 오늘) 수. 예정은 아래 recent 줄에 따로 표시한다(코치 목록과 동일).
  const completedCount = entry.courses.filter((course) => course.startDate && course.startDate <= today).length;
  // 최근 투입은 이미 시작한 과정 기준. 앞으로 잡힌 과정만 있으면 "예정"으로 보여 준다.
  const past = entry.courses.find((course) => course.startDate && course.startDate <= today);
  const upcoming = past ? undefined : entry.courses.find((course) => course.startDate > today);
  const recent = past ?? upcoming;
  const fields = entry.categories.length > 0 ? entry.categories : entry.coach?.fields ?? [];
  // 종합만족도(전체 총평) = avgSatisfaction, 강사만족도 = instructorSatisfaction. 둘을 따로 집계한다.
  const courseScores = entry.courses
    .map((course) => parseSatisfaction(course.avgSatisfaction))
    .filter((score): score is number => score !== null);
  const courseRating = averageOf(courseScores);
  const instructorScores = entry.courses
    .map((course) => parseSatisfaction(course.instructorSatisfaction))
    .filter((score): score is number => score !== null);
  const instructorRating = averageOf(instructorScores);

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
    deployCount: completedCount,
    deployLabel: `${completedCount}건`,
    rating: courseRating,
    ratingLabel: courseRating !== null ? `${courseRating.toFixed(1)} (${courseScores.length}건)` : "-",
    secondaryRating: instructorRating,
    secondaryRatingLabel: instructorRating !== null ? `${instructorRating.toFixed(1)} (${instructorScores.length}건)` : "-",
    secondary: entry.companies,
    searchText: [
      entry.name,
      ...entry.companies,
      ...entry.courses.map((course) => course.courseName),
      ...entry.categories,
      ...(entry.coach?.fields ?? [])
    ].join(" ")
  };
}
