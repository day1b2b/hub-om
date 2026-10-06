import { CompanyWiki } from "@/features/wiki/CompanyWiki";
import { aggregateCompanies, type CompanyWikiEntry } from "@/features/wiki/companyWikiModel";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function CompanyWikiPage() {
  await requireAdminSession();

  // 기업 목록·코스·이력은 운영 현황에서 온다. 전에는 하드코딩 배열이었다.
  let entries: CompanyWikiEntry[] = [];
  let loadFailed = false;

  try {
    const operations = await getOperationRepository().listOperations();
    entries = aggregateCompanies(operations);
  } catch {
    loadFailed = true;
  }

  return <CompanyWiki entries={entries} loadFailed={loadFailed} />;
}
