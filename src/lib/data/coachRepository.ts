import type {
  CoachDetail,
  CoachEngagementView,
  CoachScheduleDashboard,
  CoachScheduleView,
  CoachSummary,
  DateRange
} from "./coachTypes";

export interface CoachRepository {
  listCoaches(): Promise<CoachSummary[]>;
  getCoachById(id: string): Promise<CoachDetail | null>;
  listEngagements(coachId: string): Promise<CoachEngagementView[]>;
  listSchedules(coachId: string, range: DateRange): Promise<CoachScheduleView[]>;
  getScheduleDashboard(yearMonth: string): Promise<CoachScheduleDashboard>;
}
