import { test } from "node:test";
import assert from "node:assert/strict";
import { engagementStatusFromDates, expandWeekdays, syncSessionCoaches, type SessionCoachWriter, type SyncSessionInput } from "./sessionCoachSyncWorkflow";
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

function eng(id: string, coachId: string, source: "SHEET" | "MANUAL", status = "SCHEDULED"): ExistingSessionEngagement {
  return { id, coachId, source, status };
}

function recordingWriter() {
  const calls = {
    created: [] as unknown[],
    converted: [] as string[][],
    reactivated: [] as Array<{ ids: string[]; status: string }>,
    cancelled: [] as string[][],
    schedules: [] as Array<{ engagementId: string; dates: string[] }>
  };
  let seq = 0;
  const writer: SessionCoachWriter = {
    async createEngagement(input) { const id = `eng-${++seq}`; calls.created.push({ id, ...input }); return { id }; },
    async replaceSchedules(engagementId, rows) { calls.schedules.push({ engagementId, dates: rows.map((r) => r.date.toISOString().slice(0, 10)) }); },
    async convertToManual(ids) { calls.converted.push(ids); },
    async reactivateEngagements(ids, status) { calls.reactivated.push({ ids, status }); },
    async cancelEngagements(ids) { calls.cancelled.push(ids); }
  };
  return { writer, calls };
}

test("engagementStatusFromDates: 지남=완료, 기간중=진행, 미래=예정", () => {
  assert.equal(engagementStatusFromDates(new Date("2026-10-01"), new Date("2026-10-10"), TODAY), "COMPLETED");
  assert.equal(engagementStatusFromDates(new Date("2026-11-16"), new Date("2026-11-20"), TODAY), "IN_PROGRESS");
  assert.equal(engagementStatusFromDates(new Date("2026-12-01"), new Date("2026-12-05"), TODAY), "SCHEDULED");
});

test("expandWeekdays: 월~금만, 주말 제외", () => {
  // 2026-11-16(월)~11-20(금) → 5일, 11-21(토)·22(일) 제외
  const days = expandWeekdays(new Date("2026-11-16"), new Date("2026-11-22")).map((d) => d.toISOString().slice(0, 10));
  assert.deepEqual(days, ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
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
  assert.equal(calls.created.length, 0);
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
  const created = calls.created[0] as { coachId: string; operationSessionId: string; source: string; status: string; sourceEngagementId: string };
  assert.equal(created.coachId, "c1");
  assert.equal(created.operationSessionId, "S1");
  assert.equal(created.source, "MANUAL");
  assert.equal(created.status, "IN_PROGRESS");
  assert.equal(created.sourceEngagementId, "manual-session:S1:c1");
  assert.deepEqual(calls.schedules[0].dates, ["2026-11-16", "2026-11-17"]);
});

test("apply(D): educationDates가 비면 start~end 평일로 일정 전개", async () => {
  const { writer, calls } = recordingWriter();
  await syncSessionCoaches(
    [session({ operationSessionId: "S1", coachText: "김시은", scheduleDates: [], startDate: new Date("2026-11-16"), endDate: new Date("2026-11-20") })],
    new Map(), [{ id: "c1", name: "김시은" }], writer, TODAY, false
  );
  assert.deepEqual(calls.schedules[0].dates, ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
});

test("apply(A): 명단에서 빠진 활성 MANUAL 취소 + 같은 회차 활성 SHEET 전환", async () => {
  const { writer, calls } = recordingWriter();
  const existing = new Map<string, ExistingSessionEngagement[]>([
    ["S1", [eng("m-old", "c2", "MANUAL"), eng("s-dup", "c1", "SHEET")]]
  ]);
  const result = await syncSessionCoaches(
    [session({ operationSessionId: "S1", coachText: "김시은" })], // c1만, 전부 매칭됨
    existing,
    [{ id: "c1", name: "김시은" }, { id: "c2", name: "이영희" }],
    writer, TODAY, false
  );
  assert.equal(result.created, 0);
  assert.equal(result.cancelled, 1);
  assert.equal(result.converted, 1);
  assert.deepEqual(calls.cancelled[0], ["m-old"]);
  assert.deepEqual(calls.converted[0], ["s-dup"]);
});

test("apply(A): 미매칭 이름이 있으면 그 회차 취소를 하지 않는다", async () => {
  const { writer, calls } = recordingWriter();
  const existing = new Map<string, ExistingSessionEngagement[]>([["S1", [eng("m2", "c2", "MANUAL")]]]);
  const result = await syncSessionCoaches(
    [session({ operationSessionId: "S1", coachText: "김시은, 없는코치" })],
    existing, [{ id: "c1", name: "김시은" }], writer, TODAY, false
  );
  assert.equal(result.cancelled, 0);
  assert.equal(calls.cancelled.length, 0);
  assert.deepEqual(result.unmatched, [{ operationSessionId: "S1", names: ["없는코치"] }]);
});

test("apply(B): 취소됐던 MANUAL이 명단 복귀 시 재활성(재생성 아님)", async () => {
  const { writer, calls } = recordingWriter();
  const existing = new Map<string, ExistingSessionEngagement[]>([["S1", [eng("m1", "c1", "MANUAL", "CANCELLED")]]]);
  const result = await syncSessionCoaches(
    [session({ operationSessionId: "S1", coachText: "김시은" })],
    existing, [{ id: "c1", name: "김시은" }], writer, TODAY, false
  );
  assert.equal(result.reactivated, 1);
  assert.equal(result.created, 0);
  assert.equal(calls.created.length, 0);
  assert.deepEqual(calls.reactivated[0], { ids: ["m1"], status: "IN_PROGRESS" });
});

test("apply: 이미 활성 MANUAL 있으면 아무 쓰기도 하지 않음(멱등)", async () => {
  const { writer, calls } = recordingWriter();
  const existing = new Map<string, ExistingSessionEngagement[]>([["S1", [eng("m1", "c1", "MANUAL")]]]);
  const result = await syncSessionCoaches(
    [session({ operationSessionId: "S1", coachText: "김시은" })],
    existing, [{ id: "c1", name: "김시은" }], writer, TODAY, false
  );
  assert.equal(result.created, 0);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.converted.length, 0);
  assert.equal(calls.reactivated.length, 0);
  assert.equal(calls.cancelled.length, 0);
});
