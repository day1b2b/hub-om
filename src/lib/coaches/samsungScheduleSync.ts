import { readGoogleSheetValues } from "./googleServiceAccount";
import { getCoachSheetSource, getCoachSheetSyncRepository } from "../data/coachSheetSyncRepositoryFactory";
import { runSamsungSheetSync } from "./coachSheetSyncWorkflow";
import type { SyncResult } from "./syncTypes";

const DEFAULT_SAMSUNG_SHEET_ID = "1GWF3v9lLpS0SlM45QGAHmj2k2N1U2AX8zB8DOMlXHr0";
const DEFAULT_CONTRACT_SHEET_ID = "1xFgbLPL1ZLGxQws0ofK0kU8eehrFqEeAiwNbtQ56lyw";
const COURSE_NAME = "(B2B) 삼성전자 SW학부 교육과정_26년";
const OLD_COURSE_NAME = "삼성전자 SW학부 교육과정";
export const SAMSUNG_COURSE_NAMES = Object.freeze({ courseName: COURSE_NAME, oldCourseName: OLD_COURSE_NAME });


export async function syncSamsungSchedule(dryRun: boolean): Promise<SyncResult> {
  const repository = getCoachSheetSyncRepository();
  const source = getCoachSheetSource();
  const snapshot = await source.readSamsung().catch(() => { throw new Error("일정 시트를 읽을 수 없습니다."); });
  return runSamsungSheetSync(snapshot, repository, dryRun, SAMSUNG_COURSE_NAMES);
}
export async function readSamsungSheetSource(): Promise<{ rows: string[][]; contractRows: string[][] }> {
  const config = readSamsungConfig();
  let rows: string[][];
  try { rows = await readGoogleSheetValues(config.scheduleSheetId, config.scheduleRange); }
  catch { throw new Error("일정 시트를 읽을 수 없습니다."); }
  let contractRows: string[][] = [];
  // The optional contract source has historically been best effort; preserve that fallback.
  try { contractRows = await readGoogleSheetValues(config.contractSheetId, config.contractRange); } catch { /* no raw source error text */ }
  return { rows, contractRows };
}

function readSamsungConfig() {
  return {
    scheduleSheetId: process.env.SAMSUNG_SCHEDULE_SHEET_ID?.trim() || DEFAULT_SAMSUNG_SHEET_ID,
    scheduleRange: process.env.SAMSUNG_SCHEDULE_SHEET_RANGE?.trim() || "'26년 일정'!A:J",
    contractSheetId: process.env.SAMSUNG_CONTRACT_SHEET_ID?.trim() || process.env.COACH_CONTRACT_SHEET_ID?.trim() || DEFAULT_CONTRACT_SHEET_ID,
    contractRange: process.env.SAMSUNG_CONTRACT_SHEET_RANGE?.trim() || "'운영조교/실습코치 계약요청'!A:Q"
  };
}
