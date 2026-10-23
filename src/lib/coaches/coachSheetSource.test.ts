import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { runWithDataRepositories } from "../data/dataRepositoryContext";
import type { CoachSheetSyncRepository } from "../data/coachSheetSyncRepository";

let googleCalls = 0, valuesCall = 0;
let failMain = false, failAuxiliary = false;
let mainFailure: () => Error = () => new Error("synthetic-private-source-body");
class GoogleSheetReadError extends Error {
  readonly kind: string; readonly status: number | null; readonly code: string | null; readonly via: string | null;
  constructor(kind: string, message: string, status: number | null = null, code: string | null = null, via: string | null = null) { super(message); this.kind = kind; this.status = status; this.code = code; this.via = via; }
}
mock.module("./googleServiceAccount", { namedExports: {
  GoogleSheetReadError,
  readGoogleServiceAccountConfig: () => ({ serviceAccountEmail: "synthetic-sync@synthetic.iam.gserviceaccount.com", privateKey: "" }),
  async readGoogleSpreadsheetRows() { googleCalls++; if (failMain) throw mainFailure(); return { values: [[]], struckCells: new Set<string>() }; },
  async readGoogleSheetValues() { googleCalls++; valuesCall++; if (failMain) throw mainFailure(); if (failAuxiliary && valuesCall === 2) throw new Error("synthetic-private-source-body"); return [[]]; }
} });
const { readContractSheetSource, syncContractSheetEngagements } = await import("./contractSheetSync");
const { readSamsungSheetSource, syncSamsungSchedule } = await import("./samsungScheduleSync");
const { SheetSourceReadError } = await import("./sheetReadFailure");

async function withContractSheet(work: () => Promise<void>) {
  const previous = process.env.COACH_CONTRACT_SHEET_ID;
  process.env.COACH_CONTRACT_SHEET_ID = "synthetic-sheet";
  try { await work(); }
  finally {
    failMain = false; failAuxiliary = false; mainFailure = () => new Error("synthetic-private-source-body");
    if (previous === undefined) delete process.env.COACH_CONTRACT_SHEET_ID; else process.env.COACH_CONTRACT_SHEET_ID = previous;
  }
}

test("default source adapters redact unclassified failures and keep optional contract fallback", async () => {
  await withContractSheet(async () => {
    failMain = true;
    await assert.rejects(readContractSheetSource(), /^SheetSourceReadError: 계약 시트를 읽을 수 없습니다\. 구글 시트에 연결하지 못했습니다\.$/);
    await assert.rejects(readSamsungSheetSource(), /^SheetSourceReadError: 일정 시트를 읽을 수 없습니다\. 구글 시트에 연결하지 못했습니다\.$/);
    failMain = false; failAuxiliary = true; valuesCall = 0;
    assert.deepEqual(await readSamsungSheetSource(), { rows: [[]], contractRows: [] });
  });
});

