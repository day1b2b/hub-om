import { withActivity } from "@/lib/activity/request";
import { requireCoachSyncAccess } from "@/lib/coaches/syncAuth";
import { runCoachSyncWithLog } from "@/lib/coaches/syncLog";
import { CONTRACT_UPLOAD_MAX_BYTES, syncUploadedContractEngagements } from "@/lib/coaches/contractSheetSync";
import { syncJsonResponse } from "@/lib/coaches/syncRouteResponse";
import { runCoachSyncRequest } from "@/lib/data/coachSyncComposition";

export const dynamic = "force-dynamic";

// 계약 요청 엑셀을 직접 올려 동기화한다. dryRun=true면 미리보기(저장 안 함), false면 실제 반영.
// 파일은 메모리에서만 읽고 어디에도 저장하지 않는다.
async function activityPOST(request: Request) {
  return syncJsonResponse(async () => {
    const triggeredBy = await requireCoachSyncAccess(request);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("계약 파일(.xlsx)을 선택해 주세요.");
    if (!/\.xlsx$/i.test(file.name)) throw new Error("엑셀(.xlsx) 파일만 올릴 수 있습니다.");
    if (file.size > CONTRACT_UPLOAD_MAX_BYTES) throw new Error("파일이 너무 큽니다(15MB 이하).");
    const dryRun = form?.get("dryRun") !== "false";
    const buffer = Buffer.from(await file.arrayBuffer());
    const run = () => syncUploadedContractEngagements(buffer, dryRun);
    const result = dryRun ? await run() : await runCoachSyncWithLog("engagements", triggeredBy, run);
    return { ok: true, dryRun, result };
  });
}

export const POST = withActivity("/api/sync/engagements/upload", "POST", activityPOST, runCoachSyncRequest);
