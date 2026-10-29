import type { OperationSession, ResultReportStatus } from "./operationTypes";

export interface ResultReportStatusCoursePlan {
  courseRecordId: string;
  companyName: string;
  courseName: string;
  decision:
    | { kind: "preserved"; value: ResultReportStatus }
    | { kind: "promote"; value: ResultReportStatus };
}

export interface ResultReportStatusPromotionSummary {
  preserved: number;
  promotedYes: number;
  promotedNo: number;
  promotedNotRequired: number;
  promotedNeedsReview: number;
}

export interface ResultReportStatusPromotionPlan {
  courseCount: number;
  summary: ResultReportStatusPromotionSummary;
  courses: ResultReportStatusCoursePlan[];
}

function emptySummary(): ResultReportStatusPromotionSummary {
  return { preserved: 0, promotedYes: 0, promotedNo: 0, promotedNotRequired: 0, promotedNeedsReview: 0 };
}

/**
 * 회차별 hasResultReport 값을 과정(Course) 레벨 하나로 승격하는 규칙.
 *
 * 우선순위:
 * 1) 하나라도 "유"면 "유".
 * 2) 전부 "불필요"면 "불필요"(결과보고서 자체가 필요 없는 과정).
 * 3) "유"는 없고 "불필요"가 일부만 섞여 있으면(= 일부 회차는 필요 없다고 했는데 일부는 아직
 *    확인되지 않았다) "확인필요"로 남긴다. 자동으로 "무"로 단정하지 않는다.
 * 4) 전부 "무"면 "무".
 * 5) 그 외(확인필요가 섞여 있거나 애매한 조합)는 "확인필요"로 기운다 — 실제로 안 된 것을
 *    자동으로 "완료"라고 덮는 것보다 확인 필요로 남기는 쪽이 안전하다.
 */
export function decideCourseResultReportStatus(roundValues: ResultReportStatus[]): ResultReportStatus {
  if (roundValues.includes("유")) return "유";
  if (roundValues.every(value => value === "불필요")) return "불필요";
  if (roundValues.includes("불필요")) return "확인필요";
  if (roundValues.every(value => value === "무")) return "무";
  return "확인필요";
}

/**
 * 과정 레벨에 이미 값이 있으면 보존(덮어쓰지 않음)하고, 없는 과정만 회차별 값으로 승격 계획을
 * 만든다. 회차별 hasResultReport는 항상 값이 있으므로(기본값 "확인필요") 링크 백필과 달리
 * "전부 비어있음" 분기는 없다.
 */
export function planResultReportStatusPromotion(operations: OperationSession[]): ResultReportStatusPromotionPlan {
  const courses = new Map<string, OperationSession[]>();
  for (const operation of operations) {
    if (!operation.courseRecordId) continue;
    const group = courses.get(operation.courseRecordId) ?? [];
    group.push(operation);
    courses.set(operation.courseRecordId, group);
  }

  const summary = emptySummary();
  const coursePlans: ResultReportStatusCoursePlan[] = [];

  for (const [courseRecordId, rounds] of courses) {
    const first = rounds[0];
    const existing = first.courseHasResultReport;

    if (existing) {
      summary.preserved++;
      coursePlans.push({ courseRecordId, companyName: first.companyName, courseName: first.courseName, decision: { kind: "preserved", value: existing } });
      continue;
    }

    const value = decideCourseResultReportStatus(rounds.map(round => round.hasResultReport));
    if (value === "유") summary.promotedYes++;
    else if (value === "무") summary.promotedNo++;
    else if (value === "불필요") summary.promotedNotRequired++;
    else summary.promotedNeedsReview++;

    coursePlans.push({ courseRecordId, companyName: first.companyName, courseName: first.courseName, decision: { kind: "promote", value } });
  }

  return { courseCount: courses.size, summary, courses: coursePlans };
}
