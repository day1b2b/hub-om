import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { listGoogleSheetTabs, readGoogleSheetRows, type GoogleSheetTab } from "./googleSheetsImport";

/** Explicit source boundary; selecting a source does not grant workspace access. */
export interface GoogleSheetsImportSource {
  listTabs(accessToken: string, spreadsheetId: string): Promise<GoogleSheetTab[]>;
  readRows(accessToken: string, spreadsheetId: string, tabTitle: string): Promise<string[][]>;
}

const defaultSource: GoogleSheetsImportSource = Object.freeze({
  listTabs: listGoogleSheetTabs,
  readRows: readGoogleSheetRows
});

export function getGoogleSheetsImportSource(): GoogleSheetsImportSource {
  return getDataRepositoryOverride("googleSheetsImportSource") ?? defaultSource;
}

const PUBLIC_SOURCE_ERRORS = new Set([
  "Google 스프레드시트 URL을 확인해 주세요.",
  "스프레드시트를 읽을 권한이 없습니다. Google로 다시 로그인해 권한을 허용해 주세요.",
  "Google 스프레드시트를 읽지 못했습니다."
]);
const PUBLIC_HEADER_ERROR = "헤더로 사용할 행을 찾지 못했습니다. 시트에 제목 행과 데이터가 있는지 확인해 주세요.";

/** Only known complete messages are public; never forward driver/source details. */
export function googleSheetsImportError(error: unknown, action: "tabs" | "import"): string {
  if (error instanceof Error && (PUBLIC_SOURCE_ERRORS.has(error.message)
    || (action === "import" && error.message === PUBLIC_HEADER_ERROR))) return error.message;
  return action === "tabs" ? "탭 목록을 불러오지 못했습니다." : "스프레드시트를 가져오지 못했습니다.";
}
