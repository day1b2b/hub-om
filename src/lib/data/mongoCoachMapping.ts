import type { Coach, CoachEngagement, CoachEngagementSchedule } from "@prisma/client";
import type { CoachSummary, CoachStatusValue, CoachEngagementStatusValue } from "./coachTypes";
import { MongoOperationError } from "./mongoOperationStore";
export const coachStatus: Record<string, CoachStatusValue> = { PENDING: "pending", ACTIVE: "active", INACTIVE: "inactive" };
export const engagementStatus: Record<string, CoachEngagementStatusValue> = { SCHEDULED: "scheduled", IN_PROGRESS: "in_progress", COMPLETED: "completed", CANCELLED: "cancelled" };
export const coachDate = (value: Date) => value.toISOString().slice(0, 10);
export const coachRangeDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
export function coachMonthRange(value: string): [Date, Date] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new MongoOperationError("INVALID_COACH_MONTH");
  const [year, month] = value.split("-").map(Number);
  return [new Date(Date.UTC(year, month - 1, 1)), new Date(Date.UTC(year, month, 0))];
}
export function compareCoaches(a: Coach, b: Coach) {
  const order = a.displayOrder === null ? (b.displayOrder === null ? 0 : 1) : b.displayOrder === null ? -1 : a.displayOrder - b.displayOrder;
  return order || a.normalizedName.localeCompare(b.normalizedName, "ko");
}
export function compareEngagements(a: CoachEngagement, b: CoachEngagement) {
  return b.startDate.getTime() - a.startDate.getTime() || a.id.localeCompare(b.id);
}
export function coachSummary(coach: Coach, fields: string[], engagements: CoachEngagement[], schedules: CoachEngagementSchedule[]): CoachSummary {
  const ratings = engagements.map(row => row.rating).filter((value): value is number => typeof value === "number");
  return { id: coach.id, name: coach.name, workType: coach.workType, status: coachStatus[coach.status],
    isActive: coach.isActive, deletedAt: coach.deletedAt?.toISOString() ?? null, fields,
    avgRating: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null,
    workDayCount: new Set(schedules.filter(row => row.cancelledAt === null).map(row => coachDate(row.date))).size,
    notionPageId: coach.notionPageId };
}
/** Keep database/driver/cipher errors out of public messages; never turn corruption into empty results. */
export async function coachRead<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_READ_FAILED"); }
}
