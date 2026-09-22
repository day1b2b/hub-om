import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseUpdateEngagement } from "@/lib/coaches/engagementApi";
import { getCoachEngagementRepository } from "@/lib/data/coachEngagementRepositoryFactory";

export const dynamic = "force-dynamic";
interface RouteContext { params: Promise<{ id: string }> }
async function activityPUT(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();
  const { id } = await params;
  const input = parseUpdateEngagement(await request.json().catch(() => ({})));
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: 400 });
  const engagement = await getCoachEngagementRepository().update(id.toLowerCase(), input.value);
  if (!engagement) return NextResponse.json({ ok: false, error: "투입 이력을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, engagement });
}
export const PUT = withActivity("/api/engagements/[id]", "PUT", activityPUT);
