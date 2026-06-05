import { OperationDashboard } from "@/features/operations/OperationDashboard";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function Home() {
  const repository = getOperationRepository();
  const [operations, summary] = await Promise.all([repository.listOperations(), repository.getSummary()]);

  return <OperationDashboard operations={operations} summary={summary} />;
}
