import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    courseId: string;
  }>;
}

async function activityDELETE(_request: Request, { params }: RouteContext) {
  const session = await assertAdminSession();
  const { courseId } = await params;

  const prisma = getPrismaClient();
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });

  if (!course) {
    return NextResponse.json({ ok: false, error: "해당 과정을 찾을 수 없습니다." }, { status: 404 });
  }

  const result = await prisma.operationSession.updateMany({
    where: { courseRecordId: courseId, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: session.user?.email ?? null }
  });

  return NextResponse.json({ ok: true, deletedCount: result.count });
}

export const DELETE = withActivity("/api/admin/courses/[courseId]", "DELETE", activityDELETE);
