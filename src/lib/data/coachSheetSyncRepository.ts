import type { CoachEngagementStatus } from "./coachEngagementRepository";
export interface SheetPrivateFields { employeeId: string | null; email: string | null; phone: string | null }
export interface SheetSyncCoach { id: string; name: string; workType: string | null; privateProfile: SheetPrivateFields | null }
export interface SheetCoachCreate { id: string; sourceCoachId: string; accessToken: string; name: string; normalizedName: string; workType: string | null; dxTag?: string; privateProfile: SheetPrivateFields }
export interface SheetEngagementWrite { sourceEngagementId: string; coachId: string; courseName: string; status: CoachEngagementStatus; source: "SHEET"; startDate: Date; endDate: Date; startTime: string | null; endTime: string | null; hiredByText: string | null }
export interface SheetEngagementIdentity { id: string; coachId: string }
export interface SheetEngagementMatch { sourceEngagementId: string; coachId: string; courseName: string; startDate: Date; endDate: Date }
export interface SheetScheduleWrite { sourceEngagementScheduleId: string; engagementId: string; coachId: string; date: Date; startTime: string; endTime: string }
export interface SheetReservationConfirmation { coachId: string; date: Date; engagementId: string }
export interface CoachSheetSyncReader {
  findLiveCoachByName(name: string): Promise<SheetSyncCoach | null>;
  listLiveCoaches(): Promise<SheetSyncCoach[]>;
  getCoach(coachId: string): Promise<SheetSyncCoach | null>;
  findMatchingEngagement(match: SheetEngagementMatch): Promise<SheetEngagementIdentity | null>;
  listReservationCoachIdsForEngagements(ids: string[]): Promise<string[]>;
  listEngagementsByCourseNames(names: string[]): Promise<SheetEngagementIdentity[]>;
}
export interface CoachSheetSyncTransaction extends CoachSheetSyncReader {
  lockCoaches(coachIds: string[]): Promise<void>;
  createCoach(input: SheetCoachCreate): Promise<SheetSyncCoach>;
  patchCoach(coachId: string, patch: { workType: string | null; dxTag?: string }): Promise<void>;
  upsertPrivateProfile(coachId: string, create: SheetPrivateFields, patch: Partial<SheetPrivateFields>): Promise<void>;
  createEngagement(input: SheetEngagementWrite): Promise<SheetEngagementIdentity>;
  patchEngagement(engagementId: string, input: Omit<SheetEngagementWrite, "coachId">): Promise<void>;
  replaceSchedules(engagementId: string, rows: SheetScheduleWrite[]): Promise<void>;
  /** Cascade schedules and clear confirmedEngagementId references, matching PostgreSQL FK actions. */
  deleteEngagements(engagementIds: string[]): Promise<void>;
  cancelReservations(entries: SheetReservationConfirmation[]): Promise<void>;
}
export interface CoachSheetSyncRepository extends CoachSheetSyncReader {
  /** Acquire catalog guard before invoking work; source reads never execute inside this transaction. */
  transaction<T>(work: (tx: CoachSheetSyncTransaction) => Promise<T>, options?: { timeoutMs?: number }): Promise<T>;
}
export interface CoachSheetSource {
  readContract(): Promise<{ values: string[][]; struckCells: Set<string> }>;
  readSamsung(): Promise<{ rows: string[][]; contractRows: string[][] }>;
}
