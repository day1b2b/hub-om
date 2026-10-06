/** Existing authorized coach JSON export, not a complete database recovery backup. */
export const ADMIN_BACKUP_MODELS = {
  coaches: "Coach",
  privateProfiles: "CoachPrivateProfile",
  fields: "CoachFieldMaster",
  curriculums: "CoachCurriculumMaster",
  coachFields: "CoachField",
  coachCurriculums: "CoachCurriculum",
  schedules: "CoachSchedule",
  scheduleAccessLogs: "CoachScheduleAccessLog",
  engagements: "CoachEngagement",
  engagementSchedules: "CoachEngagementSchedule",
  importRuns: "CoachImportRun"
} as const;
export type AdminBackupRow = Record<string, unknown>;
export interface AdminBackupSnapshot {
  id: string;
  table_count: number;
  row_count: number;
  status: string;
  started_at: Date;
  finished_at: Date | null;
}
export type AdminBackupData = {
  -readonly [K in keyof typeof ADMIN_BACKUP_MODELS]: AdminBackupRow[];
} & { archiveSnapshots: AdminBackupSnapshot[] };
export interface AdminBackupRepository {
  read(): Promise<AdminBackupData>;
}
