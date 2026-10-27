import { withActivity } from "@/lib/activity/request";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { createCoachFactResponse } from "@/lib/coaches/coachEvaluationService";
import { runCoachEvaluationRequest } from "@/lib/data/coachEvaluationComposition";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 사실 기록 목록은 GET /api/coaches/[id]/evaluations에 함께 내려간다.
async function activityPOST(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  return createCoachFactResponse(id, body, { email: session.user?.email ?? "", name: session.user?.name ?? null });
}

export const POST = withActivity("/api/coaches/[id]/facts", "POST", activityPOST, runCoachEvaluationRequest);
