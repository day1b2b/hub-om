import { normalizeCourseId } from "./operationCalculations";
import type { OperationSession } from "./operationTypes";

/**
 * 코스ID 조회(`/api/sales/lookup?rounds=1`)가 함께 돌려주는 회차 한 줄.
 *
 * 결과보고서 빌더(edu-report)가 '교육 기간·시간·교육 형태·강사'를 매니저가 다시 치지 않도록
 * 미리 채우는 데 쓴다. 보고서에 들어가는 일정·형태·강사만 담는다 —
 * 매출·비용·담당자·링크·메모 같은 내부 값은 넣지 않는다.
 */
export interface CourseLookupRound {
  processId: string;
  company: string;
  courseName: string;
  roundNo: string;
  startDate: string;
  endDate: string;
  educationDates: string[];
  timeText: string;
  educationFormat: string;
  instructors: string;
}

/** 한 코스ID에 회차가 아주 많을 수 있어(상시 과정) 응답 크기를 자른다. 최근 회차부터 남긴다. */
export const MAX_LOOKUP_ROUNDS = 60;

/**
 * 운영현황 회차들 중 코스ID가 `courseId`와 같은 것만 골라 보고서용 필드로 줄인다.
 * 코스ID는 양쪽 다 정규화해서 비교한다(courseLookup.ts 와 같은 이유 — 제로폭 문자·`.0` 꼬리).
 * 정렬은 강의 시작일 오름차순, 같으면 회차 번호 순.
 */
export function selectLookupRounds(operations: OperationSession[], courseId: string): CourseLookupRound[] {
  const target = normalizeCourseId(courseId);
  if (!target) return [];

  const rounds = operations
    .filter((operation) => normalizeCourseId(operation.courseId) === target)
    .map((operation) => ({
      processId: operation.processId ?? "",
      company: operation.companyName,
      courseName: operation.courseName,
      roundNo: operation.roundNo,
      startDate: operation.startDate,
      endDate: operation.endDate,
      educationDates: [...(operation.educationDates ?? [])],
      timeText: operation.timeText,
      educationFormat: operation.educationFormat,
      instructors: operation.instructors
    }))
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        a.roundNo.localeCompare(b.roundNo, "ko", { numeric: true }) ||
        a.courseName.localeCompare(b.courseName)
    );

  return rounds.length > MAX_LOOKUP_ROUNDS ? rounds.slice(rounds.length - MAX_LOOKUP_ROUNDS) : rounds;
}
