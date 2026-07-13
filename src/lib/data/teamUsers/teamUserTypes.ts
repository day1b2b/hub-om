export interface TeamUser {
  id: string;
  name: string;
  email: string;
  slackId: string;
  team?: string;
  createdAt: string;
}

export type TeamUserInput = Omit<TeamUser, "id" | "createdAt">;
