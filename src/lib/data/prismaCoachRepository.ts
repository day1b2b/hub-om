import {
  CoachEngagementStatus as PrismaCoachEngagementStatus,
  CoachStatus as PrismaCoachStatus
} from "@prisma/client";
import type {
  CoachDetail,
  CoachEngagementStatusValue,
  CoachEngagementView,
  CoachScheduleView,
  CoachStatusValue,
  CoachSummary,
  DateRange
} from "./coachTypes";
import type { CoachRepository } from "./coachRepository";
import { getPrismaClient } from "./prisma";

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
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
