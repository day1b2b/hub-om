import { OperationDashboard } from "@/features/operations/OperationDashboard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  await requireWorkspaceSession();

  const repository = getOperationRepository();
  const [operations, summary] = await Promise.all([repository.listOperations(), repository.getSummary()]);

  return <OperationDashboard operations={operations} summary={summary} />;
}
