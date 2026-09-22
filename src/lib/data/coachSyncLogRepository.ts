export interface CoachSyncLogUpdate {
  status: string; errors: number; finishedAt: Date;
  totalRows?: number; created?: number; updated?: number; skipped?: number; errorDetail: string | null;
}
export interface CoachSyncLogRepository {
  start(type: string, triggeredBy: string): Promise<{ id: string }>;
  finish(id: string, update: CoachSyncLogUpdate): Promise<void>;
}
