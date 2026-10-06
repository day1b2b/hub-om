export type CoachEngagementStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type CoachEngagementSource = "SHEET" | "MANUAL";
/** Explicit public logical fields: privacy storage/index companions never enter these DTOs. */
export interface CoachEngagementRecord {
  id: string;
  sourceEngagementId: string;
  coachId: string;
  operationSessionId: string | null;
  courseName: string;
  status: CoachEngagementStatus;
  source: CoachEngagementSource;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  rating: number | null;
  rehire: boolean | null;
  feedback: string | null;
  reviewFlaggedAt: string | null;
  hiredById: string | null;
  hiredByText: string | null;
  createdAt: string;
}
export type CoachEngagementRow = Omit<CoachEngagementRecord, "startDate" | "endDate" | "reviewFlaggedAt" | "createdAt"> & {
  startDate: Date; endDate: Date; reviewFlaggedAt: Date | null; createdAt: Date;
};
export type CoachEngagementListItem = Omit<CoachEngagementRecord, "status" | "source"> & {
  status: Lowercase<CoachEngagementStatus>; source: Lowercase<CoachEngagementSource>;
};
export interface CreateCoachEngagementInput {
  courseName: string;
  status: CoachEngagementStatus;
  startDate: Date;
  endDate: Date;
  startTime: string | null;
  endTime: string | null;
  rating: number | null;
  feedback: string | null;
  rehire: boolean | null;
  hiredByText: string | null;
}
export type UpdateCoachEngagementInput = Partial<Omit<CreateCoachEngagementInput, "courseName" | "startDate" | "endDate">> & {
  courseName?: string | null; startDate?: Date | null; endDate?: Date | null;
};
export type CoachReviewCommand = { action: "toggleFlag" } | { action: "deleteReview" } | {
  action: "edit"; rating?: number | null; feedback?: string | null; rehire?: boolean | null;
};
export type CoachReviewFields = Pick<CoachEngagementRecord, "id" | "coachId" | "rating" | "feedback" | "rehire">;
export type CoachReviewResult = CoachEngagementRecord | CoachReviewFields;
export interface CoachEngagementAuthor { email: string; name: string }
export interface CoachEngagementRepository {
  listForCoach(coachId: string): Promise<CoachEngagementListItem[] | null>;
  createForCoach(coachId: string, input: CreateCoachEngagementInput): Promise<CoachEngagementRecord | null>;
  update(engagementId: string, input: UpdateCoachEngagementInput): Promise<CoachEngagementRecord | null>;
  /** Missing reviews throw, preserving the existing route error behavior. */
  updateReview(engagementId: string, command: CoachReviewCommand, author: CoachEngagementAuthor): Promise<CoachReviewResult>;
}

export function toCoachEngagementRecord(row: CoachEngagementRow): CoachEngagementRecord {
  return {
    id: row.id, sourceEngagementId: row.sourceEngagementId, coachId: row.coachId,
    operationSessionId: row.operationSessionId, courseName: row.courseName, status: row.status, source: row.source,
    startDate: row.startDate.toISOString(), endDate: row.endDate.toISOString(), startTime: row.startTime, endTime: row.endTime,
    rating: row.rating, rehire: row.rehire, feedback: row.feedback, reviewFlaggedAt: row.reviewFlaggedAt?.toISOString() ?? null,
    hiredById: row.hiredById, hiredByText: row.hiredByText, createdAt: row.createdAt.toISOString()
  };
}
export function toCoachEngagementListItem(row: CoachEngagementRow): CoachEngagementListItem {
  return { ...toCoachEngagementRecord(row), status: row.status.toLowerCase() as Lowercase<CoachEngagementStatus>, source: row.source.toLowerCase() as Lowercase<CoachEngagementSource>, startDate: row.startDate.toISOString().slice(0, 10), endDate: row.endDate.toISOString().slice(0, 10) };
}
