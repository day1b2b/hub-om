import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseCreateEngagement } from "@/lib/coaches/engagementApi";
import { getCoachEngagementRepository } from "@/lib/data/coachEngagementRepositoryFactory";

export const dynamic = "force-dynamic";
interface RouteContext { params: Promise<{ id: string }> }

async function activityGET(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();
  const { id } = await params;
  const engagements = await getCoachEngagementRepository().listForCoach(id.toLowerCase());
  if (!engagements) return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, engagements });
}
async function activityPOST(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();
  const { id } = await params;
  const input = parseCreateEngagement(await request.json().catch(() => ({})));
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: 400 });
  const engagement = await getCoachEngagementRepository().createForCoach(id.toLowerCase(), input.value);
  if (!engagement) return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, engagement }, { status: 201 });
}
export const GET = withActivity("/api/coaches/[id]/engagements", "GET", activityGET);
export const POST = withActivity("/api/coaches/[id]/engagements", "POST", activityPOST);
