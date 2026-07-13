import { MyDashboard } from "@/features/dashboard/MyDashboard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { filterOmRequestsByAssignee, filterOperationsByOm, resolveOmNameByEmail } from "@/lib/data/myOperations";
import { listOmRequests } from "@/lib/data/omRequest/omRequestLocalRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function MyDashboardPage() {
  const session = await requireWorkspaceSession();
  const omName = resolveOmNameByEmail(session.user?.email);

  if (!omName) {
    return <MyDashboard assignedRequests={[]} omName={null} operations={[]} />;
  }

  const repository = getOperationRepository();
  const operations = await repository.listOperations();
  const myOperations = filterOperationsByOm(operations, omName);
  const assignedRequests = filterOmRequestsByAssignee(listOmRequests(), omName);

  return <MyDashboard assignedRequests={assignedRequests} omName={omName} operations={myOperations} />;
}
