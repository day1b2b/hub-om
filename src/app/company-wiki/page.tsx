import { CompanyWiki } from "@/features/wiki/CompanyWiki";
import { aggregateCompanies, type CompanyWikiEntry } from "@/features/wiki/companyWikiModel";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { listCompanyBusinessInfoById, type CompanyBusinessInfo } from "@/lib/data/companyBusinessInfoRepository";
import { runOverviewPagesRequest } from "@/lib/data/overviewPagesComposition";

export const dynamic = "force-dynamic";

export default async function CompanyWikiPage() {
  return runOverviewPagesRequest(renderCompanyWikiPage);
}
async function renderCompanyWikiPage() {
  // 전체 OM이 자기 기업 운영 현황·사업자등록증 정보를 볼 수 있어야 해서 관리자 전용에서 완화했다.
  await requireWorkspaceSession();

  // 기업 목록·코스·이력은 운영 현황에서 온다. 전에는 하드코딩 배열이었다.
  let entries: CompanyWikiEntry[] = [];
  let loadFailed = false;

  try {
    const operations = await getOperationRepository().listOperations();
    entries = aggregateCompanies(operations);
  } catch {
    loadFailed = true;
  }

  // 사업자등록증 정보를 못 읽어도 나머지 화면은 그대로 보여준다(빈 값으로 둔다).
  let businessInfoByCompanyId: Record<string, CompanyBusinessInfo> = {};
  try {
    businessInfoByCompanyId = Object.fromEntries(await listCompanyBusinessInfoById());
  } catch {
    businessInfoByCompanyId = {};
  }

  return <CompanyWiki entries={entries} loadFailed={loadFailed} businessInfoByCompanyId={businessInfoByCompanyId} />;
}
