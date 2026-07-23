import {
  CoachEngagementStatus as PrismaCoachEngagementStatus,
  CoachEngagementStatus,
  CoachStatus as PrismaCoachStatus
} from "@prisma/client";
import type {
  CoachDayReservationView,
  CoachDetail,
  CoachEngagementScheduleView,
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
import { buildSkillfloCoachUrl } from "@/lib/coaches/skillfloCoachUrl";

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
        statusNote: true,
        returnDate: true,
        availabilityDetail: true,
        dxTag: true,
        isActive: true,
        deletedAt: true,
        fields: {
          select: { tag: { select: { name: true } } }
        },
        engagements: {
          select: { rating: true }
        },
        engagementSchedules: {
          where: { cancelledAt: null },
          select: { date: true }
        }
      },
      orderBy: [{ displayOrder: "asc" }, { normalizedName: "asc" }]
    });

    return coaches.map((coach) => {
      const ratings = coach.engagements
        .map((engagement) => engagement.rating)
        .filter((rating): rating is number => typeof rating === "number");
      const workDates = new Set(coach.engagementSchedules.map((schedule) => toDateString(schedule.date)));

      return {
        id: coach.id,
        name: coach.name,
        workType: coach.workType,
        status: COACH_STATUS[coach.status],
        isActive: coach.isActive,
        deletedAt: coach.deletedAt ? coach.deletedAt.toISOString() : null,
        fields: coach.fields.map((field) => field.tag.name),
        avgRating: ratings.length > 0 ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null,
        workDayCount: workDates.size
      };
    });
  }

  async getCoachById(id: string): Promise<CoachDetail | null> {
    const prisma = getPrismaClient();
    // 공개 필드 + 분야/커리큘럼 이름만 select. 민감 컬럼은 선택하지 않는다.
    const coach = await prisma.coach.findFirst({
      where: { id },
      select: {
        id: true,
        sourceCoachId: true,
        accessToken: true,
        name: true,
        workType: true,
        status: true,
        statusNote: true,
        returnDate: true,
        availabilityDetail: true,
        dxTag: true,
        isActive: true,
        deletedAt: true,
        fields: {
          select: { tag: { select: { name: true } } }
        },
        curriculums: {
          select: { tag: { select: { name: true } } }
        },
        engagements: {
          select: { rating: true }
        },
        engagementSchedules: {
          where: { cancelledAt: null },
          select: { date: true }
        }
      }
    });

    if (!coach) {
      return null;
    }

    const archivedDetail = await loadArchivedCoachPublicDetail(coach.sourceCoachId);
    const ratings = coach.engagements
      .map((engagement) => engagement.rating)
      .filter((rating): rating is number => typeof rating === "number");
    const workDates = new Set(coach.engagementSchedules.map((schedule) => toDateString(schedule.date)));

    return {
      id: coach.id,
      name: coach.name,
      workType: coach.workType,
      status: COACH_STATUS[coach.status],
      isActive: coach.isActive,
      deletedAt: coach.deletedAt ? coach.deletedAt.toISOString() : null,
      fields: coach.fields.map((field) => field.tag.name),
      avgRating: ratings.length > 0 ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null,
      workDayCount: workDates.size,
      curriculums: coach.curriculums.map((curriculum) => curriculum.tag.name),
      coachInputUrl: buildSkillfloCoachUrl(coach.accessToken),
      statusNote: coach.statusNote ?? archivedDetail?.statusNote ?? null,
      returnDate: coach.returnDate ? toDateString(coach.returnDate) : archivedDetail?.returnDate ?? null,
      availabilityDetail: coach.availabilityDetail ?? archivedDetail?.availabilityDetail ?? null,
      dxTag: coach.dxTag ?? archivedDetail?.dxTag ?? null
    };
  }

  async listEngagements(coachId: string): Promise<CoachEngagementView[]> {
    const prisma = getPrismaClient();
    // hiredByText(섭외 관련, 민감)는 select하지 않는다. feedback(평가 한줄평)은 공개 조회로 취급한다.
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
        rehire: true,
        feedback: true
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
      rehire: engagement.rehire,
      feedback: engagement.feedback
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

  async listEngagementSchedules(coachId: string, range: DateRange): Promise<CoachEngagementScheduleView[]> {
    const prisma = getPrismaClient();
    const schedules = await prisma.coachEngagementSchedule.findMany({
      where: {
        coachId,
        cancelledAt: null,
        date: {
          gte: parseDate(range.from),
          lte: parseDate(range.to)
        }
      },
      select: {
        id: true,
        engagementId: true,
        date: true,
        startTime: true,
        endTime: true,
        engagement: {
          select: {
            courseName: true
          }
        }
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }]
    });

    return schedules.map((schedule) => ({
      id: schedule.id,
      engagementId: schedule.engagementId,
      courseName: schedule.engagement.courseName,
      date: toDateString(schedule.date),
      startTime: schedule.startTime,
      endTime: schedule.endTime
    }));
  }

  async getScheduleDashboard(yearMonth: string): Promise<CoachScheduleDashboard> {
    const prisma = getPrismaClient();
    const [startDate, endDate] = monthRange(yearMonth);

    const [coaches, availabilityRows, busyRows, reservationRows] = await Promise.all([
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
      }),
      prisma.coachDayReservation.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate
          },
          cancelledAt: null
        },
        select: {
          coachId: true,
          date: true,
          reservedByName: true,
          reservedByEmail: true
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
        } satisfies Omit<CoachScheduleDashboardCoach, "schedules" | "reservation">
      ])
    );

    const reservationByDayCoach = new Map<string, CoachDayReservationView>();
    for (const row of reservationRows) {
      reservationByDayCoach.set(`${row.coachId}|${toDateString(row.date)}`, {
        reservedByName: row.reservedByName,
        reservedByEmail: row.reservedByEmail
      });
    }

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
          schedules: toIntervals(remaining),
          reservation: reservationByDayCoach.get(`${coachId}|${date}`) ?? null
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

