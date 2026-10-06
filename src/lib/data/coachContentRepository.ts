/** Public logical fields only; no Prisma runtime or privacy storage/index companions. */
export type CoachContentKind = "NOTE" | "EDIT_HISTORY";
export interface CoachContentAuthor { email: string; name: string }
export interface CoachContentRecord {
  id: string;
  coachId: string;
  kind: CoachContentKind;
  content: string;
  authorEmail: string | null;
  authorName: string | null;
  sourceField: string | null;
  flaggedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export type CoachNoteListItem = Pick<CoachContentRecord, "id" | "content" | "authorName" | "flaggedAt" | "createdAt">;
export interface CoachContentFeedEntry extends Pick<CoachContentRecord, "id" | "kind" | "content" | "authorName" | "sourceField" | "flaggedAt" | "createdAt"> {
  coach: { id: string; name: string };
}
export interface CoachContentFeedReview {
  id: string;
  rating: number | null;
  feedback: string | null;
  courseName: string;
  createdAt: Date;
  reviewFlaggedAt: Date | null;
  coach: { id: string; name: string };
}
export interface CoachContentFeed {
  entries: CoachContentFeedEntry[];
  reviewedEngagements: CoachContentFeedReview[];
}
export interface CoachScheduleRegistrationData {
  coaches: Array<{ id: string; name: string; workType: string | null; accessToken: string | null }>;
  accessLogs: Array<{ coachId: string; lastEditedAt: Date | null }>;
}
export interface CoachScheduleStatusData {
  activeCoaches: Array<{ id: string; name: string }>;
  accessLogs: Array<{ coachId: string; accessedAt: Date; lastEditedAt: Date | null }>;
}
/** Auth, validation, response shaping and date serialization remain at the existing routes.
 * Writes preserve the original id+coachId lookup (no new kind/deleted filters), throw on
 * missing rows, and atomically append the same EDIT_HISTORY as the note mutation.
 * Profile/review logging remains PostgreSQL-only outside this scoped contract.
 */
export interface CoachContentRepository {
  /** Undeleted NOTE rows, createdAt descending. */
  listNotes(coachId: string): Promise<CoachNoteListItem[]>;
  createNote(coachId: string, content: string, author: CoachContentAuthor): Promise<CoachContentRecord>;
  updateNote(coachId: string, noteId: string, content: string, author: CoachContentAuthor): Promise<CoachContentRecord>;
  deleteNote(coachId: string, noteId: string, author: CoachContentAuthor): Promise<CoachContentRecord>;
  toggleNoteWarning(coachId: string, noteId: string, author: CoachContentAuthor): Promise<CoachContentRecord>;
  /** Two independent latest-300 queries: undeleted NOTE rows and engagements with
   * rating != null OR feedback != null. No deleted-coach/status filters or final limit. */
  getContentFeed(): Promise<CoachContentFeed>;
  /** ACTIVE, undeleted coaches sorted by normalizedName; logs for exactly yearMonth. */
  getScheduleRegistration(yearMonth: string): Promise<CoachScheduleRegistrationData>;
  getScheduleStatus(yearMonth: string): Promise<CoachScheduleStatusData>;
}
