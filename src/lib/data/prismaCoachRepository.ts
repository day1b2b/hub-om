import {
  CoachEngagementStatus as PrismaCoachEngagementStatus,
  CoachEngagementStatus,
  CoachStatus as PrismaCoachStatus
} from "@prisma/client";
import type {
  CoachDetail,
  CoachEngagementStatusValue,
  CoachEngagementView,
  CoachScheduleDashboard,
  CoachScheduleDashboardCoach,
  CoachScheduleView,
  CoachStatusValue,
  CoachSummary,
  DateRange
} from "./coachTypes";
import type { CoachRepository } from "./coachRepository";
import { getPrismaClient } from "./prisma";
import {
  clearOverlappingPeriods,
  hasAvailability,
  subtractBitmap,
  toBitmap,
  toIntervals,
  type TimeInterval
} from "./scheduleBitmap";

const COACH_STATUS: Record<PrismaCoachStatus, CoachStatusValue> = {
  PENDING: "pending",
  ACTIVE: "active",
  INACTIVE: "inactive"
};

const COACH_ENGAGEMENT_STATUS: Record<PrismaCoachEngagementStatus, CoachEngagementStatusValue> = {
  SCHEDULED: "scheduled",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled"
};

export class PrismaCoachRepository implements CoachRepository {
  async listCoaches(): Promise<CoachSummary[]> {
    const prisma = getPrismaClient();
    // 공개 필드만 select. 민감 컬럼(employeeId/phone/email/birthDate/affiliation 등)은 선택하지 않는다.
    const coaches = await prisma.coach.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        workType: true,
        status: true,
        isActive: true
      },
      orderBy: [{ displayOrder: "asc" }, { normalizedName: "asc" }]
    });

    return coaches.map((coach) => ({
      id: coach.id,
      name: coach.name,
      workType: coach.workType,
      status: COACH_STATUS[coach.status],
      isActive: coach.isActive
    }));
  }

  async getCoachById(id: string): Promise<CoachDetail | null> {
    const prisma = getPrismaClient();
    // 공개 필드 + 분야/커리큘럼 이름만 select. 민감 컬럼은 선택하지 않는다.
    const coach = await prisma.coach.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        workType: true,
        status: true,
        isActive: true,
        fields: {
          select: { tag: { select: { name: true } } }
        },
        curriculums: {
          select: { tag: { select: { name: true } } }
        }
      }
    });

    if (!coach) {
      return null;
    }

    return {
      id: coach.id,
      name: coach.name,
      workType: coach.workType,
      status: COACH_STATUS[coach.status],
      isActive: coach.isActive,
      fields: coach.fields.map((field) => field.tag.name),
      curriculums: coach.curriculums.map((curriculum) => curriculum.tag.name)
    };
  }

  async listEngagements(coachId: string): Promise<CoachEngagementView[]> {
    const prisma = getPrismaClient();
    // feedback/hiredByText(민감)는 select하지 않는다.
    const engagements = await prisma.coachEngagement.findMany({
      where: { coachId },
      select: {
        id: true,
        courseName: true,
        operationSessionId: true,
        status: true,
        source: true,
        startDate: true,
        endDate: true,
        startTime: true,
        endTime: true,
        rating: true,
        rehire: true
      },
      orderBy: [{ startDate: "desc" }, { id: "asc" }]
    });

    return engagements.map((engagement) => ({
      id: engagement.id,
      courseName: engagement.courseName,
      operationSessionId: engagement.operationSessionId,
      status: COACH_ENGAGEMENT_STATUS[engagement.status],
      source: engagement.source.toLowerCase(),
      startDate: toDateString(engagement.startDate),
      endDate: toDateString(engagement.endDate),
      startTime: engagement.startTime,
      endTime: engagement.endTime,
      rating: engagement.rating,
      rehire: engagement.rehire
    }));
  }

  async listSchedules(coachId: string, range: DateRange): Promise<CoachScheduleView[]> {
    const prisma = getPrismaClient();
    const schedules = await prisma.coachSchedule.findMany({
      where: {
        coachId,
        date: {
          gte: parseDate(range.from),
          lte: parseDate(range.to)
        }
      },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }]
    });

    return schedules.map((schedule) => ({
      id: schedule.id,
      date: toDateString(schedule.date),
      startTime: schedule.startTime,
      endTime: schedule.endTime
    }));
  }

  async getScheduleDashboard(yearMonth: string): Promise<CoachScheduleDashboard> {
    const prisma = getPrismaClient();
    const [startDate, endDate] = monthRange(yearMonth);

    const [coaches, availabilityRows, busyRows] = await Promise.all([
      prisma.coach.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          status: PrismaCoachStatus.ACTIVE
        },
        select: {
          id: true,
          name: true,
          workType: true,
          fields: {
            select: {
              tag: {
                select: { name: true }
              }
            }
          },
          engagements: {
            orderBy: { endDate: "desc" },
            take: 2,
            select: {
              courseName: true,
              endDate: true
            }
          },
          _count: {
            select: { engagements: true }
          }
        },
        orderBy: [{ displayOrder: "asc" }, { normalizedName: "asc" }]
      }),
      prisma.coachSchedule.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate
          },
          coach: {
            deletedAt: null,
            isActive: true,
            status: PrismaCoachStatus.ACTIVE
          }
        },
        select: {
          coachId: true,
          date: true,
          startTime: true,
          endTime: true
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }]
      }),
      prisma.coachEngagementSchedule.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate
          },
          cancelledAt: null,
          engagement: {
            status: {
              in: [
                CoachEngagementStatus.SCHEDULED,
                CoachEngagementStatus.IN_PROGRESS,
                CoachEngagementStatus.COMPLETED
              ]
            }
          }
        },
        select: {
          coachId: true,
          date: true,
          startTime: true,
          endTime: true
        }
      })
    ]);

    const coachInfo = new Map(
      coaches.map((coach) => [
        coach.id,
        {
          id: coach.id,
          name: coach.name,
          workType: coach.workType,
          fields: coach.fields.map((field) => field.tag.name),
          avgRating: null,
          recentEngagements: coach.engagements.map((engagement) => ({
            courseName: engagement.courseName,
            endDate: toDateString(engagement.endDate)
          })),
          engagementCount: coach._count.engagements
        } satisfies Omit<CoachScheduleDashboardCoach, "schedules">
      ])
    );

    const availabilityByDayCoach = groupIntervalsByDayAndCoach(availabilityRows);
    const busyByDayCoach = groupIntervalsByDayAndCoach(busyRows);
    const days: CoachScheduleDashboard["days"] = {};

    for (const [date, coachIntervals] of availabilityByDayCoach) {
      const coachesForDay: CoachScheduleDashboardCoach[] = [];
      for (const [coachId, intervals] of coachIntervals) {
        const info = coachInfo.get(coachId);
        if (!info) continue;

        const availableBitmap = toBitmap(intervals);
        const busyBitmap = toBitmap(busyByDayCoach.get(date)?.get(coachId) ?? []);
        const remaining = clearOverlappingPeriods(subtractBitmap(availableBitmap, busyBitmap), busyBitmap);
        if (!hasAvailability(remaining)) continue;

        coachesForDay.push({
          ...info,
          schedules: toIntervals(remaining)
        });
      }

      days[date] = {
        date,
        coaches: coachesForDay.sort(compareScheduleCoaches)
      };
    }

    return {
      yearMonth,
      totalActiveCoaches: coaches.length,
      days
    };
  }
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function monthRange(yearMonth: string): [Date, Date] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    throw new Error(`Invalid yearMonth: ${yearMonth}`);
  }

  const [year, month] = yearMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return [start, end];
}

function groupIntervalsByDayAndCoach(
  rows: Array<{ coachId: string; date: Date; startTime: string; endTime: string }>
): Map<string, Map<string, TimeInterval[]>> {
  const grouped = new Map<string, Map<string, TimeInterval[]>>();

  for (const row of rows) {
    const date = toDateString(row.date);
    if (!grouped.has(date)) grouped.set(date, new Map());
    const coachMap = grouped.get(date)!;
    if (!coachMap.has(row.coachId)) coachMap.set(row.coachId, []);
    coachMap.get(row.coachId)!.push({ startTime: row.startTime, endTime: row.endTime });
  }

  return grouped;
}

function compareScheduleCoaches(a: CoachScheduleDashboardCoach, b: CoachScheduleDashboardCoach): number {
  if (a.fields.length !== b.fields.length) return b.fields.length - a.fields.length;
  return a.name.localeCompare(b.name, "ko");
}
