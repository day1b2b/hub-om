import { MainDashboard } from "@/features/dashboard/MainDashboard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { filterOperationsByTeamScope, resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface DashboardProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: DashboardProps) {
  const session = await requireWorkspaceSession();

  const repository = getOperationRepository();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const [operations, ownerRoster, teamUsers, params] = await Promise.all([
    repository.listOperations(),
    teamMemberRepository.listResourceOwners(),
    listTeamUsers(),
    searchParams
  ]);
  const teamScope = resolveTeamScope(params, session, ownerRoster);
  const scopedOperations = filterOperationsByTeamScope(operations, teamScope, ownerRoster);

  return <MainDashboard operations={scopedOperations} teamScope={teamScope} teamUsers={teamUsers} />;
}
