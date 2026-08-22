import { normalizeCourseId } from "./operationCalculations";
import type { CourseLookupCandidate } from "./operationTypes";

/** 저장소에서 읽어온 그대로의 과정 한 줄. courseId는 아직 정규화되지 않았다. */
export interface CourseLookupRow {
  courseId: string;
  companyName: string;
  courseName: string;
  latestStartDate: string | null;
}

/** 최근 회차가 있는 과정을 앞에 둔다. 회차가 없는 과정은 뒤로, 같으면 과정명 순(결정적). */
export function compareCourseLookupCandidates(a: CourseLookupCandidate, b: CourseLookupCandidate): number {
  if (a.latestStartDate !== b.latestStartDate) {
    if (!a.latestStartDate) return 1;
    if (!b.latestStartDate) return -1;
    return b.latestStartDate.localeCompare(a.latestStartDate);
  }

  return a.courseName.localeCompare(b.courseName);
}

/**
 * 읽어온 과정 줄들에서 코스ID가 `target`과 같은 것만 골라낸다.
 *
 * **양쪽을 정규화해서 비교한다.** 코스ID는 사내 다른 시스템이 채워 넣는 값이라 제로폭 문자나
 * 엑셀에서 온 `.0` 꼬리가 섞여 들어온다. 원문끼리 비교하면 눈에 같아 보이는 값이 안 맞는다
 * (PR #189에서 시트 쪽 전 건 매칭 실패로 겪은 문제). 이 레포의 다른 경로들
 * (localJsonOperationRepository·salesRevenueSync·operationMatch)도 모두 정규화 비교를 쓴다.
 *
 * `target`은 호출자가 이미 `normalizeCourseId`를 거친 값이어야 한다.
 */
export function selectCoursesByCourseId(rows: CourseLookupRow[], target: string): CourseLookupCandidate[] {
  if (!target) return [];

  return rows
    .filter((row) => normalizeCourseId(row.courseId) === target)
    .map((row) => ({
      courseId: target,
      companyName: row.companyName,
      courseName: row.courseName,
      latestStartDate: row.latestStartDate
    }))
    .sort(compareCourseLookupCandidates);
}

export interface CourseLookupResolution {
  /** 채울 고객사명. 후보들의 고객사가 갈리면 빈 문자열. */
  company: string;
  /** 채울 과정명. 후보가 둘 이상이면 빈 문자열(어느 과정인지 특정할 수 없다). */
  courseName: string;
  /** 한 코스ID에 과정이 여러 개였는지. 호출자가 안내 문구에 쓴다. */
  ambiguous: boolean;
  candidateCount: number;
}

/**
 * 코스ID로 찾은 과정 후보들에서 '자동으로 채워도 되는 값'만 골라낸다.
 *
 * 한 코스ID에 과정이 여러 개인 경우가 전체의 16~18%다. 그때 과정명을 임의로 하나 고르면
 * 틀린 과정명이 만족도 집계·시트·대시보드까지 흘러가므로 **과정명은 채우지 않는다**.
 * 반면 고객사는 같은 코스ID면 대개 동일해서, 후보 전부가 같은 고객사일 때만 채운다.
 *
 * 후보가 없으면 null.
 */
export function resolveCourseLookup(candidates: CourseLookupCandidate[]): CourseLookupResolution | null {
  if (candidates.length === 0) return null;

  const [first] = candidates;

  if (candidates.length === 1) {
    return {
      company: first.companyName.trim(),
      courseName: first.courseName.trim(),
      ambiguous: false,
      candidateCount: 1
    };
  }

  const companies = new Set(candidates.map((candidate) => candidate.companyName.trim()));

  return {
    company: companies.size === 1 ? first.companyName.trim() : "",
    courseName: "",
    ambiguous: true,
    candidateCount: candidates.length
  };
}
