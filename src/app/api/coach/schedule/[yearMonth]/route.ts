import { NextResponse } from "next/server";
import { CoachEngagementStatus } from "@prisma/client";
import { extractCoachToken, validateCoachToken } from "@/lib/coaches/coachTokenAuth";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    yearMonth: string;
  }>;
}

interface ScheduleInput {
  date: unknown;
  startTime: unknown;
  endTime: unknown;
}

export async function GET(request: Request, { params }: RouteContext) {
  const coach = await validateCoachToken(extractCoachToken(request));
  if (!coach) {
    return NextResponse.json({ ok: false, error: "코치 정보를 찾을 수 없습니다." }, { status: 401 });
  }

  const { yearMonth } = await params;
  const range = parseMonthRange(yearMonth);
  if (!range) {
    return NextResponse.json({ ok: false, error: "월 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const [schedules, engagements, engagementSchedules, lastSaved, fallbackLastSaved] = await Promise.all([
    prisma.coachSchedule.findMany({
      where: { coachId: coach.id, date: { gte: range.start, lte: range.end } },
      select: { id: true, date: true, startTime: true, endTime: true },
      orderBy: [{ date: "asc" }, { startTime: "asc" }]
    }),
    prisma.coachEngagement.findMany({
      where: {
        coachId: coach.id,
        endDate: { gte: range.start },
        startDate: { lte: range.end }
      },
      select: {
        id: true,
        courseName: true,
        startDate: true,
        endDate: true,
        startTime: true,
        endTime: true,
        status: true
      },
      orderBy: [{ startDate: "asc" }, { courseName: "asc" }]
    }),
    prisma.coachEngagementSchedule.findMany({
      where: {
        coachId: coach.id,
        cancelledAt: null,
        date: { gte: range.start, lte: range.end },
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
        date: true,
        startTime: true,
        endTime: true,
        engagement: { select: { courseName: true, status: true } }
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }]
    }),
    prisma.coachScheduleAccessLog.findUnique({
      where: {
        coachId_yearMonth: {
          coachId: coach.id,
          yearMonth
        }
      },
      select: { lastEditedAt: true }
    }),
    prisma.coachSchedule.aggregate({
      where: { coachId: coach.id, date: { gte: range.start, lte: range.end } },
      _max: { updatedAt: true }
    })
  ]);

  await prisma.coachScheduleAccessLog.upsert({
    where: {
      coachId_yearMonth: {
        coachId: coach.id,
        yearMonth
      }
    },
    create: {
      coachId: coach.id,
      yearMonth,
      accessedAt: new Date()
    },
    update: {
      accessedAt: new Date()
    }
  });

  return NextResponse.json({
    ok: true,
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      date: toDateString(schedule.date),
      startTime: schedule.startTime,
      endTime: schedule.endTime
    })),
    engagements: engagements.map((engagement) => ({
      id: engagement.id,
      courseName: engagement.courseName,
      startDate: toDateString(engagement.startDate),
      endDate: toDateString(engagement.endDate),
      startTime: engagement.startTime,
      endTime: engagement.endTime,
      status: engagement.status.toLowerCase()
    })),
    engagementSchedules: engagementSchedules.map((schedule) => ({
      date: toDateString(schedule.date),
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      courseName: schedule.engagement.courseName,
      status: schedule.engagement.status.toLowerCase()
    })),
    lastSavedAt: lastSaved?.lastEditedAt?.toISOString() ?? fallbackLastSaved._max.updatedAt?.toISOString() ?? null
  });
}

export async function PUT(request: Request, { params }: RouteContext) {
  const coach = await validateCoachToken(extractCoachToken(request));
  if (!coach) {
    return NextResponse.json({ ok: false, error: "코치 정보를 찾을 수 없습니다." }, { status: 401 });
  }

  const { yearMonth } = await params;
  const range = parseMonthRange(yearMonth);
  if (!range) {
    return NextResponse.json({ ok: false, error: "월 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { schedules?: unknown };
  const schedules = parseSchedules(body.schedules, yearMonth);
  if (!schedules.ok) {
    return NextResponse.json({ ok: false, error: schedules.error }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.coachSchedule.deleteMany({
      where: { coachId: coach.id, date: { gte: range.start, lte: range.end } }
    });

    if (schedules.value.length > 0) {
      await tx.coachSchedule.createMany({
        data: schedules.value.map((schedule, index) => ({
          sourceScheduleId: `hub:${coach.id}:${yearMonth}:${index}:${schedule.date}:${schedule.startTime}:${schedule.endTime}`,
          coachId: coach.id,
          date: parseDate(schedule.date),
          startTime: schedule.startTime,
          endTime: schedule.endTime
        }))
      });
    }

    await tx.coachScheduleAccessLog.upsert({
      where: {
        coachId_yearMonth: {
          coachId: coach.id,
          yearMonth
        }
      },
      create: {
        coachId: coach.id,
        yearMonth,
        accessedAt: now,
        lastEditedAt: now
      },
      update: {
        lastEditedAt: now
      }
    });
  });

  return NextResponse.json({ ok: true, count: schedules.value.length });
}

function parseSchedules(value: unknown, yearMonth: string):
  | { ok: true; value: Array<{ date: string; startTime: string; endTime: string }> }
  | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "스케줄 형식이 올바르지 않습니다." };

  const result: Array<{ date: string; startTime: string; endTime: string }> = [];
  const seen = new Set<string>();

  for (const item of value as ScheduleInput[]) {
    if (typeof item.date !== "string" || typeof item.startTime !== "string" || typeof item.endTime !== "string") {
      return { ok: false, error: "스케줄 항목 형식이 올바르지 않습니다." };
    }
    if (!item.date.startsWith(`${yearMonth}-`) || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      return { ok: false, error: "선택한 월 밖의 날짜가 포함되어 있습니다." };
    }
    if (!isTime(item.startTime) || !isTime(item.endTime) || item.startTime >= item.endTime) {
      return { ok: false, error: "시간 형식이 올바르지 않습니다." };
    }

    const key = `${item.date}|${item.startTime}|${item.endTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ date: item.date, startTime: item.startTime, endTime: item.endTime });
  }

  return { ok: true, value: result };
}

function parseMonthRange(yearMonth: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) return null;
  const [year, month] = yearMonth.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0))
  };
}

function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}
