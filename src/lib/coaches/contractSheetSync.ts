import { readGoogleServiceAccountConfig, readGoogleSpreadsheetRows } from "./googleServiceAccount";
import { getCoachSheetSource, getCoachSheetSyncRepository } from "../data/coachSheetSyncRepositoryFactory";
import { runContractSheetSync } from "./coachSheetSyncWorkflow";
import { describeSheetReadFailure, SheetConfigMissingError, SheetSourceReadError } from "./sheetReadFailure";
import { readXlsxRows } from "./xlsxReader";
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

/** 업로드 파일은 이 크기까지만 받는다. 계약 요청 파일은 보통 수 MB 안쪽이다. */
export const CONTRACT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

/**
 * 관리자가 직접 올린 계약 요청 엑셀(.xlsx)을 읽는다. 구글 계정·공유 없이 동기화하기 위한 경로다
 * (계약 파일에 코치 연락처가 있어 외부 공용 계정에 공유하지 않기로 함, 2026-10-23).
 * 파일은 메모리에서만 읽고 저장하지 않는다. 탭·범위는 구글 경로와 같은 설정을 쓴다.
 */
export function readUploadedContractWorkbook(buffer: Buffer): { values: string[][]; struckCells: Set<string> } {
  const range = process.env.COACH_CONTRACT_SHEET_RANGE?.trim() || DEFAULT_CONTRACT_RANGE;
  try {
    return readXlsxRows(buffer, range);
  } catch (error) {
    // 탭을 못 찾은 경우만 탭 이름을 알려 주고, 그 밖의 파싱 오류는 파일 내용 없이 문구만 남긴다.
    if (error instanceof Error && /^Excel (workbook에서 )?시트를 찾을 수 없습니다|^Excel workbook 관계를 찾을 수 없습니다/.test(error.message)) {
      throw new SheetSourceReadError(`계약 파일을 읽을 수 없습니다. 탭이나 범위를 찾을 수 없습니다(${range}). 탭 이름이 바뀌었는지 확인해 주세요.`);
    }
    throw new SheetSourceReadError("계약 파일을 읽을 수 없습니다. 엑셀(.xlsx) 파일이 맞는지 확인해 주세요.");
  }
}

/** 업로드한 파일 내용으로 계약 동기화를 돌린다. 미리보기·반영 규칙은 구글 경로와 같다. */
export async function syncUploadedContractEngagements(buffer: Buffer, dryRun: boolean): Promise<SyncResult> {
  const repository = getCoachSheetSyncRepository();
  return runContractSheetSync(readUploadedContractWorkbook(buffer), repository, dryRun);
}

function readContractSheetConfig(): { spreadsheetId: string } {
  const spreadsheetId = process.env.COACH_CONTRACT_SHEET_ID?.trim() || process.env.GOOGLE_SHEET_ID?.trim() || "";
  if (!spreadsheetId) throw new SheetConfigMissingError(`${CONTRACT_SHEET_ENV} 또는 GOOGLE_SHEET_ID`);
  return { spreadsheetId };
}
