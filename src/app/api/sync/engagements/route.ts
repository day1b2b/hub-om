import { withActivity } from "@/lib/activity/request";
import { requireCoachSyncAccess } from "@/lib/coaches/syncAuth";
import { runCoachSyncWithLog } from "@/lib/coaches/syncLog";
import { syncContractSheetEngagements } from "@/lib/coaches/contractSheetSync";
import { syncJsonResponse } from "@/lib/coaches/syncRouteResponse";

export const dynamic = "force-dynamic";

async function activityGET(request: Request) {
  return syncJsonResponse(async () => {
    await requireCoachSyncAccess(request);
    const result = await syncContractSheetEngagements(true);
    return { ok: true, dryRun: true, result };
  });
}

async function activityPOST(request: Request) {
  return syncJsonResponse(async () => {
    const triggeredBy = await requireCoachSyncAccess(request);
    const result = await runCoachSyncWithLog("engagements", triggeredBy, () => syncContractSheetEngagements(false));
    return { ok: true, result };
  });
}

export const GET = withActivity("/api/sync/engagements", "GET", activityGET);

export const POST = withActivity("/api/sync/engagements", "POST", activityPOST);
