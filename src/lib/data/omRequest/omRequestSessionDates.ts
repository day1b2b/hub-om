import { enumerateDateRange, formatEducationDatesList, parseEducationDatesText } from "../operationCalculations";
import type { OmRequestSession } from "./omRequestTypes";

/**
 * 세션에 저장된 값에서 달력에 미리 체크해 보여줄(또는 읽기 전용 화면에 표시할) 날짜 목록을 만든다.
 * 아직 educationDatesText가 없는(과거 방식으로 채워졌거나 빈) 세션은 date~dateEnd 전체를 교육일로 본다.
 */
export function sessionDatesOf(session: OmRequestSession): string[] {
  if (session.educationDatesText?.trim()) return parseEducationDatesText(session.educationDatesText).dates;
  if (!session.date) return [];
  return enumerateDateRange(session.date, session.dateEnd || session.date);
}

export function summarizeSessionDates(session: OmRequestSession): string {
  const dates = sessionDatesOf(session);
  if (dates.length === 0) return "날짜 선택";
  return `${formatEducationDatesList(dates)} (${dates.length}일)`;
}
