export interface CoachArchiveServiceBackfillSummary {
  coachRows: number;
  changedCoaches: number;
  accessLogRows: number;
  updatedCoaches: number;
  upsertedAccessLogs: number;
}

/** Maintenance-only boundary. Only aggregate counts may leave the repository. */
export interface CoachArchiveServiceBackfillRepository {
  backfill(options: { apply: boolean }): Promise<CoachArchiveServiceBackfillSummary>;
}
