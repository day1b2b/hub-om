import type { SourceTeam } from "./operationTypes";

export type ResourceOwnerRoster = Partial<Record<SourceTeam, string[]>>;
export type TeamMemberRole = "om" | "ld";
export type TeamMemberRoleRoster = Record<TeamMemberRole, ResourceOwnerRoster>;

export const EMPTY_TEAM_MEMBER_ROLE_ROSTER: TeamMemberRoleRoster = {
  ld: {},
  om: {}
};

export interface TeamMemberRecord {
  id: string;
  name: string;
  role: TeamMemberRole | null;
  sourceTeam: SourceTeam | null;
  roleTitle: string | null;
  isActive: boolean;
  displayOrder: number | null;
}

export interface TeamMemberRepository {
  listResourceOwners(): Promise<ResourceOwnerRoster>;
  listRoleRosters(): Promise<TeamMemberRoleRoster>;
  listMembers(): Promise<TeamMemberRecord[]>;
}

export class EmptyTeamMemberRepository implements TeamMemberRepository {
  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    return {};
  }

  async listRoleRosters(): Promise<TeamMemberRoleRoster> {
    return EMPTY_TEAM_MEMBER_ROLE_ROSTER;
  }

  async listMembers(): Promise<TeamMemberRecord[]> {
    return [];
  }
}
