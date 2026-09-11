import { OperationDashboard, type OmRosterEntry } from "@/features/operations/OperationDashboard";
import { isAdminEmail } from "@/lib/auth/requireAdminSession";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { resolveOmNameByEmail } from "@/lib/data/myOperations";
import { normalizePersonKey } from "@/lib/data/roleAssignees";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import type { TeamUser } from "@/lib/data/teamUsers/teamUserTypes";
import { filterOperationsByTeamScope, resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface OperationsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OperationsPage({ searchParams }: OperationsPageProps) {
  const session = await requireWorkspaceSession();

  const repository = getOperationRepository();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const [operations, ownerRoster, teamUsers, params, myOmName] = await Promise.all([
    repository.listOperations(),
    teamMemberRepository.listResourceOwners(),
    listTeamUsers(),
    searchParams,
    // 로그인한 사람의 OM 이름. 내 대시보드(/me)와 같은 규칙을 쓴다 — 매핑을 두 벌 만들지 않는다.
    resolveOmNameByEmail(session.user?.email)
  ]);
  const teamScope = resolveTeamScope(params, session, ownerRoster);
  const scopedOperations = filterOperationsByTeamScope(operations, teamScope, ownerRoster);
  const partByPersonKey = buildPartByPersonKey(teamUsers);
  const omRoster = buildOmRoster(teamUsers);
  const myTeamUser = findMyTeamUser(teamUsers, session.user?.email);
  // 관리자·LD는 "본인 파트" 기준으로 보는 게 자연스럽고, OM 담당 과정 명의는 의미가 없다
  // (관리자 겸 OM이어도 관리자 권한이 우선). 그 외(순수 OM)는 기존처럼 본인 담당 과정 기준.
  const preferPartFilter = isAdminEmail(session.user?.email) || myTeamUser?.role === "ld";
  const defaultPartFilter = preferPartFilter ? myTeamUser?.team ?? null : null;

  return (
    <OperationDashboard
      defaultPartFilter={defaultPartFilter}
      myOmName={myOmName}
      omRoster={omRoster}
      operations={scopedOperations}
      partByPersonKey={partByPersonKey}
      preferPartFilter={preferPartFilter}
      teamScope={teamScope}
    />
  );
}

function findMyTeamUser(teamUsers: TeamUser[], email: null | string | undefined): TeamUser | undefined {
  const target = (email ?? "").trim().toLowerCase();
  if (!target) return undefined;
  return teamUsers.find((user) => user.email.trim().toLowerCase() === target);
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

/** 파트 필터/OM 필터 옵션은 운영 데이터가 아니라 멤버관리에 등록된 OM만 기준으로 삼는다. */
function buildOmRoster(teamUsers: Awaited<ReturnType<typeof listTeamUsers>>): OmRosterEntry[] {
  return teamUsers
    .filter((user) => user.role === "om" && user.name)
    .map((user) => ({ name: user.name, team: user.team ?? null }));
}
