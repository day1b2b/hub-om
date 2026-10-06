import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { readNotionDatabaseImport, type NotionImportReadResult } from "./notionImport";

/** Selecting a source does not grant workspace access or change server credentials. */
export interface NotionImportSource {
  readDatabase(input: { databaseUrlOrId: string; token: string }): Promise<NotionImportReadResult>;
}

const defaultSource: NotionImportSource = Object.freeze({ readDatabase: readNotionDatabaseImport });

export function getNotionImportSource(): NotionImportSource {
  return getDataRepositoryOverride("notionImportSource") ?? defaultSource;
}

const PUBLIC_SOURCE_ERRORS = new Set([
  "Notion 데이터베이스 URL 또는 ID를 확인해 주세요.",
  "Notion 통합 토큰 권한이 없습니다. 해당 데이터베이스에 Notion 통합을 초대했는지 확인해 주세요."
]);

/** Exact public messages only: remote statusText, driver parameters and causes stay private. */
export function notionImportError(error: unknown): string {
  return error instanceof Error && PUBLIC_SOURCE_ERRORS.has(error.message)
    ? error.message
    : "Notion 데이터를 가져오지 못했습니다.";
}
