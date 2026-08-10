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
  company: string;
  businessNumber?: string;
  trainingType: TrainingType;
  courseId: string;
  courseName: string;
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

export type OmRequestInput = Omit<OmRequest, "id" | "createdAt" | "status" | "assignedOm">;

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
