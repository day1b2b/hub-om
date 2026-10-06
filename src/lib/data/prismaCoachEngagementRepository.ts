import { CoachContentEntryKind, type Prisma } from "@prisma/client";
import { MANUAL_ENGAGEMENT_SOURCE, manualSourceId, weekdayScheduleEntries } from "../coaches/engagementApi";
import { cancelReservationsForConfirmedSchedules } from "../coaches/reservationAutoCancel";
import {
  toCoachEngagementListItem, toCoachEngagementRecord,
  type CoachEngagementAuthor, type CoachEngagementListItem, type CoachEngagementRecord, type CoachEngagementRepository,
  type CoachReviewCommand, type CoachReviewResult, type CreateCoachEngagementInput, type UpdateCoachEngagementInput
} from "./coachEngagementRepository";
import { getPrismaClient } from "./prisma";
import { lockPrismaCoach, lockPrismaCoachCatalog } from "./prismaCoachLock";

async function regenerateWeekdaySchedules(tx: Prisma.TransactionClient, row: { id: string; coachId: string; startDate: Date; endDate: Date; startTime: string | null; endTime: string | null }) {
  await tx.coachEngagementSchedule.deleteMany({ where: { engagementId: row.id } });
  const rows = weekdayScheduleEntries(row.startDate, row.endDate, row.startTime, row.endTime).map(schedule => ({
    ...schedule, sourceEngagementScheduleId: `hub:${row.id}:${schedule.date.toISOString().slice(0, 10)}`, engagementId: row.id, coachId: row.coachId
  }));
  if (rows.length > 0) {
    await tx.coachEngagementSchedule.createMany({ data: rows });
    await cancelReservationsForConfirmedSchedules(tx, rows.map(schedule => ({ coachId: row.coachId, date: schedule.date, engagementId: row.id })));
  }
}
async function lockedEngagement(tx: Prisma.TransactionClient, engagementId: string) {
  const identity = await tx.coachEngagement.findUnique({ where: { id: engagementId }, select: { coachId: true } });
  if (!identity) return null;
  await lockPrismaCoach(tx, identity.coachId);
  // Read mutable fields only after acquiring the same lock as schedule/reservation writers.
  const current = await tx.coachEngagement.findUnique({ where: { id: engagementId } });
  if (current && current.coachId !== identity.coachId) throw new Error("COACH_ENGAGEMENT_CHANGED");
  return current;
}
async function reviewHistory(tx: Prisma.TransactionClient, coachId: string, engagementId: string, content: string, author: CoachEngagementAuthor) {
  await tx.coachContentEntry.create({ data: {
    coachId, kind: CoachContentEntryKind.EDIT_HISTORY, content, authorEmail: author.email, authorName: author.name,
    sourceField: `coach_engagements.review:${engagementId}`
  } });
}

export class PrismaCoachEngagementRepository implements CoachEngagementRepository {
  async listForCoach(coachId: string): Promise<CoachEngagementListItem[] | null> {
    const prisma = getPrismaClient();
    const coach = await prisma.coach.findFirst({ where: { id: coachId, deletedAt: null }, select: { id: true } });
    if (!coach) return null;
    const rows = await prisma.coachEngagement.findMany({ where: { coachId }, orderBy: { startDate: "desc" } });
    return rows.map(toCoachEngagementListItem);
  }
  async createForCoach(coachId: string, input: CreateCoachEngagementInput): Promise<CoachEngagementRecord | null> {
    return getPrismaClient().$transaction(async tx => {
      await lockPrismaCoachCatalog(tx);
      await lockPrismaCoach(tx, coachId);
      const coach = await tx.coach.findFirst({ where: { id: coachId, deletedAt: null }, select: { id: true } });
      if (!coach) return null;
      const created = await tx.coachEngagement.create({ data: { ...input, sourceEngagementId: manualSourceId(), coachId, source: MANUAL_ENGAGEMENT_SOURCE } });
      // Preserve existing behavior even for cancelled records; changing that policy is a separate task.
      await regenerateWeekdaySchedules(tx, created);
      return toCoachEngagementRecord(created);
    });
  }
  async update(engagementId: string, input: UpdateCoachEngagementInput): Promise<CoachEngagementRecord | null> {
    return getPrismaClient().$transaction(async tx => {
      await lockPrismaCoachCatalog(tx);
      const existing = await lockedEngagement(tx, engagementId);
      if (!existing) return null;
      const { courseName, startDate, endDate, ...patch } = input;
      const updated = await tx.coachEngagement.update({ where: { id: engagementId }, data: {
        ...patch,
        ...(courseName !== undefined ? { courseName: courseName ?? existing.courseName } : {}),
        ...(startDate !== undefined ? { startDate: startDate ?? existing.startDate } : {}),
        ...(endDate !== undefined ? { endDate: endDate ?? existing.endDate } : {})
      } });
      if (input.startDate !== undefined || input.endDate !== undefined || input.startTime !== undefined || input.endTime !== undefined) await regenerateWeekdaySchedules(tx, updated);
      return toCoachEngagementRecord(updated);
    });
  }
  async updateReview(engagementId: string, command: CoachReviewCommand, author: CoachEngagementAuthor): Promise<CoachReviewResult> {
    return getPrismaClient().$transaction(async tx => {
      const existing = await lockedEngagement(tx, engagementId);
      if (!existing) throw new Error("COACH_ENGAGEMENT_NOT_FOUND");
      if (command.action === "toggleFlag") {
        const reviewFlaggedAt = existing.reviewFlaggedAt ? null : new Date();
        const updated = await tx.coachEngagement.update({ where: { id: engagementId }, data: { reviewFlaggedAt } });
        await reviewHistory(tx, existing.coachId, engagementId, reviewFlaggedAt ? "리뷰 경고 설정" : "리뷰 경고 해제", author);
        return toCoachEngagementRecord(updated);
      }
      if (command.action === "deleteReview") {
        const updated = await tx.coachEngagement.update({ where: { id: engagementId }, data: { rating: null, feedback: null } });
        await reviewHistory(tx, existing.coachId, engagementId, "리뷰 삭제", author);
        return toCoachEngagementRecord(updated);
      }
      const updated = await tx.coachEngagement.update({ where: { id: engagementId }, data: {
        ...(command.rating !== undefined ? { rating: command.rating } : {}),
        ...(command.feedback !== undefined ? { feedback: command.feedback } : {}),
        ...(command.rehire !== undefined ? { rehire: command.rehire } : {})
      }, select: { id: true, coachId: true, rating: true, feedback: true, rehire: true } });
      if (command.rating !== undefined || command.feedback !== undefined) await reviewHistory(tx, existing.coachId, engagementId, "리뷰 수정", author);
      return { id: updated.id, coachId: updated.coachId, rating: updated.rating, feedback: updated.feedback, rehire: updated.rehire };
    });
  }
}
