import { CoachEngagementStatus, type Prisma } from "@prisma/client";
import { parseDates, parseMonthRange, parseScheduleDate, parseSchedules } from "../coaches/coachScheduleValidation";
import type { CoachDateReservation, CoachManagerMonthSchedules, CoachMonthSchedules, CoachScheduleEntry, CoachScheduleRepository } from "./coachScheduleRepository";
import { getPrismaClient } from "./prisma";
import { lockPrismaCoach } from "./prismaCoachLock";

function monthRange(yearMonth: string) {
  const range = parseMonthRange(yearMonth);
  if (!range) throw new Error("월 형식이 올바르지 않습니다.");
  return range;
}
function datesInput(dates: string[]) {
  const result = parseDates(dates);
  if (!result) throw new Error("날짜 값이 올바르지 않습니다.");
  return result;
}
function toDbDate(value: string): Date {
  const date = parseScheduleDate(value);
  if (!date) throw new Error("날짜 값이 올바르지 않습니다.");
  return date;
}
function day(value: Date) { return value.toISOString().slice(0, 10); }
function scheduleDto(row: { id: string; date: Date; startTime: string; endTime: string }) {
  return { id: row.id, date: day(row.date), startTime: row.startTime, endTime: row.endTime };
}
function engagementScheduleDto(row: { date: Date; startTime: string; endTime: string; engagement: { courseName: string; status: string } }) {
  return { date: day(row.date), startTime: row.startTime, endTime: row.endTime, courseName: row.engagement.courseName, status: row.engagement.status.toLowerCase() };
}
function schedulesQuery(coachId: string, range: { start: Date; end: Date }) {
  return {
    where: { coachId, date: { gte: range.start, lte: range.end } },
    select: { id: true, date: true, startTime: true, endTime: true },
    orderBy: [{ date: "asc" }, { startTime: "asc" }]
  } satisfies Prisma.CoachScheduleFindManyArgs;
}
function engagementSchedulesQuery(coachId: string, range: { start: Date; end: Date }) {
  return {
    where: {
      coachId, cancelledAt: null, date: { gte: range.start, lte: range.end },
      engagement: { status: { in: [CoachEngagementStatus.SCHEDULED, CoachEngagementStatus.IN_PROGRESS, CoachEngagementStatus.COMPLETED] } }
    },
    select: { date: true, startTime: true, endTime: true, engagement: { select: { courseName: true, status: true } } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }]
  } satisfies Prisma.CoachEngagementScheduleFindManyArgs;
}
export class PrismaCoachScheduleRepository implements CoachScheduleRepository {
  async getCoachMonth(coachId: string, yearMonth: string): Promise<CoachMonthSchedules> {
    const range = monthRange(yearMonth);
    return getPrismaClient().$transaction(async tx => {
      await lockPrismaCoach(tx, coachId);
      const [schedules, engagements, engagementSchedules, lastSaved, fallbackLastSaved] = await Promise.all([
        tx.coachSchedule.findMany(schedulesQuery(coachId, range)),
        tx.coachEngagement.findMany({
          where: { coachId, endDate: { gte: range.start }, startDate: { lte: range.end } },
          select: { id: true, courseName: true, startDate: true, endDate: true, startTime: true, endTime: true, status: true },
          orderBy: [{ startDate: "asc" }, { courseName: "asc" }]
        }),
        tx.coachEngagementSchedule.findMany(engagementSchedulesQuery(coachId, range)),
        tx.coachScheduleAccessLog.findUnique({ where: { coachId_yearMonth: { coachId, yearMonth } }, select: { lastEditedAt: true } }),
        tx.coachSchedule.aggregate({ where: { coachId, date: { gte: range.start, lte: range.end } }, _max: { updatedAt: true } })
      ]);
      const now = new Date();
      await tx.coachScheduleAccessLog.upsert({
        where: { coachId_yearMonth: { coachId, yearMonth } },
        create: { coachId, yearMonth, accessedAt: now }, update: { accessedAt: now }
      });
      return {
        schedules: schedules.map(scheduleDto),
        engagements: engagements.map(row => ({ id: row.id, courseName: row.courseName, startDate: day(row.startDate), endDate: day(row.endDate), startTime: row.startTime, endTime: row.endTime, status: row.status.toLowerCase() })),
        engagementSchedules: engagementSchedules.map(engagementScheduleDto),
        lastSavedAt: lastSaved?.lastEditedAt?.toISOString() ?? fallbackLastSaved._max.updatedAt?.toISOString() ?? null
      };
    });
  }

