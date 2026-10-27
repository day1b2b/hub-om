import type { OmStatusBackfillCounts } from "./omAssignmentStatusBackfillPlan";

/** Existing administrator corrections. Counting never reserves the later apply's targets. */
export interface OperationBackfillRepository {
  countOnsiteRequiredTargets(): Promise<number>;
  applyOnsiteRequiredBackfill(): Promise<number>;
  countOmAssignmentStatusTargets(): Promise<number>;
  /** Same targets as count, split by the status apply will set (see omStatusBackfillValue). */
  previewOmAssignmentStatusBackfill(): Promise<OmStatusBackfillCounts>;
  applyOmAssignmentStatusBackfill(): Promise<number>;
}
