import type { OperationCandidate, ScheduleTimeRange } from "./operationMatch/matchOperation";

export interface CoachOperationMatchEngagement {
  id: string;
  courseName: string;
  coachName: string | null;
  startDate: Date;
  endDate: Date;
  startTime: string | null;
  endTime: string | null;
  scheduleDates: string[];
  scheduleTimes: ScheduleTimeRange[];
}

export interface CoachOperationMatchSnapshot {
  counts: { total: number; matched: number; unmatched: number };
  candidates: OperationCandidate[];
  engagements: CoachOperationMatchEngagement[];
}

export interface CoachOperationMatchRepository {
  readSnapshot(): Promise<CoachOperationMatchSnapshot>;
  applyMatches(matches: ReadonlyArray<{ engagementId: string; operationSessionId: string }>): Promise<number>;
}
