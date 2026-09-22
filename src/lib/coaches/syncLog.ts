import { getCoachSyncLogRepository } from "@/lib/data/coachSyncLogRepositoryFactory";
import type { SyncResult } from "./syncTypes";

export async function runCoachSyncWithLog(
  type: string,
  triggeredBy: string,
  sync: () => Promise<SyncResult>
): Promise<SyncResult> {
  const repository = getCoachSyncLogRepository();
  const log = await repository.start(type, triggeredBy);

  try {
    const result = await sync();
    await repository.finish(log.id, {
        status: result.errors > 0 ? "completed_with_errors" : "completed",
        totalRows: result.totalRows,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        errorDetail: result.errorDetail.slice(0, 20).join("\n") || null,
        finishedAt: new Date()
    });
    return result;
  } catch (error) {
    await repository.finish(log.id, {
        status: "failed",
        errors: 1,
        errorDetail: "COACH_SYNC_FAILED",
        finishedAt: new Date()
    });
    throw error;
  }
}
