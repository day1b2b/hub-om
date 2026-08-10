import { QuickLinksPage } from "@/features/quickLinks/QuickLinksPage";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";

export default async function Page() {
  await requireWorkspaceSession();

  return <QuickLinksPage teamScope="both" />;
}
