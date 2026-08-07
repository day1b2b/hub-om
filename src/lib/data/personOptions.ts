import type { OperationSession, SourceTeam } from "./operationTypes";
import { splitPersonNames } from "./personNames";
import type { ResourceOwnerRoster, TeamMemberRoleRoster } from "./teamMemberRepository";

export interface PersonOptions {
  ld: string[];
  om: string[];
}

export function buildPersonOptions(roleRoster: TeamMemberRoleRoster): PersonOptions {
  return {
    ld: unique(Object.values(roleRoster.ld).flatMap((owners) => owners ?? [])),
    om: unique(Object.values(roleRoster.om).flatMap((owners) => owners ?? []))
  };
}

export function buildRoleRosterFromOperations(operations: OperationSession[]): TeamMemberRoleRoster {
  return operations.reduce<TeamMemberRoleRoster>(
    (roster, operation) => {
      const sourceTeam = operation.sourceTeam;
      if (!isKnownSourceTeam(sourceTeam)) return roster;

      roster.om[sourceTeam] = unique([...(roster.om[sourceTeam] ?? []), ...splitPersonNames(operation.om, "")]);
      roster.ld[sourceTeam] = unique([...(roster.ld[sourceTeam] ?? []), ...splitPersonNames(operation.ld, "")]);
      return roster;
    },
    { ld: {}, om: {} }
  );
}

export function mergeRoleRosters(primary: TeamMemberRoleRoster, fallback: TeamMemberRoleRoster): TeamMemberRoleRoster {
  return {
    ld: hasRosterMembers(primary.ld) ? primary.ld : fallback.ld,
    om: hasRosterMembers(primary.om) ? primary.om : fallback.om
  };
}

function hasRosterMembers(roster: ResourceOwnerRoster) {
  return Object.values(roster).some((owners) => (owners ?? []).length > 0);
}

function isKnownSourceTeam(sourceTeam: SourceTeam | undefined): sourceTeam is "1팀" | "2팀" {
  return sourceTeam === "1팀" || sourceTeam === "2팀";
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko-KR"));
}
