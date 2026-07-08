import { OperationDashboard } from "@/features/operations/OperationDashboard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { filterOperationsByTeamScope, resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface OperationsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OperationsPage({ searchParams }: OperationsPageProps) {
  const session = await requireWorkspaceSession();

  const repository = getOperationRepository();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const [operations, ownerRoster, params] = await Promise.all([
    repository.listOperations(),
    teamMemberRepository.listResourceOwners(),
    searchParams
  ]);
  const teamScope = resolveTeamScope(params, session, ownerRoster);
  const scopedOperations = filterOperationsByTeamScope(operations, teamScope, ownerRoster);

  return <OperationDashboard operations={scopedOperations} teamScope={teamScope} />;
}
