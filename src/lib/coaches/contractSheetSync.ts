import { readGoogleSpreadsheetRows } from "./googleServiceAccount";
import { getCoachSheetSource, getCoachSheetSyncRepository } from "../data/coachSheetSyncRepositoryFactory";
import { runContractSheetSync } from "./coachSheetSyncWorkflow";
import type { SyncResult } from "./syncTypes";

export async function syncContractSheetEngagements(dryRun: boolean): Promise<SyncResult> {
  // Resolve the scoped backend before fetching source data so incomplete scopes cannot contact production sources.
  const repository = getCoachSheetSyncRepository();
  const source = getCoachSheetSource();
  const snapshot = await source.readContract().catch(() => { throw new Error("계약 시트를 읽을 수 없습니다."); });
  return runContractSheetSync(snapshot, repository, dryRun);
}
export async function readContractSheetSource(): Promise<{ values: string[][]; struckCells: Set<string> }> {
  try {
    const { spreadsheetId, range } = readContractSheetConfig();
    return await readGoogleSpreadsheetRows(spreadsheetId, range);
  } catch { throw new Error("계약 시트를 읽을 수 없습니다."); }
}

function readContractSheetConfig(): { spreadsheetId: string; range: string } {
  const spreadsheetId = process.env.COACH_CONTRACT_SHEET_ID?.trim() || process.env.GOOGLE_SHEET_ID?.trim() || "";
  const range = process.env.COACH_CONTRACT_SHEET_RANGE?.trim() || "'조교실습코치_일반계약요청'!A:Q";
  if (!spreadsheetId) throw new Error("COACH_CONTRACT_SHEET_ID 또는 GOOGLE_SHEET_ID env가 필요합니다.");
  return { spreadsheetId, range };
}
