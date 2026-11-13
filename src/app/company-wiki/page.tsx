import { CompanyWiki } from "@/features/wiki/CompanyWiki";
import { aggregateCompanies, type CompanyWikiEntry } from "@/features/wiki/companyWikiModel";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { runOverviewPagesRequest } from "@/lib/data/overviewPagesComposition";

export const dynamic = "force-dynamic";

interface CompanyWikiPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CompanyWikiPage({ searchParams }: CompanyWikiPageProps) {
  return runOverviewPagesRequest(() => renderCompanyWikiPage({ searchParams }));
}
async function renderCompanyWikiPage({ searchParams }: CompanyWikiPageProps) {
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

  // 사업자등록증 정보(PII)는 여기서 전체를 한 번에 내려보내지 않는다 — 기업위키가 전체
  // 워크스페이스에 열려 있어서, 상세를 열 때 CompanyWiki가 그 기업 것만 따로 불러온다.
  // 운영 상세의 "기업 위키로 이동"은 ?companyId=…&company=…로 들어와 그 기업 상세를 바로 연다.
  const params = await searchParams;
  const initialCompany = {
    companyId: firstParam(params.companyId),
    name: firstParam(params.company)
  };
  return <CompanyWiki entries={entries} initialCompany={initialCompany} loadFailed={loadFailed} />;
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}
