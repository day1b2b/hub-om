import { test } from "node:test";
import assert from "node:assert/strict";
import { applySessionCoachesByIds, type SessionCoachWriter } from "./sessionCoachSyncWorkflow";
import type { ExistingSessionEngagement } from "./sessionCoachSync";

interface Recorded {
  created: Array<{ coachId: string; operationSessionId: string; sourceEngagementId: string }>;
  schedules: Array<{ engagementId: string; dates: string[] }>;
  converted: string[];
  reactivated: Array<{ ids: string[]; status: string }>;
  cancelled: string[];
}

function fakeWriter(): { writer: SessionCoachWriter; rec: Recorded; } {
  const rec: Recorded = { created: [], schedules: [], converted: [], reactivated: [], cancelled: [] };
  let seq = 0;
  const writer: SessionCoachWriter = {
    async createEngagement(input) {
      const id = `eng-new-${++seq}`;
      rec.created.push({ coachId: input.coachId, operationSessionId: input.operationSessionId, sourceEngagementId: input.sourceEngagementId });
      return { id };
    },
    async replaceSchedules(engagementId, rows) {
      rec.schedules.push({ engagementId, dates: rows.map((r) => r.date.toISOString().slice(0, 10)) });
    },
    async convertToManual(ids) { rec.converted.push(...ids); },
    async reactivateEngagements(ids, status) { rec.reactivated.push({ ids: [...ids], status }); },
    async cancelEngagements(ids) { rec.cancelled.push(...ids); }
  };
  return { writer, rec };
}

const SESSION = {
  operationSessionId: "op-1",
  courseName: "과정A",
  startDate: new Date("2026-03-02T00:00:00.000Z"), // 월
  endDate: new Date("2026-03-04T00:00:00.000Z"), // 수
  scheduleDates: [] as Date[],
  startTime: null,
  endTime: null
};

test("선택 ID로: 신규 생성 + 활성 SHEET 전환 + 선택에서 빠진 활성 MANUAL 취소", async () => {
  const existing: ExistingSessionEngagement[] = [
    { id: "eng-sheet-A", coachId: "coachA", source: "SHEET", status: "SCHEDULED" },
    { id: "eng-manual-B", coachId: "coachB", source: "MANUAL", status: "SCHEDULED" }
  ];
  const { writer, rec } = fakeWriter();

  // coachA(SHEET 보유)+coachC(신규) 선택. coachB는 선택에서 빠짐 → 취소.
  const result = await applySessionCoachesByIds({ ...SESSION, coachIds: ["coachA", "coachC"] }, existing, writer, new Date("2026-03-03T00:00:00.000Z"));

  assert.deepEqual(result, { created: 1, converted: 1, reactivated: 0, cancelled: 1 });
  assert.deepEqual(rec.converted, ["eng-sheet-A"]);
  assert.deepEqual(rec.cancelled, ["eng-manual-B"]);
  assert.equal(rec.created.length, 1);
  assert.equal(rec.created[0].coachId, "coachC");
  assert.equal(rec.created[0].sourceEngagementId, "manual-session:op-1:coachC");
  // 교육일 비어있으면 start~end 평일 전개(월~수 = 3일).
  assert.deepEqual(rec.schedules, [{ engagementId: "eng-new-1", dates: ["2026-03-02", "2026-03-03", "2026-03-04"] }]);
});

test("이미 활성 MANUAL인 코치는 그대로 둔다(멱등: 재생성·중복 없음)", async () => {
  const existing: ExistingSessionEngagement[] = [
    { id: "eng-manual-A", coachId: "coachA", source: "MANUAL", status: "SCHEDULED" }
  ];
  const { writer, rec } = fakeWriter();

  const result = await applySessionCoachesByIds({ ...SESSION, coachIds: ["coachA"] }, existing, writer, new Date("2026-03-03T00:00:00.000Z"));

  assert.deepEqual(result, { created: 0, converted: 0, reactivated: 0, cancelled: 0 });
  assert.equal(rec.created.length, 0);
  assert.equal(rec.cancelled.length, 0);
});

test("취소됐던 MANUAL이 다시 선택되면 재활성(재생성 아님 → 평가 보존)", async () => {
  const existing: ExistingSessionEngagement[] = [
    { id: "eng-manual-A", coachId: "coachA", source: "MANUAL", status: "CANCELLED" }
  ];
  const { writer, rec } = fakeWriter();

  const result = await applySessionCoachesByIds({ ...SESSION, coachIds: ["coachA"] }, existing, writer, new Date("2026-03-03T00:00:00.000Z"));

  assert.deepEqual(result, { created: 0, converted: 0, reactivated: 1, cancelled: 0 });
  assert.deepEqual(rec.reactivated, [{ ids: ["eng-manual-A"], status: "IN_PROGRESS" }]);
  assert.equal(rec.created.length, 0);
});

test("빈 선택이면 취소하지 않는다(빈 본문·실수 클리어로 전원취소되는 사고 방지 — 보수적)", async () => {
  const existing: ExistingSessionEngagement[] = [
    { id: "eng-manual-A", coachId: "coachA", source: "MANUAL", status: "SCHEDULED" },
    { id: "eng-manual-B", coachId: "coachB", source: "MANUAL", status: "SCHEDULED" }
  ];
  const { writer, rec } = fakeWriter();

  const result = await applySessionCoachesByIds({ ...SESSION, coachIds: [] }, existing, writer, new Date("2026-03-03T00:00:00.000Z"));

  assert.deepEqual(result, { created: 0, converted: 0, reactivated: 0, cancelled: 0 });
  assert.equal(rec.cancelled.length, 0);
});
