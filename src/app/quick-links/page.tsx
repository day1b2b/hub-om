import { QuickLinksPage } from "@/features/quickLinks/QuickLinksPage";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";

export default async function Page() {
  await requireAdminSession();

  return <QuickLinksPage teamScope="both" />;
}
