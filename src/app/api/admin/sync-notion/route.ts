import { requireCoachSyncAccess } from "@/lib/coaches/syncAuth";
import { runCoachSyncWithLog } from "@/lib/coaches/syncLog";
import { syncNotionCoaches } from "@/lib/coaches/notionCoachSync";
import { syncJsonResponse } from "@/lib/coaches/syncRouteResponse";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return syncJsonResponse(async () => {
    await requireCoachSyncAccess(request);
    const result = await syncNotionCoaches(true);
    return { ok: true, dryRun: true, result };
  });
}

export async function POST(request: Request) {
  return syncJsonResponse(async () => {
    const triggeredBy = await requireCoachSyncAccess(request);
    const result = await runCoachSyncWithLog("notion", triggeredBy, () => syncNotionCoaches(false));
    return { ok: true, result };
  });
}
