import { DisabledOperationSourceReader } from "./disabledSourceReader";
import { GoogleCalendarSourceReader, hasGoogleCalendarConfig } from "./googleCalendarSourceReader";
import type { OperationSourceReader } from "./sourceReadTypes";

interface SourceReaderModule {
  createOperationSourceReader?: () => OperationSourceReader | Promise<OperationSourceReader>;
}

export async function getOperationSourceReader(): Promise<OperationSourceReader> {
  const moduleName = process.env.OPERATION_SOURCE_READER_MODULE?.trim();

  if (!moduleName) {
    if (hasGoogleCalendarConfig()) {
      return new GoogleCalendarSourceReader();
    }

    return new DisabledOperationSourceReader();
  }

  try {
    const readerModule = await importConfiguredReader(moduleName);

    if (typeof readerModule.createOperationSourceReader !== "function") {
      throw new Error("Configured source reader module must export createOperationSourceReader().");
    }

    return readerModule.createOperationSourceReader();
  } catch (error) {
    return buildFailingReader(error);
  }
}

function importConfiguredReader(moduleName: string): Promise<SourceReaderModule> {
  return import(/* webpackIgnore: true */ moduleName) as Promise<SourceReaderModule>;
}

function buildFailingReader(error: unknown): OperationSourceReader {
  const failedRead = () => Promise.reject(error);

  return {
    readCourseBoard: failedRead,
    readCalendarEvents: failedRead,
    readDiscussionReferences: failedRead,
    readSalesRecords: failedRead
  };
}
