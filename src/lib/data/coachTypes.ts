export type CoachStatusValue = "pending" | "active" | "inactive";

export type CoachEngagementStatusValue =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface DateRange {
  from: string;
  to: string;
}

export interface CoachSummary {
  id: string;
  name: string;
  workType: string | null;
  status: CoachStatusValue;
  isActive: boolean;
}

export interface CoachDetail extends CoachSummary {
  fields: string[];
  curriculums: string[];
}

export interface CoachEngagementView {
  id: string;
  courseName: string;
  operationSessionId: string | null;
  status: CoachEngagementStatusValue;
  source: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  rating: number | null;
  rehire: boolean | null;
}

export interface CoachScheduleView {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
}

// =============================================================================
// PRIVATE — admin 전용. 아래 타입은 민감(PII) 데이터를 담는다.
// 공개 repository/타입에서는 절대 노출하지 않는다. (CoachPrivateRepository 전용)
// =============================================================================

export interface CoachPrivateProfileView {
  coachId: string;
  employeeId: string | null;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  affiliation: string | null;
}

export interface CoachEngagementFeedbackView {
  engagementId: string;
  feedback: string | null;
  hiredByText: string | null;
}
