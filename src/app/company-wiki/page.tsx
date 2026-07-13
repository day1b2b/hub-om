import { CompanyWiki } from "@/features/wiki/CompanyWiki";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";

export const dynamic = "force-dynamic";

export default async function CompanyWikiPage() {
  await requireWorkspaceSession();

  return <CompanyWiki />;
}
