import type { OperationSession } from "./operationTypes";

export const COURSE_LEVEL_REPORT_LINK_FIELDS = ["resultReportLink", "lectureManagementLink", "lectureManagementNote"] as const;
export type CourseLevelReportLinkField = (typeof COURSE_LEVEL_REPORT_LINK_FIELDS)[number];

const COURSE_FIELD_BY_ROUND_FIELD: Record<CourseLevelReportLinkField, "courseResultReportLink" | "courseLectureManagementLink" | "courseLectureManagementNote"> = {
  resultReportLink: "courseResultReportLink",
  lectureManagementLink: "courseLectureManagementLink",
  lectureManagementNote: "courseLectureManagementNote"
};

export type CourseLevelFieldDecision =
  | { kind: "preserved"; value: string }
  | { kind: "empty" }
  | { kind: "candidate"; value: string }
  | { kind: "conflict" };

export interface CourseLevelReportLinksCoursePlan {
  courseRecordId: string;
  companyName: string;
  courseName: string;
  fields: Record<CourseLevelReportLinkField, CourseLevelFieldDecision>;
}

export interface CourseLevelReportLinksFieldSummary {
  preserved: number;
  candidates: number;
  conflicts: number;
  empty: number;
}

export interface CourseLevelReportLinksPlan {
  courseCount: number;
  summaryByField: Record<CourseLevelReportLinkField, CourseLevelReportLinksFieldSummary>;
  courses: CourseLevelReportLinksCoursePlan[];
}

/**
 * 공유 링크 쿼리스트링/해시만 다른 같은 문서를 충돌로 오인하지 않도록 origin+pathname만 비교한다.
 * URL 형식이 아니면(자유 입력 메모 등) 원문을 그대로 비교한다.
 */
export function normalizeForComparison(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname}`;
  } catch {
    return trimmed;
  }
}

function emptySummary(): CourseLevelReportLinksFieldSummary {
  return { preserved: 0, candidates: 0, conflicts: 0, empty: 0 };
}

/**
 * 회차별 resultReportLink/lectureManagementLink/lectureManagementNote 값을 과정(Course) 레벨로
 * 승격하는 계획을 만든다. 규칙: 과정 레벨에 이미 값이 있으면 보존(덮어쓰지 않음). 없으면 회차 중
 * 비어있지 않은 값을 정규화 기준으로 비교해 전부 같으면 그 중 첫 값을 자동 반영 후보로 삼는다.
 * 정규화 기준으로도 서로 다른 값이 둘 이상이면 자동 반영하지 않고 충돌로 남긴다.
 */
export function planCourseLevelReportLinksBackfill(operations: OperationSession[]): CourseLevelReportLinksPlan {
  const courses = new Map<string, OperationSession[]>();
  for (const operation of operations) {
    if (!operation.courseRecordId) continue;
    const group = courses.get(operation.courseRecordId) ?? [];
    group.push(operation);
    courses.set(operation.courseRecordId, group);
  }

  const summaryByField: CourseLevelReportLinksPlan["summaryByField"] = {
    resultReportLink: emptySummary(),
    lectureManagementLink: emptySummary(),
    lectureManagementNote: emptySummary()
  };
  const coursePlans: CourseLevelReportLinksCoursePlan[] = [];

  for (const [courseRecordId, rounds] of courses) {
    const first = rounds[0];
    const fields = {} as Record<CourseLevelReportLinkField, CourseLevelFieldDecision>;

    for (const field of COURSE_LEVEL_REPORT_LINK_FIELDS) {
      const existing = (first[COURSE_FIELD_BY_ROUND_FIELD[field]] ?? "").trim();
      if (existing) {
        fields[field] = { kind: "preserved", value: existing };
        summaryByField[field].preserved++;
        continue;
      }

      const nonEmpty = rounds.map((round) => round[field]).filter((value) => value.trim().length > 0);
      if (nonEmpty.length === 0) {
        fields[field] = { kind: "empty" };
        summaryByField[field].empty++;
        continue;
      }

      const distinct = new Set(nonEmpty.map(normalizeForComparison));
      if (distinct.size === 1) {
        fields[field] = { kind: "candidate", value: nonEmpty[0].trim() };
        summaryByField[field].candidates++;
      } else {
        fields[field] = { kind: "conflict" };
        summaryByField[field].conflicts++;
      }
    }

    coursePlans.push({ courseRecordId, companyName: first.companyName, courseName: first.courseName, fields });
  }

  return { courseCount: courses.size, summaryByField, courses: coursePlans };
}
