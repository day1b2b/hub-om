import { withActivity } from "@/lib/activity/request";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { deleteCoachEvaluationResponse, updateCoachEvaluationResponse } from "@/lib/coaches/coachEvaluationService";
import { runCoachEvaluationRequest } from "@/lib/data/coachEvaluationComposition";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; evaluationId: string }>;
}

async function sessionUser() {
  const session = await requireWorkspaceSession();
  return { email: session.user?.email ?? "", name: session.user?.name ?? null };
}

async function activityPATCH(request: Request, { params }: RouteContext) {
  const user = await sessionUser();
  const { id, evaluationId } = await params;
  const body = await request.json().catch(() => null);
  return updateCoachEvaluationResponse(id, evaluationId, body, user);
}

async function activityDELETE(_request: Request, { params }: RouteContext) {
  const user = await sessionUser();
  const { id, evaluationId } = await params;
  return deleteCoachEvaluationResponse(id, evaluationId, user);
}

export const PATCH = withActivity("/api/coaches/[id]/evaluations/[evaluationId]", "PATCH", activityPATCH, runCoachEvaluationRequest);

export const DELETE = withActivity("/api/coaches/[id]/evaluations/[evaluationId]", "DELETE", activityDELETE, runCoachEvaluationRequest);
