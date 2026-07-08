import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import {
  parseDate,
  parseOptionalEngagementStatus,
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

export async function PUT(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rating = parseRating(body.rating);
  if (rating === undefined && body.rating !== undefined) {
    return NextResponse.json({ ok: false, error: "평점은 1~5 사이 정수여야 합니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const existing = await prisma.coachEngagement.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "투입 이력을 찾을 수 없습니다." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const engagement = await tx.coachEngagement.update({
      where: { id },
      data: {
        ...(body.courseName !== undefined ? { courseName: stringValue(body.courseName) ?? existing.courseName } : {}),
        ...(body.status !== undefined ? { status: parseOptionalEngagementStatus(body.status) } : {}),
        ...(body.startDate !== undefined ? { startDate: parseDate(body.startDate) ?? existing.startDate } : {}),
        ...(body.endDate !== undefined ? { endDate: parseDate(body.endDate) ?? existing.endDate } : {}),
        ...(body.startTime !== undefined ? { startTime: stringValue(body.startTime) } : {}),
        ...(body.endTime !== undefined ? { endTime: stringValue(body.endTime) } : {}),
        ...(body.rating !== undefined ? { rating: rating ?? null } : {}),
        ...(body.feedback !== undefined ? { feedback: stringValue(body.feedback) } : {}),
        ...(body.rehire !== undefined ? { rehire: typeof body.rehire === "boolean" ? body.rehire : null } : {}),
        ...(body.hiredBy !== undefined ? { hiredByText: stringValue(body.hiredBy) } : {})
      }
    });

    if (body.startDate !== undefined || body.endDate !== undefined || body.startTime !== undefined || body.endTime !== undefined) {
      await regenerateWeekdaySchedules(
        tx,
        engagement.id,
        engagement.coachId,
        engagement.startDate,
        engagement.endDate,
        engagement.startTime,
        engagement.endTime
      );
    }

    return engagement;
  });

  return NextResponse.json({ ok: true, engagement: updated });
}
