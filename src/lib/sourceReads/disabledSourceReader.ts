import type {
  CalendarResourceEvent,
  CourseBoardRecord,
  DiscussionReference,
  OperationSourceKind,
  OperationSourceReader,
  SalesRecord,
  SourceReadResult
} from "./sourceReadTypes";

export class DisabledOperationSourceReader implements OperationSourceReader {
  readCourseBoard(): Promise<SourceReadResult<CourseBoardRecord>> {
    return Promise.resolve(buildDisabledResult("course_board"));
  }

  readCalendarEvents(): Promise<SourceReadResult<CalendarResourceEvent>> {
    return Promise.resolve(buildDisabledResult("calendar"));
  }

  readDiscussionReferences(): Promise<SourceReadResult<DiscussionReference>> {
    return Promise.resolve(buildDisabledResult("discussion"));
  }

  readSalesRecords(): Promise<SourceReadResult<SalesRecord>> {
    return Promise.resolve(buildDisabledResult("sales"));
  }
}

function buildDisabledResult<TItem>(source: OperationSourceKind): SourceReadResult<TItem> {
  return {
    source,
    status: "disabled",
    readAt: new Date(0).toISOString(),
    items: [],
    issues: [
      {
        code: "source_reader_not_configured",
        message: "External source reader is not configured in this public repository.",
        recoverable: true
      }
    ]
  };
}
