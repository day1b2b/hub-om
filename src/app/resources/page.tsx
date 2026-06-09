import { ResourceJudgmentPage } from "@/features/resources/ResourceJudgmentPage";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  await requireWorkspaceSession();

  const repository = getOperationRepository();
  const operations = await repository.listOperations();

  return <ResourceJudgmentPage operations={operations} />;
}
