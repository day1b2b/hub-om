import type { CoachScheduleEntry } from "../data/coachScheduleRepository";

/** Avoid Date.UTC's special handling of years 00–99 and reject calendar rollover. */
export function parseScheduleDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  return result.toISOString().slice(0, 10) === value ? result : null;
}

export function parseMonthRange(yearMonth: unknown): { start: Date; end: Date } | null {
  if (typeof yearMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) return null;
  const start = parseScheduleDate(`${yearMonth}-01`);
  if (!start) return null;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { start, end };
}

export function parseSchedules(value: unknown, yearMonth: string):
  | { ok: true; value: CoachScheduleEntry[] }
  | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "스케줄 형식이 올바르지 않습니다." };
  if (!parseMonthRange(yearMonth)) return { ok: false, error: "월 형식이 올바르지 않습니다." };
  const result: CoachScheduleEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.date !== "string" || typeof item.startTime !== "string" || typeof item.endTime !== "string") {
      return { ok: false, error: "스케줄 항목 형식이 올바르지 않습니다." };
    }
    if (!item.date.startsWith(`${yearMonth}-`) || !parseScheduleDate(item.date)) {
      return { ok: false, error: "선택한 월 밖의 날짜가 포함되어 있습니다." };
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.endTime) || item.startTime >= item.endTime) {
      return { ok: false, error: "시간 형식이 올바르지 않습니다." };
    }
    const key = `${item.date}|${item.startTime}|${item.endTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ date: item.date, startTime: item.startTime, endTime: item.endTime });
  }
  return { ok: true, value: result };
}

export function parseDates(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result: string[] = [];
  for (const date of value) {
    if (typeof date !== "string" || !parseScheduleDate(date)) return null;
    result.push(date);
  }
  return [...new Set(result)];
}
