import { getOperationSourceReader } from "./sourceReaderFactory";
import type {
  OperationSourceKind,
  OperationSourceReader,
  SourceReadIssue,
  SourceReadResult,
  SourceReadStatus
} from "./sourceReadTypes";

export interface SourceReadStatusSummary {
  source: OperationSourceKind;
  status: SourceReadStatus;
  readAt: string;
  itemCount: number;
  issues: SourceReadIssue[];
}

export async function readSourceStatuses(
  reader: OperationSourceReader = getOperationSourceReader()
): Promise<SourceReadStatusSummary[]> {
  const reads = [
    summarizeSourceRead("course_board", () => reader.readCourseBoard()),
    summarizeSourceRead("calendar", () => reader.readCalendarEvents()),
    summarizeSourceRead("discussion", () => reader.readDiscussionReferences()),
    summarizeSourceRead("sales", () => reader.readSalesRecords())
  ];

  return Promise.all(reads);
}

async function summarizeSourceRead<TItem>(
  source: OperationSourceKind,
  read: () => Promise<SourceReadResult<TItem>>
): Promise<SourceReadStatusSummary> {
  try {
    const result = await read();

    return {
      source,
      status: result.status,
      readAt: result.readAt,
      itemCount: result.items.length,
      issues: result.issues
    };
  } catch (error) {
    return {
      source,
      status: "failed",
      readAt: new Date().toISOString(),
      itemCount: 0,
      issues: [
        {
          code: "source_read_failed",
          message: error instanceof Error ? error.message : "Unknown source read failure.",
          recoverable: true
        }
      ]
    };
  }
}
