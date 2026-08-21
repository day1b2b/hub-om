import type { Session } from "next-auth";
import type { OperationSession, SourceTeam } from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";
import type { ResourceOwnerRoster, TeamMemberRoleRoster } from "@/lib/data/teamMemberRepository";

export type TeamScope = "both" | "team_1" | "team_2";

export const TEAM_SCOPE_OPTIONS: Array<{ label: string; value: TeamScope }> = [
  { label: "1+2팀", value: "both" },
  { label: "1팀", value: "team_1" },
  { label: "2팀", value: "team_2" }
];

const TEAM_SCOPE_TO_SOURCE_TEAM: Record<Exclude<TeamScope, "both">, SourceTeam> = {
  team_1: "1팀",
  team_2: "2팀"
};

export function parseTeamScope(value: string | string[] | undefined): TeamScope | null {
  const normalizedValue = Array.isArray(value) ? value[0] : value;

  if (normalizedValue === "team_1" || normalizedValue === "1" || normalizedValue === "1팀") return "team_1";
  if (normalizedValue === "team_2" || normalizedValue === "2" || normalizedValue === "2팀") return "team_2";
  if (normalizedValue === "both" || normalizedValue === "all" || normalizedValue === "1+2팀") return "both";

  return null;
}

export function resolveTeamScope(
  searchParams: Record<string, string | string[] | undefined>,
  session: Session,
  ownerRoster: ResourceOwnerRoster
): TeamScope {
  return parseTeamScope(searchParams.team) ?? getSessionTeamScope(session, ownerRoster) ?? "both";
}

export function filterOperationsByTeamScope(
  operations: OperationSession[],
  teamScope: TeamScope,
  ownerRoster: ResourceOwnerRoster
) {
  if (teamScope === "both") return operations;

  const sourceTeam = TEAM_SCOPE_TO_SOURCE_TEAM[teamScope];
  return operations.filter((operation) => resolveOperationSourceTeam(operation, ownerRoster) === sourceTeam);
}

export function filterOwnerRosterByTeamScope(ownerRoster: ResourceOwnerRoster, teamScope: TeamScope): ResourceOwnerRoster {
  if (teamScope === "both") {
    return {
      "1팀": ownerRoster["1팀"] ?? [],
      "2팀": ownerRoster["2팀"] ?? []
    };
  }

  const sourceTeam = TEAM_SCOPE_TO_SOURCE_TEAM[teamScope];
  return { [sourceTeam]: ownerRoster[sourceTeam] ?? [] };
}

export function filterRoleRosterByTeamScope(roleRoster: TeamMemberRoleRoster, teamScope: TeamScope): TeamMemberRoleRoster {
  return {
    ld: filterOwnerRosterByTeamScope(roleRoster.ld, teamScope),
    om: filterOwnerRosterByTeamScope(roleRoster.om, teamScope)
  };
}

/**
 * 팀 스코프는 1·2팀 시절 구분이어서, 멤버 관리에 "AX N파트"로 등록된 사람은
 * 미분류로 떨어져 스코프 필터에서 전부 걸러진다. 그 결과 담당자 선택 목록에
 * 실제 조직의 OM이 하나도 안 나오는 문제가 생긴다.
 * 선택 목록에서는 스코프와 무관하게 미분류를 항상 함께 보여준다.
 */
export function withUnclassifiedOwners(
  scopedRoleRoster: TeamMemberRoleRoster,
  fullRoleRoster: TeamMemberRoleRoster
): TeamMemberRoleRoster {
  return {
    ld: mergeUnclassified(scopedRoleRoster.ld, fullRoleRoster.ld),
    om: mergeUnclassified(scopedRoleRoster.om, fullRoleRoster.om)
  };
}

function mergeUnclassified(scoped: ResourceOwnerRoster, full: ResourceOwnerRoster): ResourceOwnerRoster {
  const unclassified = full["미분류"] ?? [];
  if (unclassified.length === 0) return scoped;

  return { ...scoped, "미분류": unclassified };
}

export function teamScopeSearchParam(teamScope: TeamScope) {
  if (teamScope === "both") return "";

  return `?team=${teamScope}`;
}

function getSessionTeamScope(session: Session, ownerRoster: ResourceOwnerRoster): TeamScope | null {
  const candidates = getSessionPersonCandidates(session);
  if (candidates.length === 0) return null;

  if ((ownerRoster["1팀"] ?? []).some((name) => candidates.includes(normalizePersonName(name)))) return "team_1";
  if ((ownerRoster["2팀"] ?? []).some((name) => candidates.includes(normalizePersonName(name)))) return "team_2";

  return null;
}

function getSessionPersonCandidates(session: Session) {
  const emailLocalPart = session.user?.email?.split("@")[0] ?? "";
  return [session.user?.name ?? "", emailLocalPart].map(normalizePersonName).filter(Boolean);
}

function resolveOperationSourceTeam(operation: OperationSession, ownerRoster: ResourceOwnerRoster): SourceTeam {
  if (operation.sourceTeam === "1팀" || operation.sourceTeam === "2팀") {
    return operation.sourceTeam;
  }

  const owners = splitPersonNames(operation.om, "");
  const teamOneOwners = new Set((ownerRoster["1팀"] ?? []).map(normalizePersonName));
  const teamTwoOwners = new Set((ownerRoster["2팀"] ?? []).map(normalizePersonName));
  const hasTeamOneOwner = owners.some((owner) => teamOneOwners.has(normalizePersonName(owner)));
  const hasTeamTwoOwner = owners.some((owner) => teamTwoOwners.has(normalizePersonName(owner)));

  if (hasTeamOneOwner && !hasTeamTwoOwner) return "1팀";
  if (hasTeamTwoOwner && !hasTeamOneOwner) return "2팀";

  return "미분류";
}

function normalizePersonName(value: string) {
  return value
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}
