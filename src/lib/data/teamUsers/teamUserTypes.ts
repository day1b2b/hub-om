export type TeamUserRole = "ld" | "om";
export type TeamUserStatus = "active" | "departed";

export const TEAM_OPTIONS = ["AX 1파트", "AX 2파트", "AX 3파트"] as const;
export type TeamOption = (typeof TEAM_OPTIONS)[number];

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  slackId: string;
  team?: string;
  role?: TeamUserRole;
  /** 기존 행에 값이 없을 수 있어 읽는 쪽에서 undefined를 "active"로 간주한다. */
  status?: TeamUserStatus;
  createdAt: string;
}

export type TeamUserInput = Omit<TeamUser, "id" | "createdAt" | "status">;
