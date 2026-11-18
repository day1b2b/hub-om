/** Dates are UTC calendar strings; timestamps are ISO strings. Authorization stays at the route boundary. */
export interface CoachScheduleEntry { date: string; startTime: string; endTime: string }
export interface CoachScheduleItem extends CoachScheduleEntry { id: string }
export interface CoachScheduleEngagement {
  id: string;
  courseName: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
}
export interface CoachEngagementScheduleItem extends CoachScheduleEntry { courseName: string; status: string }
export interface CoachMonthSchedules {
  schedules: CoachScheduleItem[];
  engagements: CoachScheduleEngagement[];
  engagementSchedules: CoachEngagementScheduleItem[];
  lastSavedAt: string | null;
}
export interface CoachManagerMonthSchedules {
  schedules: CoachScheduleItem[];
  engagementSchedules: CoachEngagementScheduleItem[];
  accessLog: { yearMonth: string; accessedAt: string; lastEditedAt: string | null } | null;
}
export interface CoachDateReservation { date: string; reservedByName: string; reservedByEmail: string }
export interface CoachScheduleRepository {
  getCoachMonth(coachId: string, yearMonth: string): Promise<CoachMonthSchedules>;
  replaceCoachMonth(coachId: string, yearMonth: string, entries: CoachScheduleEntry[]): Promise<void>;
  getManagerMonth(coachId: string, yearMonth: string): Promise<CoachManagerMonthSchedules | null>;
  reserveDates(coachId: string, dates: string[], author: { name: string; email: string }): Promise<CoachDateReservation[] | null>;
  cancelDates(coachId: string, dates: string[], email: string): Promise<string[]>;
  /** 그 날짜에 (취소되지 않은) 매니저 예약이 잡힌 코치 ID들. 코치 추천에서 예약된 코치를 빼는 데 쓴다. */
  listReservedCoachIdsOn(date: string): Promise<string[]>;
}
