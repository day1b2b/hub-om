import type { SourceTeam } from "./operationTypes";

export type ResourceOwnerRoster = Partial<Record<SourceTeam, string[]>>;
export type TeamMemberRole = "om" | "ld";
export type TeamMemberRoleRoster = Record<TeamMemberRole, ResourceOwnerRoster>;

export const EMPTY_TEAM_MEMBER_ROLE_ROSTER: TeamMemberRoleRoster = {
  ld: {},
  om: {}
};

export interface TeamMemberRepository {
  listResourceOwners(): Promise<ResourceOwnerRoster>;
  listRoleRosters(): Promise<TeamMemberRoleRoster>;
}

export class EmptyTeamMemberRepository implements TeamMemberRepository {
  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    return {};
  }

  async listRoleRosters(): Promise<TeamMemberRoleRoster> {
    return EMPTY_TEAM_MEMBER_ROLE_ROSTER;
  }
}
