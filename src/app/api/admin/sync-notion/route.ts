import { assertCoachSyncReady } from "@/lib/coaches/coachSyncReadiness";
import { withActivity } from "@/lib/activity/request";
import { requireCoachSyncAccess } from "@/lib/coaches/syncAuth";
import { runCoachSyncWithLog } from "@/lib/coaches/syncLog";
import { syncNotionCoaches } from "@/lib/coaches/notionCoachSync";
import { syncJsonResponse } from "@/lib/coaches/syncRouteResponse";

export const dynamic = "force-dynamic";

async function activityGET(request: Request) {
  return syncJsonResponse(async () => {
    await requireCoachSyncAccess(request);
    assertCoachSyncReady("notion", true);
    const result = await syncNotionCoaches(true);
    return { ok: true, dryRun: true, result };
  });
}

async function activityPOST(request: Request) {
  return syncJsonResponse(async () => {
    const triggeredBy = await requireCoachSyncAccess(request);
    assertCoachSyncReady("notion", false);
    const result = await runCoachSyncWithLog("notion", triggeredBy, () => syncNotionCoaches(false));
    return { ok: true, result };
  });
}

export const GET = withActivity("/api/admin/sync-notion", "GET", activityGET);

export const POST = withActivity("/api/admin/sync-notion", "POST", activityPOST);
