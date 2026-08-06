export type TeamUserRole = "ld" | "om";

export const TEAM_OPTIONS = ["AX 1파트", "AX 2파트", "AX 3파트"] as const;
export type TeamOption = (typeof TEAM_OPTIONS)[number];

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  slackId: string;
  team?: string;
  role?: TeamUserRole;
  createdAt: string;
}

export type TeamUserInput = Omit<TeamUser, "id" | "createdAt">;
