import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getActivityPruneRepository } from "./activityPruneFactory";

export interface ActivityPruneSummary {
  deletedRequests: number;
  deletedChanges: number;
}

export async function runActivityPruneCommand(
  loadEnvironment: () => void,
  writeSummary: (summary: ActivityPruneSummary) => void = () => {},
): Promise<ActivityPruneSummary> {
  try {
    const scoped = getDataRepositoryOverride("activityPrune");
    if (!scoped) loadEnvironment();
    const repository = scoped ?? getActivityPruneRepository();
    try {
      let requests = 0;
      let changes = 0;
      for (;;) {
        const result = await repository.pruneBatch();
        for (const count of [result.requests, result.changes]) {
          if (!Number.isInteger(count) || count < 0 || count > 1000) {
            throw new Error("ACTIVITY_PRUNE_FAILED");
          }
        }
        requests += result.requests;
        changes += result.changes;
        if (result.requests < 1000 && result.changes < 1000) break;
      }
      const summary = { deletedRequests: requests, deletedChanges: changes };
      // Preserve the original CLI's summary-before-disconnect order.
      writeSummary(summary);
      return summary;
    } finally {
      await repository.close();
    }
  } catch {
    throw new Error("ACTIVITY_PRUNE_FAILED");
  }
}
