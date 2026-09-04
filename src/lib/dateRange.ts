/** "YYYY-MM-DD" 두 값으로 표현한 기간. 빈 문자열은 "제한 없음"이다. */
export interface DateRange {
  start: string;
  end: string;
}

/** Date → "YYYY-MM-DD" (로컬 기준). toISOString은 UTC로 밀려 하루 어긋난다. */
export function formatDateValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "YYYY-MM-DD" → Date. 못 읽으면 null. */
export function parseDateValue(value: null | string | undefined): Date | null {
  const text = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** offset 0 = 이번 달, 1 = 다음 달. 말일은 다음 달 0일로 구한다. */
export function getMonthRange(date: Date, offset: number): DateRange {
  const start = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const end = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0);
  return { start: formatDateValue(start), end: formatDateValue(end) };
}

export function getQuarterRange(date: Date): DateRange {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  const start = new Date(date.getFullYear(), quarterStartMonth, 1);
  const end = new Date(date.getFullYear(), quarterStartMonth + 3, 0);
  return { start: formatDateValue(start), end: formatDateValue(end) };
}

export function getYearRange(date: Date): DateRange {
  return {
    start: formatDateValue(new Date(date.getFullYear(), 0, 1)),
    end: formatDateValue(new Date(date.getFullYear(), 11, 31))
  };
}

/** 제한 없는 기간(= 전체). */
export const ALL_RANGE: DateRange = { start: "", end: "" };

/**
 * 과정 기간이 선택한 기간과 겹치는가.
 *
 * 시작·종료 중 하나라도 못 읽으면 true다 — 일정이 아직 없는 과정을 기간 필터가
 * 숨겨 버리면 담당자가 그 과정을 통째로 놓친다. 운영 현황의 판정과 같은 규칙이다.
 */
export function overlapsDateRange(
  startText: null | string | undefined,
  endText: null | string | undefined,
  range: DateRange
): boolean {
  const rangeStart = parseDateValue(range.start);
  const rangeEnd = parseDateValue(range.end);
  const start = parseDateValue(startText);
  const end = parseDateValue(endText) ?? start;

  if (!rangeStart || !rangeEnd || !start || !end) return true;

  return start.getTime() <= rangeEnd.getTime() && rangeStart.getTime() <= end.getTime();
}
