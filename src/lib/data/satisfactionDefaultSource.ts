import { getGoogleB2BAccessToken } from "../googleCalendar/calendarWriteClient";
import { readGoogleSheetRows } from "./googleSheetsImport";

export async function readDefaultSatisfactionRows(spreadsheetId: string, tabTitle: string): Promise<string[][]> {
  return readGoogleSheetRows(await getGoogleB2BAccessToken(), spreadsheetId, tabTitle);
}
