/** OM은 있는데 진행상태가 배정필요로 남은 회차를 어떤 상태로 맞출지 정한다. DB와 무관한 순수 규칙. */
import { deriveArchiveStatus } from "./operationCalculations";
import { RESULT_REPORT_STATUS, SATISFACTION_SURVEY_STATUS, toDateString } from "./operationRowMapping";

export type OmStatusBackfillValue = "ASSIGNMENT_PLANNED" | "ARCHIVE_NEEDED" | "RETROSPECTIVE_DONE";
export interface OmStatusBackfillCounts { total: number; planned: number; archiveNeeded: number; retrospectiveDone: number }
export interface OmStatusBackfillInput {
  endDate: Date;
  courseId: string | null | undefined;
  lectureManagementNote: string | null | undefined;
  avgSatisfaction: string | null | undefined;
  hasSatisfactionSurvey: string;
  hasResultReport: string;
  resultReportLink: string | null | undefined;
}

/**
 * 진행상태는 시간이 지나도 저절로 바뀌지 않으므로, 이미 끝난 교육을 배정예정으로 올리면
 * "곧 시작할 교육"처럼 보인다. deriveOperationStatus와 같은 규칙으로 끝나지 않은 교육만
 * 배정예정으로, 끝난 교육은 화면의 아카이빙 판정(deriveArchiveStatus)에 맞춰 회고완료/아카이빙필요로 둔다.
 */
export function omStatusBackfillValue(input: OmStatusBackfillInput): OmStatusBackfillValue {
  const archive = deriveArchiveStatus(toDateString(input.endDate), {
    courseId: input.courseId ?? "",
    lectureManagementNote: input.lectureManagementNote ?? "",
    avgSatisfaction: input.avgSatisfaction ?? "",
    hasSatisfactionSurvey: SATISFACTION_SURVEY_STATUS[input.hasSatisfactionSurvey],
    hasResultReport: RESULT_REPORT_STATUS[input.hasResultReport],
    resultReportLink: input.resultReportLink ?? ""
  });
  if (archive === "아카이빙전") return "ASSIGNMENT_PLANNED";
  return archive === "완료" ? "RETROSPECTIVE_DONE" : "ARCHIVE_NEEDED";
}

export function countOmStatusBackfill(values: OmStatusBackfillValue[]): OmStatusBackfillCounts {
  return {
    total: values.length,
    planned: values.filter((value) => value === "ASSIGNMENT_PLANNED").length,
    archiveNeeded: values.filter((value) => value === "ARCHIVE_NEEDED").length,
    retrospectiveDone: values.filter((value) => value === "RETROSPECTIVE_DONE").length
  };
}
