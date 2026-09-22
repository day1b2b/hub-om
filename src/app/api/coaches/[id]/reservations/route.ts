import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseDates } from "@/lib/coaches/coachScheduleValidation";
import { getCoachScheduleRepository } from "@/lib/data/coachScheduleRepositoryFactory";

export const dynamic = "force-dynamic";
interface RouteContext { params: Promise<{ id: string }> }

// The final owner for each requested day preserves the existing success/conflict response contract.
async function activityPOST(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { dates?: unknown } | null;
  const dates = parseDates(body?.dates);
  if (!dates) return NextResponse.json({ ok: false, error: "날짜 값이 올바르지 않습니다." }, { status: 400 });
  const results = await getCoachScheduleRepository().reserveDates(id.toLowerCase(), dates, {
    name: session.user?.name ?? session.user?.email ?? "매니저", email: session.user?.email ?? ""
  });
  if (!results) return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, results });
}

async function activityDELETE(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { dates?: unknown } | null;
  const dates = parseDates(body?.dates);
  if (!dates) return NextResponse.json({ ok: false, error: "날짜 값이 올바르지 않습니다." }, { status: 400 });
  const cancelledDates = await getCoachScheduleRepository().cancelDates(id.toLowerCase(), dates, session.user?.email ?? "");
  return NextResponse.json({ ok: true, cancelledDates });
}

export const POST = withActivity("/api/coaches/[id]/reservations", "POST", activityPOST);
export const DELETE = withActivity("/api/coaches/[id]/reservations", "DELETE", activityDELETE);
