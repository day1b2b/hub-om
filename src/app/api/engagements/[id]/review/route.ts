import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { logReviewEdit } from "@/lib/coaches/contentEntries";
import { parseRating, stringValue } from "@/lib/coaches/engagementApi";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const author = { email: session.user?.email ?? "", name: session.user?.name ?? session.user?.email ?? "매니저" };

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const prisma = getPrismaClient();

  if (body.toggleFlag === true) {
    const existing = await prisma.coachEngagement.findUniqueOrThrow({ where: { id }, select: { coachId: true, reviewFlaggedAt: true } });
    const nextFlaggedAt = existing.reviewFlaggedAt ? null : new Date();
    const engagement = await prisma.coachEngagement.update({ where: { id }, data: { reviewFlaggedAt: nextFlaggedAt } });
    await logReviewEdit(existing.coachId, id, nextFlaggedAt ? "리뷰 경고 설정" : "리뷰 경고 해제", author);
    return NextResponse.json({ ok: true, engagement });
  }

  if (body.deleteReview === true) {
    const existing = await prisma.coachEngagement.findUniqueOrThrow({ where: { id }, select: { coachId: true } });
    const engagement = await prisma.coachEngagement.update({ where: { id }, data: { rating: null, feedback: null } });
    await logReviewEdit(existing.coachId, id, "리뷰 삭제", author);
    return NextResponse.json({ ok: true, engagement });
  }

  const rating = parseRating(body.rating);
  if (rating === undefined && body.rating !== undefined) {
    return NextResponse.json({ ok: false, error: "평점은 1~5 사이 정수여야 합니다." }, { status: 400 });
  }

  const engagement = await prisma.coachEngagement.update({
    where: { id },
    data: {
      ...(body.rating !== undefined ? { rating: rating ?? null } : {}),
      ...(body.feedback !== undefined ? { feedback: stringValue(body.feedback) } : {}),
      ...(body.rehire !== undefined ? { rehire: typeof body.rehire === "boolean" ? body.rehire : null } : {})
    },
    select: { id: true, coachId: true, rating: true, feedback: true, rehire: true }
  });

  if (body.rating !== undefined || body.feedback !== undefined) {
    await logReviewEdit(engagement.coachId, id, "리뷰 수정", author);
  }

  return NextResponse.json({ ok: true, engagement });
}
