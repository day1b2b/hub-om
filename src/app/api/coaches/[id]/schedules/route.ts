import { NextResponse } from "next/server";
import { CoachEngagementStatus } from "@prisma/client";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const yearMonth = searchParams.get("yearMonth");
  const range = yearMonth ? parseMonthRange(yearMonth) : null;

  if (!yearMonth || !range) {
    return NextResponse.json({ ok: false, error: "월 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const coach = await prisma.coach.findFirst({
    where: { id, deletedAt: null },
    select: { id: true }
  });

  if (!coach) {
    return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  }

  const [schedules, engagementSchedules, accessLog] = await Promise.all([
    prisma.coachSchedule.findMany({
      where: { coachId: id, date: { gte: range.start, lte: range.end } },
      select: { id: true, date: true, startTime: true, endTime: true },
      orderBy: [{ date: "asc" }, { startTime: "asc" }]
    }),
    prisma.coachEngagementSchedule.findMany({
      where: {
        coachId: id,
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
      where: { coachId_yearMonth: { coachId: id, yearMonth } },
      select: { accessedAt: true, lastEditedAt: true, yearMonth: true }
    })
  ]);

  return NextResponse.json({
    ok: true,
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      date: toDateString(schedule.date),
      startTime: schedule.startTime,
      endTime: schedule.endTime
    })),
    engagementSchedules: engagementSchedules.map((schedule) => ({
      date: toDateString(schedule.date),
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      courseName: schedule.engagement.courseName,
      status: schedule.engagement.status.toLowerCase()
    })),
    accessLog: accessLog
      ? {
          yearMonth: accessLog.yearMonth,
          accessedAt: accessLog.accessedAt.toISOString(),
          lastEditedAt: accessLog.lastEditedAt?.toISOString() ?? null
        }
      : null
  });
}

function parseMonthRange(yearMonth: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) return null;
  const [year, month] = yearMonth.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0))
  };
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}
