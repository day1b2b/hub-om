import { NextResponse } from "next/server.js";
import { withActivity } from "@/lib/activity/request";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import type { ResultReportStatus } from "@/lib/data/operationTypes";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { runOperationWriteRequest } from "@/lib/data/operationWriteComposition";

const VALID_STATUSES: readonly ResultReportStatus[] = ["유", "무", "불필요", "확인필요"];

function isResultReportStatus(value: unknown): value is ResultReportStatus {
  return typeof value === "string" && (VALID_STATUSES as readonly string[]).includes(value);
}

async function activityPUT(request: Request, context: { params: Promise<{ courseRecordId: string }> }) {
  const session = await requireWorkspaceSession();
  const { courseRecordId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (!isResultReportStatus(body.hasResultReport)) {
    return NextResponse.json({ ok: false, error: "유효하지 않은 값입니다." }, { status: 400 });
  }

  try {
    const value = await runOperationWriteRequest(() =>
      getOperationRepository().upsertCourseResultReportStatus(courseRecordId, body.hasResultReport as ResultReportStatus, session.user?.email ?? undefined)
    );
    return NextResponse.json({ ok: true, hasResultReport: value });
  } catch {
    return NextResponse.json({ ok: false, error: "과정을 찾지 못했습니다." }, { status: 404 });
  }
}

export const PUT = withActivity("/api/courses/[courseRecordId]/result-report-status", "PUT", activityPUT, runOperationWriteRequest);
