import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import {
  MANUAL_ENGAGEMENT_SOURCE,
  manualSourceId,
  parseDate,
  parseEngagementStatus,
  parseRating,
  regenerateWeekdaySchedules,
  stringValue
} from "@/lib/coaches/engagementApi";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  const prisma = getPrismaClient();
  const coach = await prisma.coach.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!coach) {
    return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  }

  const engagements = await prisma.coachEngagement.findMany({
    where: { coachId: id },
    orderBy: { startDate: "desc" }
  });

  return NextResponse.json({
    ok: true,
    engagements: engagements.map((engagement) => ({
      ...engagement,
      status: engagement.status.toLowerCase(),
      source: engagement.source.toLowerCase(),
      startDate: engagement.startDate.toISOString().slice(0, 10),
      endDate: engagement.endDate.toISOString().slice(0, 10)
    }))
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const courseName = stringValue(body.courseName);
  const startDate = parseDate(body.startDate);
  const endDate = parseDate(body.endDate);
  const rating = parseRating(body.rating);

  if (!courseName) return NextResponse.json({ ok: false, error: "과정명이 필요합니다." }, { status: 400 });
  if (!startDate || !endDate) return NextResponse.json({ ok: false, error: "기간이 필요합니다." }, { status: 400 });
  if (rating === undefined) return NextResponse.json({ ok: false, error: "평점은 1~5 사이 정수여야 합니다." }, { status: 400 });

  const prisma = getPrismaClient();
  const coach = await prisma.coach.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!coach) {
    return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  }

  const engagement = await prisma.$transaction(async (tx) => {
    const created = await tx.coachEngagement.create({
      data: {
        sourceEngagementId: manualSourceId(),
        coachId: id,
        courseName,
        status: parseEngagementStatus(body.status),
        source: MANUAL_ENGAGEMENT_SOURCE,
        startDate,
        endDate,
        startTime: stringValue(body.startTime),
        endTime: stringValue(body.endTime),
        rating: rating ?? null,
        feedback: stringValue(body.feedback),
        rehire: typeof body.rehire === "boolean" ? body.rehire : null,
        hiredByText: stringValue(body.hiredBy)
      }
    });

    await regenerateWeekdaySchedules(tx, created.id, id, startDate, endDate, created.startTime, created.endTime);
    return created;
  });

  return NextResponse.json({ ok: true, engagement }, { status: 201 });
}
