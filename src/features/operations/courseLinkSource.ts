import type { OperationSession } from "@/lib/data/operationTypes";

export type CourseLinkField = "driveLink" | "operationDetail";

/**
 * 드라이브·싱크업 링크는 과정 단위로 쓴다(결과보고서·강의관리와 같다). 저장은 아직 회차마다 되어 있어서,
 * 운영 현황 목록과 같은 기준으로 과정의 회차 중 값이 있는 첫 회차 값을 과정 값으로 본다 — 어느 회차
 * 상세를 열어도 같은 값이 보인다. 고칠 때는 과정의 모든 회차에 같은 값을 저장한다(EditableResourceRow).
 */
export function courseLinkValue(courseOperations: OperationSession[], field: CourseLinkField): string {
  return courseOperations.find((candidate) => candidate[field].trim())?.[field] ?? "";
}
