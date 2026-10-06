import type { CoachTokenBackfillSummary } from "./coachAccessTokenBackfill";

/** Maintenance job contract; the caller supplies backup/maintenance confirmation.
 * Only counts leave this boundary, never tokens or archived source rows.
 */
export interface CoachTokenBackfillRepository {
  backfill(options: { apply: boolean }): Promise<CoachTokenBackfillSummary>;
}
