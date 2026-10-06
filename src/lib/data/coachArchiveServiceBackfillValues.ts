export type ArchiveObject = Record<string, unknown>;
export function archiveObject(value: unknown): ArchiveObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ArchiveObject : null;
}
export function archiveNullableString(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`Invalid archive ${field}.`);
  return value;
}
export function archiveStringOrNull(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`Invalid archive ${field}.`);
  return value;
}
export function archiveRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`Invalid archive ${field}.`);
  return value;
}
export function archiveNullableDate(value: unknown, field: string): Date | null {
  const text = archiveNullableString(value, field);
  if (text === null) return null;
  const day = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid archive ${field}.`);
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error(`Invalid archive ${field}.`);
  return date;
}
export function archiveRequiredTimestamp(value: unknown, field: string): Date {
  const text = archiveRequiredString(value, field);
  // Legacy columns are PostgreSQL `timestamp without time zone`: keep the wall-clock
  // components and ignore a source offset exactly as the old `::timestamp` cast did.
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(text);
  if (!match) throw new Error(`Invalid archive ${field}.`);
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, "0").slice(0, 3))));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)
    || date.getUTCHours() !== Number(hour) || date.getUTCMinutes() !== Number(minute) || date.getUTCSeconds() !== Number(second)) {
    throw new Error(`Invalid archive ${field}.`);
  }
  return date;
}
export function archiveNullableTimestamp(value: unknown, field: string): Date | null {
  const text = archiveNullableString(value, field);
  if (text === null) return null;
  return archiveRequiredTimestamp(text, field);
}
export const sameArchiveValue = (left: unknown, right: unknown) => left instanceof Date && right instanceof Date
  ? left.getTime() === right.getTime() : left === right;

export function coachArchivePatch(row: ArchiveObject) {
  return {
    // Legacy SQL used ->> directly for access_token; an empty token stays empty.
    accessToken: archiveStringOrNull(row.access_token, "access_token"),
    statusNote: archiveNullableString(row.status_note, "status_note"),
    returnDate: archiveNullableDate(row.return_date, "return_date"),
    selfNote: archiveNullableString(row.self_note, "self_note"),
    portfolioUrl: archiveNullableString(row.portfolio_url, "portfolio_url"),
    availabilityDetail: archiveNullableString(row.availability_detail, "availability_detail"),
    managerNote: archiveNullableString(row.manager_note, "manager_note"),
    dxTag: archiveNullableString(row.dx_tag, "dx_tag"),
    deletedBy: archiveNullableString(row.deleted_by, "deleted_by"),
  };
}
