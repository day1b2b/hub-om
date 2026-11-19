import { test } from "node:test";
import assert from "node:assert/strict";
import { engagementStatusFromDates, syncSessionCoaches, type SessionCoachWriter, type SyncSessionInput } from "./sessionCoachSyncWorkflow";
import type { ExistingSessionEngagement } from "./sessionCoachSync";

const TODAY = new Date("2026-11-19T00:00:00.000Z");

function session(overrides: Partial<SyncSessionInput> & { operationSessionId: string }): SyncSessionInput {
  return {
    courseName: "삼성 AI/Bigdata",
    coachText: null,
    startDate: new Date("2026-11-16T00:00:00.000Z"),
    endDate: new Date("2026-11-20T00:00:00.000Z"),
    scheduleDates: [new Date("2026-11-16T00:00:00.000Z"), new Date("2026-11-17T00:00:00.000Z")],
    startTime: "09:00",
    endTime: "18:00",
    ...overrides
  };
}

function recordingWriter() {
  const calls = { created: [] as unknown[], deleted: [] as string[][], schedules: [] as Array<{ engagementId: string; count: number }> };
  let seq = 0;
  const writer: SessionCoachWriter = {
    async createEngagement(input) { const id = `eng-${++seq}`; calls.created.push({ id, ...input }); return { id }; },
    async replaceSchedules(engagementId, rows) { calls.schedules.push({ engagementId, count: rows.length }); },
    async deleteEngagements(ids) { calls.deleted.push(ids); }
  };
  return { writer, calls };
}

test("engagementStatusFromDates: 지남=완료, 기간중=진행, 미래=예정", () => {
  assert.equal(engagementStatusFromDates(new Date("2026-10-01"), new Date("2026-10-10"), TODAY), "COMPLETED");
  assert.equal(engagementStatusFromDates(new Date("2026-11-16"), new Date("2026-11-20"), TODAY), "IN_PROGRESS");
  assert.equal(engagementStatusFromDates(new Date("2026-12-01"), new Date("2026-12-05"), TODAY), "SCHEDULED");
});

test("dry-run: 쓰지 않고 계획 수치만 집계", async () => {
  const { writer, calls } = recordingWriter();
  const result = await syncSessionCoaches(
    [session({ operationSessionId: "S1", coachText: "김시은" })],
    new Map(),
    [{ id: "c1", name: "김시은" }],
    writer, TODAY, true
  );
  assert.equal(result.apply, false);
  assert.equal(result.created, 1);
  assert.equal(calls.created.length, 0); // 쓰지 않음
});

test("apply: 명단 코치의 MANUAL 투입 생성 + 일정 생성", async () => {
  const { writer, calls } = recordingWriter();
  const result = await syncSessionCoaches(
    [session({ operationSessionId: "S1", coachText: "김시은" })],
    new Map(),
    [{ id: "c1", name: "김시은" }],
    writer, TODAY, false
  );
  assert.equal(result.created, 1);
  assert.equal(calls.created.length, 1);
  const created = calls.created[0] as { coachId: string; operationSessionId: string; source: string; status: string; sourceEngagementId: string };
  assert.equal(created.coachId, "c1");
  assert.equal(created.operationSessionId, "S1");
  assert.equal(created.source, "MANUAL");
  assert.equal(created.status, "IN_PROGRESS");
  assert.equal(created.sourceEngagementId, "manual-session:S1:c1");
  assert.equal(calls.schedules[0].count, 2); // 교육일 2개
});

test("apply: 명단에서 빠진 MANUAL 제거 + 같은 회차 SHEET 투입 대체 삭제", async () => {
  const { writer, calls } = recordingWriter();
  const existing = new Map<string, ExistingSessionEngagement[]>([
    ["S1", [
      { id: "m-old", coachId: "c2", source: "MANUAL" }, // 명단에서 빠짐 → 제거
      { id: "s-dup", coachId: "c1", source: "SHEET" }   // 명단 코치의 SHEET → 대체 삭제
    ]]
  ]);
  const result = await syncSessionCoaches(
    [session({ operationSessionId: "S1", coachText: "김시은" })], // c1만 명단
    existing,
    [{ id: "c1", name: "김시은" }, { id: "c2", name: "이영희" }],
    writer, TODAY, false
  );
  assert.equal(result.created, 1);      // c1 MANUAL 생성
  assert.equal(result.removed, 1);      // c2 MANUAL 제거
  assert.equal(result.superseded, 1);   // c1 SHEET 대체
  assert.deepEqual(calls.deleted[0].sort(), ["m-old", "s-dup"]); // 한 번에 삭제
});

test("apply: 이미 MANUAL 있으면 다시 만들지 않음(멱등)", async () => {
  const { writer, calls } = recordingWriter();
  const existing = new Map<string, ExistingSessionEngagement[]>([["S1", [{ id: "m1", coachId: "c1", source: "MANUAL" }]]]);
  const result = await syncSessionCoaches(
    [session({ operationSessionId: "S1", coachText: "김시은" })],
    existing, [{ id: "c1", name: "김시은" }], writer, TODAY, false
  );
  assert.equal(result.created, 0);
  assert.equal(calls.created.length, 0);
});

test("unmatched 이름은 집계되고 투입 생성 안 함", async () => {
  const { writer } = recordingWriter();
  const result = await syncSessionCoaches(
    [session({ operationSessionId: "S1", coachText: "김시은, 없는코치" })],
    new Map(), [{ id: "c1", name: "김시은" }], writer, TODAY, false
  );
  assert.equal(result.created, 1);
  assert.deepEqual(result.unmatched, [{ operationSessionId: "S1", names: ["없는코치"] }]);
});
