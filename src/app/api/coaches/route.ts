import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachManagementRepository } from "@/lib/data/coachManagementRepositoryFactory";
import { coachManagementFailure } from "@/lib/data/coachManagementRepository";

export const dynamic = "force-dynamic";

async function activityGET(request: Request) {
  await requireWorkspaceSession();
  const { searchParams } = new URL(request.url);
  const result = await getCoachManagementRepository().listCoaches({
    search: searchParams.get("search")?.trim(), field: searchParams.get("field")?.trim(), status: searchParams.get("status") ?? undefined,
    page: Math.max(1, Number(searchParams.get("page") ?? 1) || 1), limit: Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 50) || 50))
  });
  return NextResponse.json({ ok: true, ...result });
}
async function activityPOST(request: Request) {
  await requireWorkspaceSession();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const coach = await getCoachManagementRepository().createCoach(body);
    return NextResponse.json({ ok: true, coach }, { status: 201 });
  } catch (error) {
    const failure = coachManagementFailure(error);
    if (!failure) throw error;
    return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status });
  }
}
export const GET = withActivity("/api/coaches", "GET", activityGET);
export const POST = withActivity("/api/coaches", "POST", activityPOST);
