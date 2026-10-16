import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { updateCompanyBusinessInfo, type CompanyBusinessInfoPatch } from "@/lib/data/companyBusinessInfoRepository";

// 기업위키 사업자등록증 정보 저장. companyId 기준으로 부분 병합.
async function activityPOST(request: Request) {
  const session = await requireWorkspaceSession();
  try {
    const body = (await request.json()) as { companyId?: string } & CompanyBusinessInfoPatch;
    const { companyId, ...patch } = body;
    if (!companyId || typeof companyId !== "string") {
      return NextResponse.json({ error: "companyId 필요" }, { status: 400 });
    }
    const updatedBy = session.user?.email ?? "unknown";
    const saved = await updateCompanyBusinessInfo(companyId, patch, updatedBy);
    return NextResponse.json({ ok: true, saved });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}

export const POST = withActivity("/api/company-wiki/business-info", "POST", activityPOST);
