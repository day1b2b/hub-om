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
  /** 이 코스ID로 합산된 세일즈맵 딜 개수(1이면 단일). 2 이상이면 처리 방식 확인 대상. */
  dealCount?: number;
  /** 합산된 딜들의 금액이 모두 동일한지(같으면 복붙 중복 → 1건 금액만 자동 반영). */
  dealsSameAmount?: boolean;
  /** 합산된 딜들 중 최대/최소 금액(금액 다른 다중 딜의 대안 처리: 합산/최대/최소). */
  maxAmount?: number;
  minAmount?: number;
}

export interface OperationSourceReader {
  readCourseBoard(): Promise<SourceReadResult<CourseBoardRecord>>;
  readCalendarEvents(): Promise<SourceReadResult<CalendarResourceEvent>>;
  readDiscussionReferences(): Promise<SourceReadResult<DiscussionReference>>;
  readSalesRecords(): Promise<SourceReadResult<SalesRecord>>;
}
