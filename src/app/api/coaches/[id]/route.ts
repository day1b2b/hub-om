import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachManagementRepository } from "@/lib/data/coachManagementRepositoryFactory";
import { coachManagementFailure } from "@/lib/data/coachManagementRepository";

export const dynamic = "force-dynamic";
interface RouteContext { params: Promise<{ id: string }> }
function failureResponse(error: unknown): Response {
  const failure = coachManagementFailure(error);
  if (!failure) throw error;
  return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status });
}
async function activityPATCH(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { status?: unknown };
  try {
    const coach = await getCoachManagementRepository().updateCoachStatus(id, body.status);
    return NextResponse.json({ ok: true, coach });
  } catch (error) { return failureResponse(error); }
}
async function activityGET(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();
  const { id } = await params;
  const coach = await getCoachManagementRepository().getCoach(id);
  if (!coach) return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, coach });
}
async function activityPUT(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const coach = await getCoachManagementRepository().updateCoach(id, body, {
      email: session.user?.email ?? "", name: session.user?.name ?? session.user?.email ?? "매니저"
    });
    return NextResponse.json({ ok: true, coach });
  } catch (error) { return failureResponse(error); }
}
async function activityDELETE(_request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  try {
    await getCoachManagementRepository().deleteCoach(id, session.user?.email ?? null);
    return NextResponse.json({ ok: true });
  } catch (error) { return failureResponse(error); }
}
export const PATCH = withActivity("/api/coaches/[id]", "PATCH", activityPATCH);
export const GET = withActivity("/api/coaches/[id]", "GET", activityGET);
export const PUT = withActivity("/api/coaches/[id]", "PUT", activityPUT);
export const DELETE = withActivity("/api/coaches/[id]", "DELETE", activityDELETE);
