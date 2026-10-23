import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import {
  emptyCompanyBusinessInfo,
  getCompanyBusinessInfo,
  updateCompanyBusinessInfo,
  type CompanyBusinessInfoPatch
} from "@/lib/data/companyBusinessInfoRepository";

// 기업 상세를 열 때 그 기업 것만 조회한다. 목록 화면에서 전체 기업의 PII를 한 번에
// 내려보내지 않기 위해, 기업위키 페이지 로드가 아니라 상세를 열 때 따로 불러온다.
async function activityGET(request: Request) {
  await requireWorkspaceSession();
  const companyId = new URL(request.url).searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId 필요" }, { status: 400 });
  }
  try {
    const businessInfo = (await getCompanyBusinessInfo(companyId)) ?? emptyCompanyBusinessInfo();
    return NextResponse.json({ businessInfo });
  } catch {
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}

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

export const GET = withActivity("/api/company-wiki/business-info", "GET", activityGET);
export const POST = withActivity("/api/company-wiki/business-info", "POST", activityPOST);
