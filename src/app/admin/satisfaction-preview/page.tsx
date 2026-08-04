import { SatisfactionMatchPreview } from "@/features/admin/SatisfactionMatchPreview";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";

export const dynamic = "force-dynamic";

export default async function SatisfactionPreviewPage() {
  await requireWorkspaceSession();
  return <SatisfactionMatchPreview />;
}
