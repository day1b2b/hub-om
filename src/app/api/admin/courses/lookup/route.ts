import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getCourseAdminRepository } from "@/lib/data/courseAdminRepositoryFactory";
import { runAdminMaintenanceRequest } from "@/lib/data/adminMaintenanceComposition";

export const dynamic = "force-dynamic";

function parseProcessSeq(rawProcessId: string): number | null {
  const match = /^PRC-(\d+)$/i.exec(rawProcessId.trim());
  if (!match) return null;

  const processSeq = Number(match[1]);
  return Number.isInteger(processSeq) ? processSeq : null;
}

async function activityGET(request: Request) {
  await assertAdminSession();

  const processId = new URL(request.url).searchParams.get("processId") ?? "";
  const processSeq = parseProcessSeq(processId);

  if (processSeq === null) {
    return NextResponse.json({ ok: false, error: "과정ID 형식이 올바르지 않습니다. 예: PRC-000533" }, { status: 400 });
  }

  const course = await getCourseAdminRepository().findCourse(processSeq);

  if (!course) {
    return NextResponse.json({ ok: false, error: "해당 과정ID를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    course
  });
}

export const GET = withActivity("/api/admin/courses/lookup", "GET", activityGET, runAdminMaintenanceRequest);
