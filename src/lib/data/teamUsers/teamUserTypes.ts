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
  /** TeamUser에 저장되는 값이 아니라 TeamUserDeparture 기록 유무로 계산되는 화면용 값이다.
   * 퇴사 기록이 없으면 undefined(= "active"로 간주)다. */
  status?: TeamUserStatus;
  createdAt: string;
}

export type TeamUserInput = Omit<TeamUser, "id" | "createdAt" | "status">;
