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
  deletedAt: string | null;
  fields: string[];
  avgRating: number | null;
  workDayCount: number;
}

export interface CoachDetail extends CoachSummary {
  curriculums: string[];
  coachInputUrl: string | null;
  statusNote: string | null;
  returnDate: string | null;
  availabilityDetail: string | null;
  dxTag: string | null;
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
  feedback: string | null;
}

export interface CoachScheduleView {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface CoachEngagementScheduleView {
  id: string;
  engagementId: string;
  courseName: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface CoachScheduleDashboardEngagement {
  courseName: string;
  endDate: string;
}

export interface CoachDayReservationView {
  reservedByName: string;
  reservedByEmail: string;
}

export interface CoachScheduleDashboardCoach {
  id: string;
  name: string;
  workType: string | null;
  fields: string[];
  schedules: Array<{
    startTime: string;
    endTime: string;
  }>;
  avgRating: number | null;
  recentEngagements: CoachScheduleDashboardEngagement[];
  engagementCount: number;
  reservation: CoachDayReservationView | null;
}

export interface CoachScheduleDashboardDay {
  date: string;
  coaches: CoachScheduleDashboardCoach[];
}

export interface CoachScheduleDashboard {
  yearMonth: string;
  totalActiveCoaches: number;
  days: Record<string, CoachScheduleDashboardDay>;
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
