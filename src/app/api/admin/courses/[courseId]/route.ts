import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getCourseAdminRepository } from "@/lib/data/courseAdminRepositoryFactory";
import { runAdminMaintenanceRequest } from "@/lib/data/adminMaintenanceComposition";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    courseId: string;
  }>;
}

async function activityDELETE(_request: Request, { params }: RouteContext) {
  const session = await assertAdminSession();
  const { courseId } = await params;

  const deletedCount = await getCourseAdminRepository().softDeleteCourseSessions(courseId, session.user?.email ?? null);

  if (deletedCount === null) {
    return NextResponse.json({ ok: false, error: "해당 과정을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deletedCount });
}

export const DELETE = withActivity("/api/admin/courses/[courseId]", "DELETE", activityDELETE, runAdminMaintenanceRequest);
