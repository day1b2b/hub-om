import { test } from "node:test";
import assert from "node:assert/strict";
import { runSessionInstructorSync } from "./sessionInstructorSyncCommand";
import type { SessionInstructorWriter } from "./sessionInstructorSyncWorkflow";
import type { SessionInstructorSyncInputs, SessionInstructorSyncRepository } from "../data/sessionInstructorSyncRepository";

function inputs(): SessionInstructorSyncInputs {
  return {
    sessions: [{
      operationSessionId: "S1", courseName: "삼성", instructorsText: "최선신, 정을수, 홍길동",
      startDate: new Date("2026-11-16"), endDate: new Date("2026-11-20"), scheduleDates: [new Date("2026-11-16")], startTime: null, endTime: null
    }],
    existingBySession: new Map(),
    // 홍길동은 동명이인(id 2개) → 명부에서 제외되어 unmatched로 떨어져야 한다.
    instructors: [{ id: "n1", name: "최선신" }, { id: "n2", name: "정을수" }, { id: "h1", name: "홍길동" }, { id: "h2", name: "홍길동" }]
  };
}

function fakeRepository(capture: { creates: string[] }): SessionInstructorSyncRepository {
  const writer: SessionInstructorWriter = {
    async createEngagement(input) { capture.creates.push(input.instructorNoteId); return { id: `eng-${input.instructorNoteId}` }; },
    async replaceSchedules() {},
    async convertToManual() {},
    async reactivateEngagements() {},
    async cancelEngagements() {}
  };
  return {
    async readInputs() { return inputs(); },
    async withWriter(write) { return write(writer); },
    async setSessionInstructors() { throw new Error("백필은 setSessionInstructors를 쓰지 않는다"); }
  };
}

const deps = (capture: { creates: string[] }) => ({ getDefaultRepository: () => fakeRepository(capture), closeDefaultRepository: async () => {} });

test("dry-run: 쓰지 않고 계획만 집계, 동명이인(홍길동)은 명부에서 빠져 unmatched", async () => {
  const capture = { creates: [] as string[] };
  const result = await runSessionInstructorSync([], () => {}, deps(capture));
  assert.equal(result.apply, false);
  assert.equal(result.created, 2); // 최선신·정을수만, 홍길동(동명이인)은 제외
  assert.equal(capture.creates.length, 0); // dry-run은 쓰지 않음
  assert.deepEqual(result.unmatched, [{ operationSessionId: "S1", names: ["홍길동"] }]);
});

test("--apply: 유일 이름만 생성, 동명이인은 투입 안 만듦", async () => {
  const capture = { creates: [] as string[] };
  const result = await runSessionInstructorSync(["--apply"], () => {}, deps(capture));
  assert.equal(result.apply, true);
  assert.equal(result.created, 2);
  assert.deepEqual(capture.creates.sort(), ["n1", "n2"]);
  assert.deepEqual(result.unmatched, [{ operationSessionId: "S1", names: ["홍길동"] }]);
});
