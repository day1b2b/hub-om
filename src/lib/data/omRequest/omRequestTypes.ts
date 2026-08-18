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

  // 접수 시점에 courseId 없이 자동 생성한 운영현황 회차(첫 차수)의 operationId.
  // 생성 자체가 실패하면 비어 있을 수 있다(omRequestOperationLink.ts 참고).
  operationId?: string;

  // Slack 알림 연동. 요청 생성 시 발송한 알림 메시지의 채널/스레드를 저장해
  // 배정 시 같은 스레드에 댓글로 태깅한다. LD 이메일은 세션에서만 얻을 수 있어
  // 배정 시점 태깅을 위해 생성 시점에 함께 저장한다. (모두 선택 필드 · 미설정 시 알림 skip)
  ldEmail?: string;
  slackChannel?: string;
  slackThreadTs?: string;

  team: string;
  ld: string;
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
}

export type OmRequestInput = Omit<
  OmRequest,
  "id" | "createdAt" | "status" | "assignedOm" | "operationId" | "ldEmail" | "slackChannel" | "slackThreadTs"
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
