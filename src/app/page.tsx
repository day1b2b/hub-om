import { MainDashboard } from "@/features/dashboard/MainDashboard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireWorkspaceSession();

  const repository = getOperationRepository();
  const operations = await repository.listOperations();

  return <MainDashboard operations={operations} />;
}
