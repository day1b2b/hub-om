/** Synthetic source snapshots and in-memory storage only; no Google, Notion or database access. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { collectEmployeeIds, parseSamsungContracts, runContractSheetSync, runSamsungSheetSync } from "./coachSheetSyncWorkflow";
import type { CoachSheetSyncReader, CoachSheetSyncRepository, CoachSheetSyncTransaction, SheetEngagementIdentity, SheetEngagementWrite, SheetScheduleWrite, SheetSyncCoach } from "../data/coachSheetSyncRepository";
function contractRow(name: string, course: string, options: Record<number, string> = {}) {
  const row = Array<string>(17).fill("");
  Object.assign(row, { 4: name, 5: "실습코치", 7: course, 9: "2099-09-21", 10: "2099-09-23", ...options }); return row;
}
function samsungRow(names: string) { const row = Array<string>(10).fill(""); row[2] = "2099-09-21"; row[6] = names; return row; }
const courseNames = { courseName: "Synthetic target course", oldCourseName: "Synthetic old course" };
function memory() {
  let coaches: SheetSyncCoach[] = [], engagements: Array<SheetEngagementIdentity & SheetEngagementWrite & { rating?: number }> = [], schedules: SheetScheduleWrite[] = [];
  const events: string[] = [], confirmations: string[] = [];
  const reservations: Array<{ coachId: string; confirmedEngagementId: string | null }> = [];
  const lockSets: string[][] = [];
  let failCourse = "", failProfile = false, failConfirmation = false;
  const reader: CoachSheetSyncReader = {
    async findLiveCoachByName(name) { return structuredClone(coaches.filter(coach => coach.name === name).at(-1) ?? null); },
    async listLiveCoaches() { return structuredClone(coaches); },
    async getCoach(id) { return structuredClone(coaches.find(coach => coach.id === id) ?? null); },
    async findMatchingEngagement(match) { return engagements.find(row => row.sourceEngagementId === match.sourceEngagementId || row.coachId === match.coachId && row.courseName === match.courseName && row.startDate <= match.endDate && row.endDate >= match.startDate) ?? null; },
    async listReservationCoachIdsForEngagements(ids) { return reservations.filter(row => row.confirmedEngagementId && ids.includes(row.confirmedEngagementId)).map(row => row.coachId); },
    async listEngagementsByCourseNames(names) { return engagements.filter(row => names.includes(row.courseName)).map(({ id, coachId }) => ({ id, coachId })); }
  };
  const repository: CoachSheetSyncRepository = { ...reader, async transaction(work) {
    const before = structuredClone({ coaches, engagements, schedules }), confirmationLength = confirmations.length;
    events.push("catalog"); let locked = false;
    const write = () => assert.ok(locked, "Workflow must lock coach IDs before writes");
    const tx: CoachSheetSyncTransaction = { ...reader,
      async lockCoaches(ids) { assert.equal(new Set(ids).size, ids.length); locked = true; lockSets.push(ids); events.push("coaches"); },
      async createCoach(input) { write(); const coach = { id: input.id, name: input.name, workType: input.workType, privateProfile: input.privateProfile }; coaches.push(coach); return structuredClone(coach); },
      async patchCoach(id, patch) { write(); Object.assign(coaches.find(row => row.id === id)!, patch); },
      async upsertPrivateProfile(id, create, patch) { write(); if (failProfile) throw new Error("Synthetic profile failure"); const coach = coaches.find(row => row.id === id)!; coach.privateProfile = coach.privateProfile ? { ...coach.privateProfile, ...patch } : create; },
      async createEngagement(input) { write(); if (input.courseName === failCourse) throw new Error("Synthetic engagement failure"); const row = { id: randomUUID(), ...input }; engagements.push(row); return { id: row.id, coachId: row.coachId }; },
      async patchEngagement(id, patch) { write(); if (patch.courseName === failCourse) throw new Error("Synthetic engagement failure"); Object.assign(engagements.find(row => row.id === id)!, patch); },
      async replaceSchedules(id, rows) { write(); schedules = schedules.filter(row => row.engagementId !== id).concat(rows); },
      async deleteEngagements(ids) { write(); for (const row of reservations) if (row.confirmedEngagementId && ids.includes(row.confirmedEngagementId)) { assert.ok(lockSets.at(-1)?.includes(row.coachId)); row.confirmedEngagementId = null; } engagements = engagements.filter(row => !ids.includes(row.id)); schedules = schedules.filter(row => !ids.includes(row.engagementId)); },
      async cancelReservations(entries) { write(); if (failConfirmation) throw new Error("Synthetic confirmation failure"); confirmations.push(...entries.map(row => row.engagementId)); }
    };
    try { const result = await work(tx); events.push("commit"); return result; }
    catch (error) { ({ coaches, engagements, schedules } = before); confirmations.splice(confirmationLength); events.push("rollback"); throw error; }
  } };
  return { repository, events, confirmations, reservations, lockSets, get coaches() { return coaches; }, get engagements() { return engagements; }, get schedules() { return schedules; }, failCourse(value: string) { failCourse = value; }, failProfile() { failProfile = true; }, failConfirmation() { failConfirmation = true; } };
}

test("employee IDs preserve suffix cleanup, cancellation-row collection and sorted deduplication", () => {
  const rows = [[], contractRow("Synthetic A", "Course", { 3: "200-1" }), contractRow("Synthetic A", "취소", { 3: "100(note)", 0: "취소" }), contractRow("Synthetic A", "Course", { 3: "200-2" }), contractRow("Synthetic B", "Course", { 3: "사번없음" })];
  assert.deepEqual([...collectEmployeeIds(rows)], [["Synthetic A", "100, 200"]]);
});

test("contract dry run preserves skip and created counters and performs no transaction", async () => {
  const state = memory();
  const values = [[], contractRow("Synthetic A", "Course A"), contractRow("Synthetic A", "Course B"), contractRow("Synthetic B", "취소 과정"), contractRow("Synthetic C", "Course", { 9: "2025-01-01", 10: "2025-01-02" }), contractRow("Synthetic D", "Course", { 9: "" }), contractRow("Synthetic E", "Course")];
  const result = await runContractSheetSync({ values, struckCells: new Set(["6:7"]) }, state.repository, true);
  assert.deepEqual({ totalRows: result.totalRows, created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors }, { totalRows: 6, created: 3, updated: 0, skipped: 4, errors: 0 });
  assert.equal(result.errorDetail.length, 1); assert.deepEqual(result.changes?.map(row => row.action), ["create_coach", "create_engagement", "create_engagement"]); assert.deepEqual(state.events, []);
});

test("contract apply preserves manual profile values, reuses overlapping engagements and stable schedule IDs", async () => {
  const state = memory(), coachId = randomUUID();
  state.coaches.push({ id: coachId, name: "Synthetic A", workType: "멘토", privateProfile: { employeeId: "MANUAL", email: "manual@example.invalid", phone: null } });
  state.engagements.push({ id: randomUUID(), coachId, sourceEngagementId: "manual-source", courseName: "Course", status: "SCHEDULED", source: "SHEET", startDate: new Date("2099-09-21"), endDate: new Date("2099-09-23"), startTime: null, endTime: null, hiredByText: null, rating: 5 });
  const values = [[], contractRow("Synthetic A", "Course", { 3: "SOURCE", 12: "9/21, 9/23 10:00~17:00", 13: "source@example.invalid", 14: "01012345678" })];
  const result = await runContractSheetSync({ values, struckCells: new Set() }, state.repository, false);
  assert.equal(result.updated, 1); assert.equal(result.created, 0); assert.equal(state.engagements[0].rating, 5);
  assert.equal(state.coaches[0].workType, "실습코치, 멘토");
  assert.deepEqual(state.coaches[0].privateProfile, { employeeId: "MANUAL", email: "manual@example.invalid", phone: "010-1234-5678" });
  assert.equal(state.engagements[0].sourceEngagementId, "contract-sheet:2:Synthetic A:2099-09-21:2099-09-23");
  assert.deepEqual(state.schedules.map(row => row.sourceEngagementScheduleId), ["contract-sheet:2:Synthetic A:2099-09-21:2099-09-23:0:2099-09-21", "contract-sheet:2:Synthetic A:2099-09-21:2099-09-23:1:2099-09-23"]);
  assert.equal(state.confirmations.length, 2);
});

test("a later contract engagement failure preserves prior phase commits", async () => {
  const state = memory(); state.failCourse("Synthetic failure");
  await assert.rejects(runContractSheetSync({ values: [[], contractRow("Synthetic A", "Synthetic success"), contractRow("Synthetic B", "Synthetic failure")], struckCells: new Set() }, state.repository, false), /Synthetic engagement failure/);
  assert.equal(state.coaches.length, 2); assert.equal(state.engagements.length, 1); assert.equal(state.engagements[0].courseName, "Synthetic success"); assert.equal(state.events.at(-1), "rollback");
});

test("supplement profile failure stays inside the same transaction as public work-type changes", async () => {
  const state = memory(), original = { id: randomUUID(), name: "Synthetic A", workType: "멘토", privateProfile: null };
  state.coaches.push(original); state.failProfile();
  await assert.rejects(runContractSheetSync({ values: [[], contractRow("Synthetic A", "Course", { 13: "source@example.invalid" })], struckCells: new Set() }, state.repository, false), /Synthetic profile failure/);
  assert.deepEqual(state.coaches[0], { ...original, workType: "멘토" }); assert.equal(state.engagements.length, 0);
});

test("Samsung dry run retains duplicate names and counts coaches plus replacement entries", async () => {
  const state = memory();
  const result = await runSamsungSheetSync({ rows: [[], samsungRow("Synthetic A/Synthetic A／Synthetic B")], contractRows: [] }, state.repository, true, courseNames);
  assert.equal(result.totalRows, 1); assert.equal(result.created, 5); assert.equal(result.updated, 0); assert.equal(result.changes?.at(-1)?.details, "재생성 대상 3건"); assert.deepEqual(state.events, []);
  const first = Array<string>(17).fill(""); Object.assign(first, { 4: "FIRST", 5: "Synthetic A", 6: "멘토" });
  const last = [...first]; last[4] = "LAST";
  assert.equal(parseSamsungContracts([[], [], first, last]).get("Synthetic A")?.employeeId, "LAST");
});

test("Samsung replacement is one transaction and preserves coach supplements if final confirmation fails", async () => {
  const state = memory(), oldCoach = randomUUID();
  const existing = { id: randomUUID(), coachId: oldCoach, sourceEngagementId: "old", courseName: courseNames.oldCourseName, status: "SCHEDULED" as const, source: "SHEET" as const, startDate: new Date("2099-09-21"), endDate: new Date("2099-09-21"), startTime: null, endTime: null, hiredByText: null, rating: 5 };
  state.engagements.push(existing); state.failConfirmation();
  await assert.rejects(runSamsungSheetSync({ rows: [[], samsungRow("Synthetic A")], contractRows: [] }, state.repository, false, courseNames), /Synthetic confirmation failure/);
  assert.equal(state.coaches.length, 1); assert.equal(state.coaches[0].workType, "삼전 DS"); assert.deepEqual(state.engagements, [existing]);
});

test("Samsung success replaces only configured course names and keeps index-based source IDs", async () => {
  const state = memory();
  const result = await runSamsungSheetSync({ rows: [[], samsungRow("Synthetic A/Synthetic A")], contractRows: [] }, state.repository, false, courseNames);
  assert.equal(result.created, 3); assert.equal(result.updated, 0);
  assert.deepEqual(state.engagements.map(row => row.sourceEngagementId), ["samsung:0:Synthetic A:2099-09-21:2099-09-21", "samsung:1:Synthetic A:2099-09-21:2099-09-21"]);
  assert.deepEqual(state.schedules.map(row => row.sourceEngagementScheduleId), ["samsung:0:0:Synthetic A:2099-09-21", "samsung:1:0:Synthetic A:2099-09-21"]);
});


test("Samsung replacement locks cross-coach reservation references before clearing them", async () => {
  const state = memory(), ownerId = randomUUID(), otherCoachId = randomUUID(), engagementId = randomUUID();
  state.engagements.push({ id: engagementId, coachId: ownerId, sourceEngagementId: "synthetic-old", courseName: courseNames.oldCourseName, status: "SCHEDULED", source: "SHEET", startDate: new Date("2099-09-21"), endDate: new Date("2099-09-21"), startTime: null, endTime: null, hiredByText: null });
  state.reservations.push({ coachId: otherCoachId, confirmedEngagementId: engagementId });
  await runSamsungSheetSync({ rows: [], contractRows: [] }, state.repository, false, courseNames);
  assert.deepEqual(state.lockSets, [[ownerId, otherCoachId].sort()]);
  assert.equal(state.reservations[0].confirmedEngagementId, null);
  assert.equal(state.engagements.length, 0);
});
