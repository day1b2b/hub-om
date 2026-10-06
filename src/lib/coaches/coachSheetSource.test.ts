import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { runWithDataRepositories } from "../data/dataRepositoryContext";
import type { CoachSheetSyncRepository } from "../data/coachSheetSyncRepository";

let googleCalls = 0, valuesCall = 0;
let failMain = false, failAuxiliary = false;
mock.module("./googleServiceAccount", { namedExports: {
  async readGoogleSpreadsheetRows() { googleCalls++; if (failMain) throw new Error("synthetic-private-source-body"); return { values: [[]], struckCells: new Set<string>() }; },
  async readGoogleSheetValues() { googleCalls++; valuesCall++; if (failMain || failAuxiliary && valuesCall === 2) throw new Error("synthetic-private-source-body"); return [[]]; }
} });
const { readContractSheetSource, syncContractSheetEngagements } = await import("./contractSheetSync");
const { readSamsungSheetSource, syncSamsungSchedule } = await import("./samsungScheduleSync");

test("default source adapters redact primary failures and keep optional contract fallback", async () => {
  const previous = process.env.COACH_CONTRACT_SHEET_ID;
  process.env.COACH_CONTRACT_SHEET_ID = "synthetic-sheet";
  try {
    failMain = true;
    await assert.rejects(readContractSheetSource(), /^Error: 계약 시트를 읽을 수 없습니다\.$/);
    await assert.rejects(readSamsungSheetSource(), /^Error: 일정 시트를 읽을 수 없습니다\.$/);
    failMain = false; failAuxiliary = true; valuesCall = 0;
    assert.deepEqual(await readSamsungSheetSource(), { rows: [[]], contractRows: [] });
  } finally { failMain = false; failAuxiliary = false; if (previous === undefined) delete process.env.COACH_CONTRACT_SHEET_ID; else process.env.COACH_CONTRACT_SHEET_ID = previous; }
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
