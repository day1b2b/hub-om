import { CompanyWiki } from "@/features/wiki/CompanyWiki";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";

export const dynamic = "force-dynamic";

export default async function CompanyWikiPage() {
  await requireAdminSession();

  return <CompanyWiki />;
}
