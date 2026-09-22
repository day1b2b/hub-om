import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseMonthRange } from "@/lib/coaches/coachScheduleValidation";
import { getCoachScheduleRepository } from "@/lib/data/coachScheduleRepositoryFactory";

export const dynamic = "force-dynamic";
interface RouteContext { params: Promise<{ id: string }> }

async function activityGET(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();
  const { id } = await params;
  const yearMonth = new URL(request.url).searchParams.get("yearMonth");
  if (!yearMonth || !parseMonthRange(yearMonth)) return NextResponse.json({ ok: false, error: "월 형식이 올바르지 않습니다." }, { status: 400 });
  const result = await getCoachScheduleRepository().getManagerMonth(id.toLowerCase(), yearMonth);
  if (!result) return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}

export const GET = withActivity("/api/coaches/[id]/schedules", "GET", activityGET);
