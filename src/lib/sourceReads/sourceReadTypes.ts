export type SourceReadStatus = "disabled" | "ok" | "partial" | "failed";

export type OperationSourceKind =
  | "calendar"
  | "course_board"
  | "discussion"
  | "sales";

export interface SourceReadIssue {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface SourceReadResult<TItem> {
  source: OperationSourceKind;
  status: SourceReadStatus;
  readAt: string;
  items: TItem[];
  issues: SourceReadIssue[];
}

export interface CourseBoardRecord {
  sourceRecordId: string;
  sourceUrl?: string;
  courseId?: string;
  companyName?: string;
  courseName: string;
  omName?: string;
  ldName?: string;
  startDate?: string;
  endDate?: string;
  operationStatusText?: string;
  notes?: string;
}

export interface CalendarResourceEvent {
  sourceEventId: string;
  ownerName: string;
  title: string;
  startDateTime: string;
  endDateTime: string;
  eventKind: "class" | "absence" | "nearby_workload" | "unknown";
  sourceUrl?: string;
}

export type DiscussionReferenceSourceKind = "slack" | "email" | "other";

export interface DiscussionReference {
  sourceMessageId: string;
  operationKey: string;
  title: string;
  occurredAt: string;
  sourceKind?: DiscussionReferenceSourceKind;
  sourceLabel?: string;
  sourceUrl: string;
  summary?: string;
}

export type LectureReportReference = DiscussionReference;

export interface SalesRecord {
  sourceRecordId: string;
  courseId?: string;
  companyName?: string;
  courseName?: string;
  revenue?: number;
  probability?: string;
  sourceUrl?: string;
}

export interface OperationSourceReader {
  readCourseBoard(): Promise<SourceReadResult<CourseBoardRecord>>;
  readCalendarEvents(): Promise<SourceReadResult<CalendarResourceEvent>>;
  readDiscussionReferences(): Promise<SourceReadResult<DiscussionReference>>;
  readSalesRecords(): Promise<SourceReadResult<SalesRecord>>;
}
