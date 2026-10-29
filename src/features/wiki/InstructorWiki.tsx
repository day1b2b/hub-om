"use client";

import { useMemo } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { PeopleDirectory, type PeopleRow } from "@/features/people/PeopleDirectory";
import { averageOf, formatPeopleDate, parseSatisfaction, peopleStatusFromFacts } from "@/lib/people/peopleStatus";
import {
  cleanCourseName,
  instructorWikiHref,
  hasActiveCourse,
  hasOperationHistory,
  type InstructorWikiEntry,
  type InstructorWikiProvenance
} from "./instructorWikiModel";

interface InstructorWikiProps {
  entries: InstructorWikiEntry[];
  loadFailed: boolean;
  /** 운영 현황에서 집계된 강사 수(노션 명단 합치기 전). 헤더 안내용. */
  operationEntryCount?: number;
  provenance: InstructorWikiProvenance;
  recruitAvoidNames?: string[];
  /** 한국 기준 오늘(YYYY-MM-DD). 상태·날짜 표기를 서버와 맞춘다. */
  today: string;
  /** 활동/휴면 경계(개월). 코치 위키와 같은 값을 쓴다. */
  dormantMonths: number;
}

export function InstructorWiki({
  entries,
  loadFailed,
  operationEntryCount,
  provenance,
  recruitAvoidNames = [],
  today,
  dormantMonths
}: InstructorWikiProps) {
  const rows = useMemo(() => {
    const avoidSet = new Set(recruitAvoidNames);
    return entries.map((entry) => toRow(entry, avoidSet.has(entry.name), today, dormantMonths));
  }, [dormantMonths, entries, recruitAvoidNames, today]);

  const lede =
    provenance === "empty"
      ? "관리자 > 데이터 동기화에서 노션 강사 동기화를 실행하거나, 운영 현황에 강사가 배정되면 표시됩니다."
      : provenance === "notion" && operationEntryCount !== undefined
        ? `노션 강사 DB 명단에 운영 현황 배정을 붙여 보여 줍니다. 전체 ${entries.length}명 중 ${operationEntryCount}명이 운영 이력이 있어요.`
        : "운영 현황에 배정된 강사만 보입니다. 노션 동기화를 돌리면 배정 이력이 없는 강사까지 함께 표시됩니다.";

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Instructor Wiki" teamScope="both" />

      <section className="content">
        <PeopleDirectory
          deployHeader="투입"
          emptyText="표시할 강사가 없습니다."
          lede={lede}
          loadFailed={loadFailed}
          loadFailedText="운영 현황 데이터를 불러오지 못했습니다."
          ratingHeader="종합만족도"
          secondaryRatingHeader="강사만족도"
          rows={rows}
          searchPlaceholder="이름 · 전문분야 · 기업 · 과정 검색"
          secondaryLabel="기업"
          title="강사 위키"
        />
      </section>
    </main>
  );
}

function toRow(entry: InstructorWikiEntry, recruitAvoid: boolean, today: string, dormantMonths: number): PeopleRow {
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
    status: peopleStatusFromFacts(
      entry.courses.map((course) => ({ startDate: course.startDate, endDate: course.endDate })),
      today,
      dormantMonths,
      hasActiveCourse(entry)
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
