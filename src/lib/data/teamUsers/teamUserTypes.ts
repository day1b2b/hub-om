export type TeamUserRole = "ld" | "om";

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
