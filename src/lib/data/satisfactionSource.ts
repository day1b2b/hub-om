import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { readGoogleSheetRows } from "./googleSheetsImport";
import { getGoogleB2BAccessToken } from "../googleCalendar/calendarWriteClient";

export interface SatisfactionSource {
  readRows(spreadsheetId: string, tabTitle: string): Promise<string[][]>;
}

const defaultSource: SatisfactionSource = Object.freeze({
  async readRows(spreadsheetId: string, tabTitle: string) {
    const accessToken = await getGoogleB2BAccessToken();
    return readGoogleSheetRows(accessToken, spreadsheetId, tabTitle);
  }
});

export function getSatisfactionSource(): SatisfactionSource {
  return getDataRepositoryOverride("satisfactionSource") ?? defaultSource;
}