  async replaceCoachMonth(coachId: string, yearMonth: string, entries: CoachScheduleEntry[]): Promise<void> {
    const range = monthRange(yearMonth);
    const schedules = parseSchedules(entries, yearMonth);
    if (!schedules.ok) throw new Error(schedules.error);
    await getPrismaClient().$transaction(async tx => {
      await lockPrismaCoach(tx, coachId);
      const now = new Date();
      await tx.coachSchedule.deleteMany({ where: { coachId, date: { gte: range.start, lte: range.end } } });
      if (schedules.value.length > 0) {
        await tx.coachSchedule.createMany({ data: schedules.value.map((schedule, index) => ({
          sourceScheduleId: `hub:${coachId}:${yearMonth}:${index}:${schedule.date}:${schedule.startTime}:${schedule.endTime}`,
          coachId, date: toDbDate(schedule.date), startTime: schedule.startTime, endTime: schedule.endTime
        })) });
      }
      await tx.coachScheduleAccessLog.upsert({
        where: { coachId_yearMonth: { coachId, yearMonth } },
        create: { coachId, yearMonth, accessedAt: now, lastEditedAt: now }, update: { lastEditedAt: now }
      });
    });
  }

  async getManagerMonth(coachId: string, yearMonth: string): Promise<CoachManagerMonthSchedules | null> {
    const range = monthRange(yearMonth);
    const prisma = getPrismaClient();
    const coach = await prisma.coach.findFirst({ where: { id: coachId, deletedAt: null }, select: { id: true } });
    if (!coach) return null;
    const [schedules, engagementSchedules, accessLog] = await Promise.all([
      prisma.coachSchedule.findMany(schedulesQuery(coachId, range)),
      prisma.coachEngagementSchedule.findMany(engagementSchedulesQuery(coachId, range)),
      prisma.coachScheduleAccessLog.findUnique({ where: { coachId_yearMonth: { coachId, yearMonth } }, select: { accessedAt: true, lastEditedAt: true, yearMonth: true } })
    ]);
    return {
      schedules: schedules.map(scheduleDto), engagementSchedules: engagementSchedules.map(engagementScheduleDto),
      accessLog: accessLog ? { yearMonth: accessLog.yearMonth, accessedAt: accessLog.accessedAt.toISOString(), lastEditedAt: accessLog.lastEditedAt?.toISOString() ?? null } : null
    };
  }

  async reserveDates(coachId: string, dates: string[], author: { name: string; email: string }): Promise<CoachDateReservation[] | null> {
    const validDates = datesInput(dates);
    return getPrismaClient().$transaction(async tx => {
      await lockPrismaCoach(tx, coachId);
      const coach = await tx.coach.findUnique({ where: { id: coachId }, select: { id: true, deletedAt: true } });
      if (!coach || coach.deletedAt) return null;
      const existingRows = await tx.coachDayReservation.findMany({
        where: { coachId, date: { in: validDates.map(toDbDate) }, cancelledAt: null },
        select: { date: true, reservedByName: true, reservedByEmail: true }
      });
      const existingByDate = new Map(existingRows.map(row => [day(row.date), row]));
      const missing = validDates.filter(date => !existingByDate.has(date));
      if (missing.length > 0) await tx.coachDayReservation.createMany({ data: missing.map(date => ({ coachId, date: toDbDate(date), reservedByName: author.name, reservedByEmail: author.email })) });
      return validDates.map(date => {
        const existing = existingByDate.get(date);
        return { date, reservedByName: existing?.reservedByName ?? author.name, reservedByEmail: existing?.reservedByEmail ?? author.email };
      });
    });
  }

  async cancelDates(coachId: string, dates: string[], email: string): Promise<string[]> {
    const validDates = datesInput(dates);
    return getPrismaClient().$transaction(async tx => {
      await lockPrismaCoach(tx, coachId);
      const ownRows = await tx.coachDayReservation.findMany({
        where: { coachId, date: { in: validDates.map(toDbDate) }, cancelledAt: null, reservedByEmail: email },
        select: { id: true, date: true }
      });
      if (ownRows.length > 0) await tx.coachDayReservation.updateMany({ where: { id: { in: ownRows.map(row => row.id) } }, data: { cancelledAt: new Date() } });
      return ownRows.map(row => day(row.date));
    });
  }
}
