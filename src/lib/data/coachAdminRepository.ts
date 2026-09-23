import type { CoachStatus } from "@prisma/client";

/** Storage contract of the coach tag-master and deleted-coach admin APIs.
 * Authentication, authorization and response shaping remain the routes' responsibility.
 */
export type CoachMasterKind = "fields" | "curriculums";
export interface CoachMasterTag { id: string; name: string }
export interface DeletedCoach { id: string; name: string; workType: string | null; status: CoachStatus; deletedAt: Date | null; deletedBy: string | null }
export interface CoachAdminRepository {
  listMasters(kind: CoachMasterKind): Promise<CoachMasterTag[]>;
  /** Existing name returns the existing tag unchanged (upsert with an empty update). */
  ensureMaster(kind: CoachMasterKind, name: string): Promise<CoachMasterTag>;
  listDeletedCoaches(): Promise<DeletedCoach[]>;
  /** Clears the soft-delete markers of any existing coach; a missing coach throws. */
  restoreCoach(id: string): Promise<{ id: string; name: string }>;
  /** Existing permanent delete: only soft-deleted coaches, with the schema's Cascade/SetNull children.
   * Returns false when the coach is missing or not soft-deleted. */
  purgeDeletedCoach(id: string): Promise<boolean>;
}
