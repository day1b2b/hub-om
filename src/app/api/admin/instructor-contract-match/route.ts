import { withActivity } from "@/lib/activity/request";
import { requireInstructorSyncAccess } from "@/lib/instructors/notionInstructorSync";
import { syncJsonResponse } from "@/lib/coaches/syncRouteResponse";
// 프리뷰가 운영현황(operations) + 강사노트를 함께 읽으므로, 둘 다 등록하는 coach-public composition을 쓴다.
// (instructor-sync composition은 강사동기화 저장소만 등록해 operations가 빠짐 → DATA_REPOSITORY_NOT_CONFIGURED)
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";
import { runInstructorContractMatchPreview } from "@/lib/instructors/instructorContractMatchRun";

export const dynamic = "force-dynamic";

// 매칭 미리보기(dry-run, 저장 안 함). 자동 연결 가능 N / 모호 M / 이미 연결 K 를 돌려준다.
async function activityGET(request: Request) {
  return syncJsonResponse(async () => {
    await requireInstructorSyncAccess(request);
    const result = await runInstructorContractMatchPreview();
    return { ok: true, dryRun: true, result };
  });
}

export const GET = withActivity(
  "/api/admin/instructor-contract-match",
  "GET",
  activityGET,
  runCoachPublicRequest
);
