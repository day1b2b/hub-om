import { OperationDashboard } from "@/features/operations/OperationDashboard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { normalizePersonKey } from "@/lib/data/roleAssignees";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { filterOperationsByTeamScope, resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface OperationsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OperationsPage({ searchParams }: OperationsPageProps) {
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
  const partByPersonKey = buildPartByPersonKey(teamUsers);

  return (
    <OperationDashboard operations={scopedOperations} partByPersonKey={partByPersonKey} teamScope={teamScope} />
  );
}

/**
 * 멤버관리(TeamUser)의 "팀"(AX N파트) 값을 이름 기준으로 조회할 수 있게 정규화한 맵으로 만든다.
 * 운영현황의 OM/LD 이름 표기가 멤버관리 등록명과 완전히 같지 않을 수 있어 normalizePersonKey로 비교한다.
 */
function buildPartByPersonKey(teamUsers: Awaited<ReturnType<typeof listTeamUsers>>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const user of teamUsers) {
    if (!user.team) continue;
    map[normalizePersonKey(user.name)] = user.team;
  }
  return map;
}
