import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachTokenRotationRepository } from "@/lib/data/coachTokenRotationRepositoryFactory";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

async function activityPOST(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
    return NextResponse.json({ error: "코치 ID가 올바르지 않습니다." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  const coach = await getCoachTokenRotationRepository().regenerateToken(id.toLowerCase());
  if (!coach) return NextResponse.json({ error: "코치를 찾을 수 없습니다." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

  return NextResponse.json({ ok: true, accessToken: coach.accessToken }, { headers: { "Cache-Control": "private, no-store" } });
}

export const POST = withActivity("/api/coaches/[id]/regenerate-token", "POST", activityPOST);
