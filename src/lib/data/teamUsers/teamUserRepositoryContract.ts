import type { TeamUser, TeamUserInput, TeamUserRole } from "./teamUserTypes";

/** Existing application boundary; storage selection must not change caller authorization. */
export interface TeamUserRepository {
  listTeamUsers(): Promise<TeamUser[]>;
  findTeamUsersByEmail(email: string | null | undefined): Promise<TeamUser[]>;
  createTeamUser(input: TeamUserInput): Promise<TeamUser>;
  deleteTeamUsers(ids: string[]): Promise<number>;
  updateTeamUserTeam(id: string, team: string | null): Promise<TeamUser | null>;
  updateTeamUsersRole(ids: string[], role: TeamUserRole): Promise<number>;
  /** Legacy maintenance only: exact current label match, never an id-only overwrite. */
  countTeamUsersByTeam?(team: string): Promise<number>;
  renameTeamUsers?(from: string, to: string): Promise<number>;
}
