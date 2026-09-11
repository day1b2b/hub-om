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
  const defaultPartFilter = resolveDefaultPartFilter(teamUsers, session.user?.email);

  return (
    <OperationDashboard
      defaultPartFilter={defaultPartFilter}
      myOmName={myOmName}
      omRoster={omRoster}
      operations={scopedOperations}
      partByPersonKey={partByPersonKey}
      teamScope={teamScope}
    />
  );
}

/**
 * OM은 기존대로 "본인 담당 과정" 기준 기본값을 쓰고(OperationDashboard 내부 로직),
 * LD와 관리자는 담당 과정 명의가 없거나 의미가 없어 파트 단위로 보는 게 자연스럽다.
 * 그래서 로그인한 사람이 멤버관리에 LD로 등록돼 있거나 관리자 계정이면, 본인 소속 파트를
 * 파트 필터 기본값으로 돌려준다. 관리자 권한이 최우선이라, OM으로 등록돼 있어도 관리자
 * 계정이면 파트 필터를 우선 적용한다. 소속 파트를 모르면 null(=전체 파트 유지)을 돌려준다.
 */
function resolveDefaultPartFilter(teamUsers: TeamUser[], email: null | string | undefined): null | string {
  const target = (email ?? "").trim().toLowerCase();
  if (!target) return null;

  const myTeamUser = teamUsers.find((user) => user.email.trim().toLowerCase() === target);
  const shouldDefaultToPart = isAdminEmail(email) || myTeamUser?.role === "ld";
  return shouldDefaultToPart ? myTeamUser?.team ?? null : null;
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
