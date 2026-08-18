export type TrainingType = "오프라인" | "블렌디드" | "비대면" | "해커톤";
export type YN = "Y" | "N";

export interface OmRequestSession {
  date: string;
  dateEnd?: string;
  timeStart: string;
  timeEnd: string;
  duration: string;
  location: string;
}

export interface OmRequest {
  id: string;
  createdAt: string;
  status: "배정필요" | "배정완료";
  assignedOm?: string;

  team: string;
  ld: string;
  ldEmail?: string;
  company: string;
  businessNumber?: string;
  trainingType: TrainingType;
  courseId: string;
  courseName: string;
  courseCategoryMajor?: string;
  courseCategory: string;
  tools?: string;
  instructorName: string;
  syncupLink: string;
  driveLink: string;
  skillfloSetup: YN;
  skillmatchSetup: YN;
  onSiteOperation: YN;
  coachRequest: YN;
  totalSessions: number;
  sessions: OmRequestSession[];
  notes: string;

  // 슬랙 알림 스레드 추적(서버가 생성 후 채움). 배정 시 같은 스레드에 댓글을 달기 위해 저장한다.
  slackChannel?: string;
  slackThreadTs?: string;
}

export type OmRequestInput = Omit<
  OmRequest,
  "id" | "createdAt" | "status" | "assignedOm" | "slackChannel" | "slackThreadTs"
>;

export function calcSessionDuration(timeStart: string, timeEnd: string): string {
  if (!timeStart || !timeEnd) return "";
  const [sh, sm] = timeStart.split(":").map(Number);
  const [eh, em] = timeEnd.split(":").map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return "";
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  if (endMinutes <= startMinutes) return "";
  const totalHours = (endMinutes - startMinutes) / 60;
  const adjusted = totalHours >= 7 ? totalHours - 1 : totalHours;
  return String(adjusted);
}

export function omRequestStatusLabel(status: OmRequest["status"]): string {
  return status === "배정완료" ? "지정완료" : "요청중";
}

// 파트별 지정 권한자. 이 매핑은 OM 지정(배정) 액션의 파트 관리자 확인에 쓰인다.
export function omRequestManagerName(team: string): string | null {
  if (team.includes("1파트")) return "김정선";
  if (team.includes("2파트")) return "조여경";
  if (team.includes("3파트")) return "이혜림";
  return null;
}

// 파트 구분 없이 모든 파트의 지정 권한을 갖는 이메일. 이현정(OM) 요청으로 추가됨.
const OM_REQUEST_ASSIGN_OVERRIDE_EMAILS = ["hyeonjeong.lee@day1company.co.kr"];

export function canManageOmRequestAssignment(team: string, userName: string, userEmail?: string | null): boolean {
  if (userEmail && OM_REQUEST_ASSIGN_OVERRIDE_EMAILS.includes(userEmail.trim().toLowerCase())) return true;
  const managerName = omRequestManagerName(team);
  if (!managerName) return true;
  return userName.trim() === managerName.trim();
}
