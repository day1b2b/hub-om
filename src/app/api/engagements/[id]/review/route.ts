import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseReviewCommand } from "@/lib/coaches/engagementApi";
import { getCoachEngagementRepository } from "@/lib/data/coachEngagementRepositoryFactory";

export const dynamic = "force-dynamic";
interface RouteContext { params: Promise<{ id: string }> }
async function activityPATCH(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const author = { email: session.user?.email ?? "", name: session.user?.name ?? session.user?.email ?? "매니저" };
  const { id } = await params;
  const command = parseReviewCommand(await request.json().catch(() => ({})));
  if (!command.ok) return NextResponse.json({ ok: false, error: command.error }, { status: 400 });
  const engagement = await getCoachEngagementRepository().updateReview(id.toLowerCase(), command.value, author);
  return NextResponse.json({ ok: true, engagement });
}
export const PATCH = withActivity("/api/engagements/[id]/review", "PATCH", activityPATCH);
