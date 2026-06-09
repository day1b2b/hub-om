import { ResourceJudgmentPage } from "@/features/resources/ResourceJudgmentPage";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const repository = getOperationRepository();
  const operations = await repository.listOperations();

  return <ResourceJudgmentPage operations={operations} />;
}
