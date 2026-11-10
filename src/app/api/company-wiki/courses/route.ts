import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { findCompanyCourses } from "@/features/wiki/companyWikiModel";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { runOverviewPagesRequest } from "@/lib/data/overviewPagesComposition";

// 기업위키 상세를 열 때 그 기업의 코스 상세만 불러온다. 목록 화면에서 전체 기업의 코스 상세를
// 한 번에 내려보내지 않기 위해, 기업위키 페이지 로드가 아니라 상세를 열 때 따로 조회한다
// (사업자등록증 정보를 상세에서 따로 불러오는 것과 같은 결).
async function activityGET(request: Request) {
  await requireWorkspaceSession();
  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId") || null;
  const name = url.searchParams.get("name") ?? "";
  if (!companyId && !name) {
    return NextResponse.json({ error: "companyId 또는 name 필요" }, { status: 400 });
  }
  try {
    const operations = await getOperationRepository().listOperations();
    const courses = findCompanyCourses(operations, companyId, name);
    return NextResponse.json({ courses });
  } catch {
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}

export const GET = withActivity("/api/company-wiki/courses", "GET", activityGET, runOverviewPagesRequest);
