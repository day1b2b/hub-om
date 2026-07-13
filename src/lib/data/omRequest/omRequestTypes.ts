export type TrainingType = "오프라인" | "블랜디드" | "비대면" | "해커톤";
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
  trainingType: TrainingType;
  courseId: string;
  courseName: string;
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
