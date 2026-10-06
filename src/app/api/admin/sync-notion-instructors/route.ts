import { withActivity } from "@/lib/activity/request";
import { requireInstructorSyncAccess, syncNotionInstructors } from "@/lib/instructors/notionInstructorSync";
import { syncJsonResponse } from "@/lib/coaches/syncRouteResponse";

export const dynamic = "force-dynamic";

// 미리보기(저장 안 함).
async function activityGET(request: Request) {
  return syncJsonResponse(async () => {
    await requireInstructorSyncAccess(request);
    const result = await syncNotionInstructors(true);
    return { ok: true, dryRun: true, result };
  });
}

// 실제 반영.
async function activityPOST(request: Request) {
  return syncJsonResponse(async () => {
    await requireInstructorSyncAccess(request);
    const result = await syncNotionInstructors(false);
    return { ok: true, result };
  });
}

export const GET = withActivity("/api/admin/sync-notion-instructors", "GET", activityGET);

export const POST = withActivity("/api/admin/sync-notion-instructors", "POST", activityPOST);
