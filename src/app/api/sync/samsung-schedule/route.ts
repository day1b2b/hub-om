import { withActivity } from "@/lib/activity/request";
import { requireCoachSyncAccess } from "@/lib/coaches/syncAuth";
import { runCoachSyncWithLog } from "@/lib/coaches/syncLog";
import { syncSamsungSchedule } from "@/lib/coaches/samsungScheduleSync";
import { syncJsonResponse } from "@/lib/coaches/syncRouteResponse";
import { runCoachSyncRequest } from "@/lib/data/coachSyncComposition";

export const dynamic = "force-dynamic";

async function activityGET(request: Request) {
  return syncJsonResponse(async () => {
    await requireCoachSyncAccess(request);
    const result = await syncSamsungSchedule(true);
    return { ok: true, dryRun: true, result };
  });
}

async function activityPOST(request: Request) {
  return syncJsonResponse(async () => {
    const triggeredBy = await requireCoachSyncAccess(request);
    const result = await runCoachSyncWithLog("samsung-schedule", triggeredBy, () => syncSamsungSchedule(false));
    return { ok: true, result };
  });
}

export const GET = withActivity("/api/sync/samsung-schedule", "GET", activityGET, runCoachSyncRequest);

export const POST = withActivity("/api/sync/samsung-schedule", "POST", activityPOST, runCoachSyncRequest);
