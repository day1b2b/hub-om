import { requireInstructorSyncAccess, syncNotionInstructors } from "@/lib/instructors/notionInstructorSync";
import { syncJsonResponse } from "@/lib/coaches/syncRouteResponse";

export const dynamic = "force-dynamic";

// 미리보기(저장 안 함).
export async function GET(request: Request) {
  return syncJsonResponse(async () => {
    await requireInstructorSyncAccess(request);
    const result = await syncNotionInstructors(true);
    return { ok: true, dryRun: true, result };
  });
}

// 실제 반영.
export async function POST(request: Request) {
  return syncJsonResponse(async () => {
    await requireInstructorSyncAccess(request);
    const result = await syncNotionInstructors(false);
    return { ok: true, result };
  });
}
