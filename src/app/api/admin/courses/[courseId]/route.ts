import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getCourseAdminRepository } from "@/lib/data/courseAdminRepositoryFactory";
import { runCourseDeletionRequest } from "@/lib/data/courseDeletionComposition";
import { retryOperationCalendarDelete } from "@/lib/googleCalendar/reflectOperationToCalendar";
import { assertCalendarScopeReady } from "@/lib/googleCalendar/calendarScope";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    courseId: string;
  }>;
}

async function activityDELETE(_request: Request, { params }: RouteContext) {
  const session = await assertAdminSession();
  const { courseId } = await params;
  assertCalendarScopeReady();
  const repository = getCourseAdminRepository();
  const deletedCount = await repository.softDeleteCourseSessions(courseId, session.user?.email ?? null);

  if (deletedCount === null) {
    return NextResponse.json({ ok: false, error: "해당 과정을 찾을 수 없습니다." }, { status: 404 });
  }

  // Include earlier deletions so repeating this action can finish failed cleanup.
  let pending = 0;
  try {
    for (const operationId of await repository.listDeletedCourseOperationIds(courseId)) {
      if (await retryOperationCalendarDelete(operationId) === "pending") pending++;
    }
  } catch {
    pending++;
    console.error("[gcal] COURSE_CALENDAR_DELETE_PENDING");
  }
  return NextResponse.json({ ok: true, deletedCount, calendarCleanup: pending ? "pending" : "completed" });
}

export const DELETE = withActivity("/api/admin/courses/[courseId]", "DELETE", activityDELETE, runCourseDeletionRequest);