interface ArchivedCoachPublicDetail {
  statusNote: string | null;
  returnDate: string | null;
  availabilityDetail: string | null;
  dxTag: string | null;
}

async function loadArchivedCoachPublicDetail(sourceCoachId: string): Promise<ArchivedCoachPublicDetail | null> {
  const prisma = getPrismaClient();
  let rows: Array<{ row_data: Record<string, unknown> | null }>;

  try {
    rows = await prisma.$queryRaw<Array<{ row_data: Record<string, unknown> | null }>>`
      SELECT ar.row_data
      FROM coachdb_archive_rows ar
      JOIN coachdb_archive_snapshots s ON s.id = ar.snapshot_id
      WHERE s.status = 'completed'
        AND ar.table_schema = 'public'
        AND ar.table_name = 'coaches'
        AND ar.row_key = ${sourceCoachId}
      ORDER BY s.started_at DESC
      LIMIT 1
    `;
  } catch (error) {
    // coachdb_archive_rows/snapshots는 scripts/archive-coach-db.ts로만 생성되는 테이블이라
    // (원본 coach-db에 접근 못 하는) 로컬 개발 DB에는 아예 없을 수 있다. 그 경우는 없는 걸로
    // 취급하고, 그 외 예상 못 한 에러는 그대로 올린다.
    if (error instanceof Error && error.message.includes("42P01")) return null;
    throw error;
  }

  const row = rows[0]?.row_data;
  if (!row) return null;

  return {
    statusNote: stringOrNull(row.status_note),
    returnDate: dateStringOrNull(row.return_date),
    availabilityDetail: stringOrNull(row.availability_detail),
    dxTag: stringOrNull(row.dx_tag)
  };
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function dateStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
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
  if (a.engagementCount !== b.engagementCount) return b.engagementCount - a.engagementCount;
  return a.name.localeCompare(b.name, "ko");
}
