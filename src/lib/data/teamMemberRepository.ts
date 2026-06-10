import type { SourceTeam } from "./operationTypes";

export type ResourceOwnerRoster = Partial<Record<SourceTeam, string[]>>;

export interface TeamMemberRepository {
  listResourceOwners(): Promise<ResourceOwnerRoster>;
}

export class EmptyTeamMemberRepository implements TeamMemberRepository {
  async listResourceOwners(): Promise<ResourceOwnerRoster> {
    return {};
  }
}
