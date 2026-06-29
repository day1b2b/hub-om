export function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
}

export function parseLooseDate(raw: unknown): Date | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const match = text.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (match) return utcDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 40000 && serial < 60000) {
    const date = new Date((serial - 25569) * 86400 * 1000);
    return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  return null;
}

export function expandDateRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const cursor = utcDate(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const end = utcDate(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  let safety = 0;

  while (cursor <= end && safety < 370) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    safety++;
  }

  return dates;
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseBirthDate(raw: unknown): Date | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const full = parseLooseDate(text);
  if (full) return full;

  const compact = text.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!compact) return null;

  const year = Number(compact[1]) > 50 ? 1900 + Number(compact[1]) : 2000 + Number(compact[1]);
  return utcDate(year, Number(compact[2]) - 1, Number(compact[3]));
}
