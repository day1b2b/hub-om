import { withActivity } from "@/lib/activity/request";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { createCoachEvaluationResponse, listCoachEvaluationsResponse } from "@/lib/coaches/coachEvaluationService";
import { runCoachEvaluationRequest } from "@/lib/data/coachEvaluationComposition";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function sessionUser() {
  const session = await requireWorkspaceSession();
  return { email: session.user?.email ?? "", name: session.user?.name ?? null };
}

async function activityGET(_request: Request, { params }: RouteContext) {
  const user = await sessionUser();
  const { id } = await params;
  return listCoachEvaluationsResponse(id, user);
}

async function activityPOST(request: Request, { params }: RouteContext) {
  const user = await sessionUser();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  return createCoachEvaluationResponse(id, body, user);
}

export const GET = withActivity("/api/coaches/[id]/evaluations", "GET", activityGET, runCoachEvaluationRequest);

export const POST = withActivity("/api/coaches/[id]/evaluations", "POST", activityPOST, runCoachEvaluationRequest);
