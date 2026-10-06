export type TeamMemberImportRole = "OM" | "LD";
export type TeamMemberImportSourceTeam = "TEAM_1" | "TEAM_2" | null;

export interface TeamMemberImportEntry {
  name: string;
  normalizedName: string;
  role: TeamMemberImportRole;
  sourceTeam: TeamMemberImportSourceTeam;
  roleTitle: string | null;
  calendarId: string | null;
  displayOrder: number;
}

export interface TeamMemberImportResult {
  total: number;
  inserted: number;
  updated: number;
  deactivated: number;
}

export interface TeamMemberImportRepository {
  importMembers(entries: readonly TeamMemberImportEntry[], apply: boolean): Promise<TeamMemberImportResult>;
}
