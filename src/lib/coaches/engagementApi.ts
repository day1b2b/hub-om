import { randomUUID } from "node:crypto";
import { CoachEngagementSource, CoachEngagementStatus, type Prisma } from "@prisma/client";
import { cancelReservationsForConfirmedSchedules } from "./reservationAutoCancel";

export function parseEngagementStatus(value: unknown): CoachEngagementStatus {
  if (value === "scheduled") return CoachEngagementStatus.SCHEDULED;
  if (value === "in_progress") return CoachEngagementStatus.IN_PROGRESS;
  if (value === "completed") return CoachEngagementStatus.COMPLETED;
  if (value === "cancelled") return CoachEngagementStatus.CANCELLED;
  return CoachEngagementStatus.SCHEDULED;
}

export function parseOptionalEngagementStatus(value: unknown): CoachEngagementStatus | undefined {
  if (value === undefined) return undefined;
  return parseEngagementStatus(value);
}

export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseRating(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) return undefined;
  return value;
}

export async function regenerateWeekdaySchedules(
  tx: Prisma.TransactionClient,
  engagementId: string,
  coachId: string,
  startDate: Date,
  endDate: Date,
  startTime: string | null,
  endTime: string | null
) {
  await tx.coachEngagementSchedule.deleteMany({ where: { engagementId } });

  const rows: Array<{
    sourceEngagementScheduleId: string;
    engagementId: string;
    coachId: string;
    date: Date;
    startTime: string;
    endTime: string;
  }> = [];

  const cursor = new Date(startDate);
  let safety = 0;
  while (cursor <= endDate && safety < 366) {
    const day = cursor.getUTCDay();
    if (day >= 1 && day <= 5) {
      rows.push({
        sourceEngagementScheduleId: `hub:${engagementId}:${cursor.toISOString().slice(0, 10)}`,
        engagementId,
        coachId,
        date: new Date(cursor),
        startTime: startTime || "09:00",
        endTime: endTime || "18:00"
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    safety += 1;
  }

  if (rows.length > 0) {
    await tx.coachEngagementSchedule.createMany({ data: rows });
    await cancelReservationsForConfirmedSchedules(tx, rows.map((row) => ({ coachId: row.coachId, date: row.date, engagementId })));
  }
}

export function manualSourceId(): string {
  return `hub:${randomUUID()}`;
}

export const MANUAL_ENGAGEMENT_SOURCE = CoachEngagementSource.MANUAL;
