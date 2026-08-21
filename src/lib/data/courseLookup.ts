import type { CourseLookupCandidate } from "./operationTypes";

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
