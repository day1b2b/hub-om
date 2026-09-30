export interface ActivityPruneBatch {
  requests: number;
  changes: number;
}
/** Existing retention policy: one atomic batch, at most 1000 rows per model. */
export interface ActivityPruneRepository {
  pruneBatch(): Promise<ActivityPruneBatch>;
  close(): Promise<void>;
}
