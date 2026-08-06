import { DisabledOperationSourceReader } from "./disabledSourceReader";
import { GoogleCalendarSourceReader, hasGoogleCalendarConfig } from "./googleCalendarSourceReader";
import { hasSalesmapConfig, SalesmapSourceReader } from "./salesmapSourceReader";
import type {
  CalendarResourceEvent,
  CourseBoardRecord,
  DiscussionReference,
  OperationSourceReader,
  SalesRecord,
  SourceReadResult
} from "./sourceReadTypes";

/**
 * 저장소 안에 내장된 원천 reader들을 원천별로 라우팅한다.
 * 각 메서드는 해당 원천이 설정돼 있으면 그 reader로, 아니면 disabled(빈 결과)로 보낸다.
 * 덕분에 Google Calendar와 Salesmap을 동시에 켤 수 있다.
 */
export class CompositeOperationSourceReader implements OperationSourceReader {
  private readonly fallback = new DisabledOperationSourceReader();
  private readonly calendarReader: OperationSourceReader;
  private readonly salesReader: OperationSourceReader;

  constructor() {
    this.calendarReader = hasGoogleCalendarConfig() ? new GoogleCalendarSourceReader() : this.fallback;
    this.salesReader = hasSalesmapConfig() ? new SalesmapSourceReader() : this.fallback;
  }

  readCourseBoard(): Promise<SourceReadResult<CourseBoardRecord>> {
    return this.fallback.readCourseBoard();
  }

  readCalendarEvents(): Promise<SourceReadResult<CalendarResourceEvent>> {
    return this.calendarReader.readCalendarEvents();
  }

  readDiscussionReferences(): Promise<SourceReadResult<DiscussionReference>> {
    return this.fallback.readDiscussionReferences();
  }

  readSalesRecords(): Promise<SourceReadResult<SalesRecord>> {
    return this.salesReader.readSalesRecords();
  }
}

/** 저장소 내장 reader 중 하나라도 환경변수로 설정돼 있는지. */
export function hasBuiltInSourceConfig(): boolean {
  return hasGoogleCalendarConfig() || hasSalesmapConfig();
}
