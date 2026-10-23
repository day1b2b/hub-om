import { readGoogleServiceAccountConfig, readGoogleSpreadsheetRows } from "./googleServiceAccount";
import { getCoachSheetSource, getCoachSheetSyncRepository } from "../data/coachSheetSyncRepositoryFactory";
import { runContractSheetSync } from "./coachSheetSyncWorkflow";
import { describeSheetReadFailure, SheetConfigMissingError, SheetSourceReadError } from "./sheetReadFailure";
import type { SyncResult } from "./syncTypes";

const CONTRACT_SHEET_ENV = "COACH_CONTRACT_SHEET_ID";
const DEFAULT_CONTRACT_RANGE = "'조교실습코치_일반계약요청'!A:Q";

export async function syncContractSheetEngagements(dryRun: boolean): Promise<SyncResult> {
  // Resolve the scoped backend before fetching source data so incomplete scopes cannot contact production sources.
  const repository = getCoachSheetSyncRepository();
  const source = getCoachSheetSource();
  // 원인이 분류된 메시지는 그대로 보여주고, 그 밖의 원천 오류는 문구만 남긴다.
  const snapshot = await source.readContract().catch((error: unknown) => {
    throw error instanceof SheetSourceReadError ? error : new Error("계약 시트를 읽을 수 없습니다.");
  });
  return runContractSheetSync(snapshot, repository, dryRun);
}
export async function readContractSheetSource(): Promise<{ values: string[][]; struckCells: Set<string> }> {
  const range = process.env.COACH_CONTRACT_SHEET_RANGE?.trim() || DEFAULT_CONTRACT_RANGE;
  try {
    const { spreadsheetId } = readContractSheetConfig();
    return await readGoogleSpreadsheetRows(spreadsheetId, range);
  } catch (error) {
    throw describeSheetReadFailure(error, {
      label: "계약 시트",
      sheetEnvName: CONTRACT_SHEET_ENV,
      range,
      serviceAccountEmail: readGoogleServiceAccountConfig().serviceAccountEmail
    });
  }
}

function readContractSheetConfig(): { spreadsheetId: string } {
  const spreadsheetId = process.env.COACH_CONTRACT_SHEET_ID?.trim() || process.env.GOOGLE_SHEET_ID?.trim() || "";
  if (!spreadsheetId) throw new SheetConfigMissingError(`${CONTRACT_SHEET_ENV} 또는 GOOGLE_SHEET_ID`);
  return { spreadsheetId };
}
