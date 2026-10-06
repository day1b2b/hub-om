import { getDataRepositoryOverride } from "../dataRepositoryContext";
import type { TeamUserRepository } from "./teamUserRepositoryContract";
import type { TeamUser, TeamUserInput, TeamUserRole } from "./teamUserTypes";
export { DuplicateTeamUserEmailError } from "./teamUserErrors";

async function repository(): Promise<TeamUserRepository> {
  const override = getDataRepositoryOverride("teamUsers");
  // Do not import the PG/local adapter or fall back after an override fails.
  return override ?? await import("./legacyTeamUserRepository");
}

export async function listTeamUsers(): Promise<TeamUser[]> {
  return (await repository()).listTeamUsers();
}
export async function findTeamUsersByEmail(email: string | null | undefined): Promise<TeamUser[]> {
  return (await repository()).findTeamUsersByEmail(email);
}
export async function createTeamUser(input: TeamUserInput): Promise<TeamUser> {
  return (await repository()).createTeamUser(input);
}
export async function deleteTeamUsers(ids: string[]): Promise<number> {
  return (await repository()).deleteTeamUsers(ids);
}
export async function updateTeamUserTeam(id: string, team: string | null): Promise<TeamUser | null> {
  return (await repository()).updateTeamUserTeam(id, team);
}
export async function updateTeamUsersRole(ids: string[], role: TeamUserRole): Promise<number> {
  return (await repository()).updateTeamUsersRole(ids, role);
}
