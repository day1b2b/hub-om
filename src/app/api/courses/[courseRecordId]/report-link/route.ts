import { NextResponse } from "next/server.js";
import { withActivity } from "@/lib/activity/request";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { runOperationWriteRequest } from "@/lib/data/operationWriteComposition";

async function activityPUT(request: Request, context: { params: Promise<{ courseRecordId: string }> }) {
  const session = await requireWorkspaceSession();
  const { courseRecordId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const resultReportLink = typeof body.resultReportLink === "string" ? body.resultReportLink : "";

  try {
    const value = await runOperationWriteRequest(() =>
      getOperationRepository().upsertCourseReportLink(courseRecordId, resultReportLink, session.user?.email ?? undefined)
    );
    return NextResponse.json({ ok: true, resultReportLink: value });
  } catch {
    return NextResponse.json({ ok: false, error: "과정을 찾지 못했습니다." }, { status: 404 });
  }
}

export const PUT = withActivity("/api/courses/[courseRecordId]/report-link", "PUT", activityPUT, runOperationWriteRequest);
