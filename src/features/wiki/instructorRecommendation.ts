import type { InstructorNote } from "@/lib/data/instructorNoteRepository";
import type { OperationSession } from "@/lib/data/operationTypes";
import { courseCategoryMajor, notionCategoryToMajor } from "@/lib/people/courseCategoryMap";
import { averageOf, formatPeopleDate, parseSatisfaction, peopleStatusFromFacts, type PeopleStatus } from "@/lib/people/peopleStatus";
import { aggregateInstructors, cleanCourseName, instructorWikiHref } from "./instructorWikiModel";

// =============================================================================
// 과정 상세 "후보 강사" 계산. 지금 있는 데이터만 쓴다(DB 변경 없음).
// 순위: 같은 소분류 과정 투입 수 → 같은 대분류 투입 수 → 노션 분야 일치 → 강사 만족도 → 최근 투입.
// 제외: 이 과정에 이미 배정된 강사, 섭외지양, 이 과정 일정과 겹치는 다른 과정에 배정된 강사(따로 보여 준다).
// =============================================================================

export interface InstructorCandidate {
  name: string;
  href: string;
  status: PeopleStatus;
  sameMinorCount: number;
  sameMajorCount: number;
  notionMatch: boolean;
  satisfaction: number | null;
  lastDate: string;
  reasons: string[];
}

export interface InstructorConflict {
  name: string;
  href: string;
  conflictWith: string;
  date: string;
}

export interface InstructorRecommendation {
  /** 과정 카테고리가 없으면 추천하지 않는다(무엇을 기준으로 고를지 모름). */
  needsCategory: boolean;
  minor: string;
  major: string;
  candidates: InstructorCandidate[];
  conflicts: InstructorConflict[];
  excludedAvoidCount: number;
}

interface RecommendInput {
  courseOperations: OperationSession[];
  operations: OperationSession[];
  notes: InstructorNote[];
  today: string;
  dormantMonths: number;
  limit?: number;
}

export function recommendInstructors({
  courseOperations,
  operations,
  notes,
  today,
  dormantMonths,
  limit = 5
}: RecommendInput): InstructorRecommendation {
  const minor = courseOperations.map((operation) => operation.courseCategory).find((value) => value?.trim())?.trim() ?? "";
  const major = courseCategoryMajor(minor) ?? "";
  const empty = { minor, major, candidates: [], conflicts: [], excludedAvoidCount: 0 };
  if (!major) return { needsCategory: true, ...empty };

  const courseIds = new Set(courseOperations.map((operation) => operation.operationId));
  const categoryByOperation = new Map(operations.map((operation) => [operation.operationId, operation.courseCategory ?? ""]));
  const operationById = new Map(operations.map((operation) => [operation.operationId, operation]));
  // 겹침은 아직 끝나지 않은 회차 기준. 다 끝난 과정이면 전체 회차로 본다.
  const upcoming = courseOperations.filter((operation) => (operation.endDate || operation.startDate) >= today);
  const targetRanges = (upcoming.length > 0 ? upcoming : courseOperations)
    .filter((operation) => operation.startDate)
    .map((operation) => [operation.startDate, operation.endDate || operation.startDate] as const);

  const noteByName = new Map<string, InstructorNote>();
  for (const note of notes) {
    for (const name of [note.instructorName, note.displayName]) {
      const key = (name ?? "").trim();
      if (key && !noteByName.has(key)) noteByName.set(key, note);
    }
  }

  const entries = aggregateInstructors(operations);
  const historyNames = new Set(entries.map((entry) => entry.name));
  const assigned = new Set(entries.filter((entry) => entry.courses.some((course) => courseIds.has(course.operationId))).map((entry) => entry.name));

  const candidates: InstructorCandidate[] = [];
  const conflicts: InstructorConflict[] = [];
  let excludedAvoidCount = 0;

  const consider = (name: string, courses: (typeof entries)[number]["courses"], note: InstructorNote | undefined) => {
    if (assigned.has(name)) return;
    const notionMajors = new Set((note?.notion?.categories ?? []).map(notionCategoryToMajor).filter(Boolean));
    let sameMinorCount = 0;
    let sameMajorCount = 0;
    for (const course of courses) {
      const category = categoryByOperation.get(course.operationId) ?? "";
      if (minor && category === minor) sameMinorCount += 1;
      if (courseCategoryMajor(category) === major) sameMajorCount += 1;
    }
    const notionMatch = notionMajors.has(major);
    if (!sameMinorCount && !sameMajorCount && !notionMatch) return;

    if (note?.notion?.recruitAvoid || note?.recruitAvoid) {
      excludedAvoidCount += 1;
      return;
    }
    const href = instructorWikiHref({ name, notionNo: note?.notionNo });
    const clash = courses.find((course) => {
      if (courseIds.has(course.operationId) || !course.startDate) return false;
      const end = course.endDate || course.startDate;
      return targetRanges.some(([start, stop]) => course.startDate <= stop && end >= start);
    });
    if (clash) {
      const other = operationById.get(clash.operationId);
      conflicts.push({ name, href, conflictWith: `${clash.companyName} ${cleanCourseName(other?.courseName ?? clash.courseName)}`, date: clash.startDate });
      return;
    }

    const scores = courses.map((course) => parseSatisfaction(course.instructorSatisfaction)).filter((score): score is number => score !== null);
    const satisfaction = averageOf(scores);
    const lastDate = courses.map((course) => course.startDate).filter((date) => date && date <= today).sort().at(-1) ?? "";
    const reasons = [
      sameMinorCount ? `같은 소분류 과정 ${sameMinorCount}회` : sameMajorCount ? `같은 대분류(${major}) 과정 ${sameMajorCount}회` : "노션 분야 일치",
      satisfaction !== null ? `강사 만족도 ${satisfaction.toFixed(1)}` : "",
      lastDate ? `최근 투입 ${formatPeopleDate(lastDate, today)}` : courses.length === 0 ? "투입 이력 없음" : ""
    ].filter(Boolean);
    candidates.push({
      name,
      href,
      status: peopleStatusFromFacts(courses.map((course) => ({ startDate: course.startDate, endDate: course.endDate })), today, dormantMonths),
      sameMinorCount,
      sameMajorCount,
      notionMatch,
      satisfaction,
      lastDate,
      reasons
    });
  };

  for (const entry of entries) consider(entry.name, entry.courses, noteByName.get(entry.name));
  // 운영 이력은 없지만 노션 분야가 맞는 강사도 후보 뒤쪽에 넣는다.
  for (const note of notes) {
    const name = (note.displayName || note.instructorName || "").trim();
    if (!name || historyNames.has(name) || historyNames.has((note.instructorName ?? "").trim())) continue;
    consider(name, [], note);
  }

  candidates.sort(
    (a, b) =>
      b.sameMinorCount - a.sameMinorCount ||
      b.sameMajorCount - a.sameMajorCount ||
      Number(b.notionMatch) - Number(a.notionMatch) ||
      (b.satisfaction ?? -1) - (a.satisfaction ?? -1) ||
      b.lastDate.localeCompare(a.lastDate) ||
      a.name.localeCompare(b.name, "ko")
  );

  return {
    needsCategory: false,
    minor,
    major,
    candidates: candidates.slice(0, limit),
    conflicts: conflicts.slice(0, 3),
    excludedAvoidCount
  };
}
