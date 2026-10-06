/** Existing administrator corrections. Counting never reserves the later apply's targets. */
export interface OperationBackfillRepository {
  countOnsiteRequiredTargets(): Promise<number>;
  applyOnsiteRequiredBackfill(): Promise<number>;
  countOmAssignmentStatusTargets(): Promise<number>;
  applyOmAssignmentStatusBackfill(): Promise<number>;
}