test("classified sheet failures name the cause without the source body", async () => {
  await withContractSheet(async () => {
    failMain = true;
    const cases: Array<[() => Error, RegExp]> = [
      [() => new GoogleSheetReadError("missing_credentials", "Google service account or B2B OAuth env가 필요합니다."), /서비스 계정\(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY\) 또는 B2B 공용 계정\(GOOGLE_CAL_OAUTH_\*\) 중 하나가 필요합니다/],
      [() => new GoogleSheetReadError("auth_failed", "Google B2B token refresh failed", null, "b2b_token_refresh_failed", "b2b"), /B2B 공용 계정 토큰을 갱신하지 못했습니다/],
      [() => new GoogleSheetReadError("scope_missing", "Google Sheets read failed (403)", 403, "PERMISSION_DENIED", "b2b"), /시트 읽기 권한\(spreadsheets\.readonly\)이 없습니다/],
      [() => new GoogleSheetReadError("forbidden", "Google Sheets read failed (403)", 403, "PERMISSION_DENIED", "b2b"), /B2B 공용 계정에 이 시트 접근 권한이 없습니다/],
      [() => new GoogleSheetReadError("auth_failed", "invalid_grant", 400, "invalid_grant"), /인증에 실패했습니다\(invalid_grant\)/],
      [() => new GoogleSheetReadError("forbidden", "Google Sheets read failed (403)", 403, "PERMISSION_DENIED"), /서비스 계정\(synthetic-sync@synthetic\.iam\.gserviceaccount\.com\)에 이 시트 접근 권한이 없습니다/],
      [() => new GoogleSheetReadError("not_found", "Google Sheets read failed (404)", 404, "NOT_FOUND"), /시트 ID 설정\(COACH_CONTRACT_SHEET_ID\)을 확인해 주세요/],
      [() => new GoogleSheetReadError("bad_range", "Google Sheets read failed (400)", 400, "INVALID_ARGUMENT"), /탭이나 범위를 찾을 수 없습니다\('조교실습코치_일반계약요청'!A:Q\)/],
      [() => new GoogleSheetReadError("http", "Google Sheets read failed (500)", 500, null), /오류를 돌려줬습니다\(HTTP 500\)/]
    ];
    for (const [failure, expected] of cases) {
      mainFailure = failure;
      await assert.rejects(readContractSheetSource(), (error: unknown) => {
        assert.ok(error instanceof SheetSourceReadError);
        assert.match(error.message, /^계약 시트를 읽을 수 없습니다\. /);
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /synthetic-private-source-body/);
        return true;
      });
    }
  });
  const previous = { coach: process.env.COACH_CONTRACT_SHEET_ID, google: process.env.GOOGLE_SHEET_ID };
  delete process.env.COACH_CONTRACT_SHEET_ID; delete process.env.GOOGLE_SHEET_ID;
  try {
    await assert.rejects(readContractSheetSource(), /시트 ID 설정\(COACH_CONTRACT_SHEET_ID 또는 GOOGLE_SHEET_ID\)이 없습니다/);
  } finally {
    if (previous.coach !== undefined) process.env.COACH_CONTRACT_SHEET_ID = previous.coach;
    if (previous.google !== undefined) process.env.GOOGLE_SHEET_ID = previous.google;
  }
});

test("sync keeps a classified source message and redacts any other source error", async () => {
  const forbidden = async () => { throw new Error("Unexpected write or unmatched read"); };
  const repository: CoachSheetSyncRepository = {
    listLiveCoaches: async () => [], findLiveCoachByName: forbidden, getCoach: forbidden, findMatchingEngagement: forbidden, listEngagementsByCourseNames: forbidden, listReservationCoachIdsForEngagements: forbidden, transaction: forbidden
  };
  const classified = new SheetSourceReadError("계약 시트를 읽을 수 없습니다. 탭이나 범위를 찾을 수 없습니다(x).");
  await runWithDataRepositories({ coachSheetSync: repository, coachSheetSource: { readContract: async () => { throw classified; }, readSamsung: async () => { throw new Error("synthetic-private-source-body"); } } }, async () => {
    await assert.rejects(syncContractSheetEngagements(true), error => error === classified);
    await assert.rejects(syncSamsungSchedule(true), /^Error: 일정 시트를 읽을 수 없습니다\.$/);
  });
});

test("explicit synthetic source scopes run real services without Google or dry-run writes", async () => {
  const before = googleCalls;
  const forbidden = async () => { throw new Error("Unexpected write or unmatched read"); };
  const repository: CoachSheetSyncRepository = {
    listLiveCoaches: async () => [], findLiveCoachByName: forbidden, getCoach: forbidden, findMatchingEngagement: forbidden, listEngagementsByCourseNames: forbidden, listReservationCoachIdsForEngagements: forbidden, transaction: forbidden
  };
  await runWithDataRepositories({ coachSheetSync: repository, coachSheetSource: { readContract: async () => ({ values: [[]], struckCells: new Set() }), readSamsung: async () => ({ rows: [[]], contractRows: [] }) } }, async () => {
    assert.equal((await syncContractSheetEngagements(true)).created, 0);
    assert.equal((await syncSamsungSchedule(true)).created, 0);
  });
  await assert.rejects(runWithDataRepositories({}, () => syncContractSheetEngagements(true)), /DATA_REPOSITORY_NOT_CONFIGURED/);
  await assert.rejects(runWithDataRepositories({ coachSheetSync: repository }, () => syncSamsungSchedule(true)), /DATA_REPOSITORY_NOT_CONFIGURED/);
  assert.equal(googleCalls, before);
});
