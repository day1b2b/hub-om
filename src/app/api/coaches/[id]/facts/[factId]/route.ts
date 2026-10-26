import { withActivity } from "@/lib/activity/request";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { deleteCoachFactResponse } from "@/lib/coaches/coachEvaluationService";
import { runCoachEvaluationRequest } from "@/lib/data/coachEvaluationComposition";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; factId: string }>;
}

async function activityDELETE(_request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id, factId } = await params;
  return deleteCoachFactResponse(id, factId, { email: session.user?.email ?? "", name: session.user?.name ?? null });
}

export const DELETE = withActivity("/api/coaches/[id]/facts/[factId]", "DELETE", activityDELETE, runCoachEvaluationRequest);
