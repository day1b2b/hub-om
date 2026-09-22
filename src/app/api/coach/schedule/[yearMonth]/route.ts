import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { extractCoachToken, validateCoachToken } from "@/lib/coaches/coachTokenAuth";
import { parseMonthRange, parseSchedules } from "@/lib/coaches/coachScheduleValidation";
import { getCoachScheduleRepository } from "@/lib/data/coachScheduleRepositoryFactory";

export const dynamic = "force-dynamic";
interface RouteContext { params: Promise<{ yearMonth: string }> }

async function activityGET(request: Request, { params }: RouteContext) {
  const coach = await validateCoachToken(extractCoachToken(request));
  if (!coach) return NextResponse.json({ ok: false, error: "코치 정보를 찾을 수 없습니다." }, { status: 401 });
  const { yearMonth } = await params;
  if (!parseMonthRange(yearMonth)) return NextResponse.json({ ok: false, error: "월 형식이 올바르지 않습니다." }, { status: 400 });
  const result = await getCoachScheduleRepository().getCoachMonth(coach.id, yearMonth);
  return NextResponse.json({ ok: true, ...result });
}

async function activityPUT(request: Request, { params }: RouteContext) {
  const coach = await validateCoachToken(extractCoachToken(request));
  if (!coach) return NextResponse.json({ ok: false, error: "코치 정보를 찾을 수 없습니다." }, { status: 401 });
  const { yearMonth } = await params;
  if (!parseMonthRange(yearMonth)) return NextResponse.json({ ok: false, error: "월 형식이 올바르지 않습니다." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { schedules?: unknown } | null;
  const schedules = parseSchedules(body?.schedules, yearMonth);
  if (!schedules.ok) return NextResponse.json({ ok: false, error: schedules.error }, { status: 400 });
  await getCoachScheduleRepository().replaceCoachMonth(coach.id, yearMonth, schedules.value);
  return NextResponse.json({ ok: true, count: schedules.value.length });
}

export const GET = withActivity("/api/coach/schedule/[yearMonth]", "GET", activityGET);
export const PUT = withActivity("/api/coach/schedule/[yearMonth]", "PUT", activityPUT);
