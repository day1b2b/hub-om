import { parseLooseDate, utcDate } from "./dateParse";

export interface WorkSchedule {
  date: Date;
  startTime: string;
  endTime: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6
};

export function cell(row: string[], index: number): string {
  return String(row[index] ?? "").trim();
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 10) return null;
  return digits.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3");
}

export function normalizeEmail(raw: string): string | null {
  return raw.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ?? null;
}

export function parseWorkSchedules(raw: unknown, fallbackYear: number): WorkSchedule[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];

  const schedules: WorkSchedule[] = [];
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*[-~]\s*(\d{1,2})(?::(\d{2}))?/);
  const startTime = timeMatch ? toTime(timeMatch[1], timeMatch[2]) : "09:00";
  const endTime = timeMatch ? toTime(timeMatch[3], timeMatch[4]) : "18:00";

  const explicitDates = Array.from(text.matchAll(/(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}|\d{1,2}[.\-/]\d{1,2})/g))
    .map((match) => parseScheduleDate(match[1], fallbackYear))
    .filter((date): date is Date => Boolean(date));

  for (const date of explicitDates) {
    schedules.push({ date, startTime, endTime });
  }

  return dedupeSchedules(schedules);
}

export function expandWeekdaySchedules(startDate: Date, endDate: Date, raw: unknown): WorkSchedule[] {
  const text = String(raw ?? "").trim();
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*[-~]\s*(\d{1,2})(?::(\d{2}))?/);
  const startTime = timeMatch ? toTime(timeMatch[1], timeMatch[2]) : "09:00";
  const endTime = timeMatch ? toTime(timeMatch[3], timeMatch[4]) : "18:00";
  const weekdays = new Set<number>();

  for (const [label, index] of Object.entries(WEEKDAY_INDEX)) {
    if (text.includes(label)) weekdays.add(index);
  }

  const schedules: WorkSchedule[] = [];
  const cursor = utcDate(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const end = utcDate(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  let safety = 0;

  while (cursor <= end && safety < 370) {
    if (weekdays.size === 0 || weekdays.has(cursor.getUTCDay())) {
      schedules.push({ date: new Date(cursor), startTime, endTime });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    safety++;
  }

  return schedules;
}

function parseScheduleDate(raw: string, fallbackYear: number): Date | null {
  if (/^\d{1,2}[.\-/]\d{1,2}$/.test(raw)) {
    const [month, day] = raw.split(/[.\-/]/).map(Number);
    return utcDate(fallbackYear, month - 1, day);
  }
  return parseLooseDate(raw);
}

function toTime(hour: string, minute?: string): string {
  return `${hour.padStart(2, "0")}:${(minute ?? "00").padStart(2, "0")}`;
}

function dedupeSchedules(schedules: WorkSchedule[]): WorkSchedule[] {
  const seen = new Set<string>();
  const result: WorkSchedule[] = [];

  for (const schedule of schedules) {
    const key = `${schedule.date.toISOString().slice(0, 10)}:${schedule.startTime}:${schedule.endTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(schedule);
  }

  return result;
}
