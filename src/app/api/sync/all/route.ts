import { assertCoachSyncReady } from "@/lib/coaches/coachSyncReadiness";
import { withActivity } from "@/lib/activity/request";
import { requireCoachSyncAccess } from "@/lib/coaches/syncAuth";
import { syncContractSheetEngagements } from "@/lib/coaches/contractSheetSync";
import { syncNotionCoaches } from "@/lib/coaches/notionCoachSync";
import type { SyncResult } from "@/lib/coaches/syncTypes";
import { runCoachSyncWithLog } from "@/lib/coaches/syncLog";
import { syncJsonResponse } from "@/lib/coaches/syncRouteResponse";
import { runCoachSyncRequest } from "@/lib/data/coachSyncComposition";

export const dynamic = "force-dynamic";

async function activityGET(request: Request) {
  return syncJsonResponse(async () => {
    await requireCoachSyncAccess(request);
    assertCoachSyncReady("all", true);
    const result = await runAll(true);
    return { ok: true, dryRun: true, result };
  });
}

async function activityPOST(request: Request) {
  return syncJsonResponse(async () => {
    const triggeredBy = await requireCoachSyncAccess(request);
    assertCoachSyncReady("all", false);
    const result = await runCoachSyncWithLog("all", triggeredBy, () => runAll(false));
    return { ok: true, result };
  });
}

// 삼성 스케줄시트(syncSamsungSchedule)는 코치 투입 소스에서 제외한다(운영현황=정본).
// 전용 라우트 /api/sync/samsung-schedule는 남아 있으나 전체 동기화에서는 더 이상 호출하지 않는다.
async function runAll(dryRun: boolean): Promise<SyncResult> {
  const notion = await syncNotionCoaches(dryRun);
  const engagements = await syncContractSheetEngagements(dryRun);
  return {
    totalRows: notion.totalRows + engagements.totalRows,
    created: notion.created + engagements.created,
    updated: notion.updated + engagements.updated,
    skipped: notion.skipped + engagements.skipped,
    errors: notion.errors + engagements.errors,
    errorDetail: [...notion.errorDetail, ...engagements.errorDetail],
    changes: dryRun ? [...(notion.changes ?? []), ...(engagements.changes ?? [])] : undefined
  };
}

export const GET = withActivity("/api/sync/all", "GET", activityGET, runCoachSyncRequest);

export const POST = withActivity("/api/sync/all", "POST", activityPOST, runCoachSyncRequest);
