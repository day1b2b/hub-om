import { getCoachNotionSource, getCoachNotionSyncRepository } from "../data/coachNotionSyncRepositoryFactory";
import { getCoachSheetSource, getCoachSheetSyncRepository } from "../data/coachSheetSyncRepositoryFactory";
import { getCoachSyncLogRepository } from "../data/coachSyncLogRepositoryFactory";

/** Resolve the whole requested scope before any source read or run-log/business write. */
export function assertCoachSyncReady(kind: "notion" | "all", dryRun: boolean): void {
  getCoachNotionSyncRepository();
  getCoachNotionSource();
  if (kind === "all") { getCoachSheetSyncRepository(); getCoachSheetSource(); }
  if (!dryRun) getCoachSyncLogRepository();
}
