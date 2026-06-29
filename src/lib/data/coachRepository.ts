import type {
  CoachDetail,
  CoachEngagementView,
  CoachScheduleView,
  CoachSummary,
  DateRange
} from "./coachTypes";

export interface CoachRepository {
  listCoaches(): Promise<CoachSummary[]>;
  getCoachById(id: string): Promise<CoachDetail | null>;
  listEngagements(coachId: string): Promise<CoachEngagementView[]>;
  listSchedules(coachId: string, range: DateRange): Promise<CoachScheduleView[]>;
}
