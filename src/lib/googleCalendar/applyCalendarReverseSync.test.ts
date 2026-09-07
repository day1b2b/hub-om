import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import type { ReverseSyncPlan } from "./calendarReverseSync";
import type { ReverseSyncItem } from "./calendarReverseSyncRules";
import type { UpdateOperationInput } from "@/lib/data/operationTypes";
let patchResult: "updated" | "missing" = "updated";
let failPatch = false;
const updates: UpdateOperationInput[] = [];
const item: ReverseSyncItem = {
  action: "캘린더 원복", operationId: "fixture", calendarId: "cal", eventId: "event",
  eventDate: "2026-09-07", eventEndDate: "2026-09-07", partKey: "1파트",
  companyName: "테스트 기업", courseName: "테스트 과정", roundNo: "1", omName: "테스트 담당자",
  perEducationDay: true, eventUpdatedAt: "2026-09-07T01:00:00Z", operationUpdatedAt: "2026-09-07T00:00:00Z", revertFields: ["제목"]
};
let plan: ReverseSyncPlan;
mock.module("./calendarReverseSync", { namedExports: { planCalendarReverseSync: async () => plan } });
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => ({
  getOperationById: async () => ({ operationId: "fixture", educationDates: ["2026-09-07"], timeText: "10:00 ~ 17:00" }),
  updateOperation: async (_id: string, input: UpdateOperationInput) => { updates.push(input); }
}) } });
mock.module("./calendarWriteClient", { namedExports: { patchEvent: async () => { if (failPatch) throw new Error("simulated failure"); return patchResult; } } });
mock.module("./calendarEventLinkRepository", { namedExports: { moveCalendarEventLinkDate: async () => {} } });
mock.module("./operationCalendarEvent", { namedExports: { buildCalendarEventBodies: () => [{ eventDate: "2026-09-07", body: { summary: "fixture", extendedProperties: { private: { hubOmSchedule: "allday" } } } }] } });
mock.module("./calendarReverseSyncRules", { namedExports: { replaceEducationRun: () => ({ dates: ["2026-09-07"], conflict: false }) } });
const { applyCalendarReverseSync } = await import("./applyCalendarReverseSync");
beforeEach(() => {
  patchResult = "updated"; failPatch = false; updates.length = 0;
  plan = { ok: true, enabled: true, lookbackMinutes: 60, minLagSeconds: 120, updatedMin: "2026-09-07T00:00:00Z", calendars: [], items: [{ ...item }], counts: { "운영현황 반영": 0, "캘린더 원복": 1 }, skipped: [] };
});
test("일부 반영 실패는 전체 ok=false로 반환한다", async () => {
  failPatch = true; const result = await applyCalendarReverseSync();
  assert.equal(result.ok, false); assert.equal(result.failedCount, 1); assert.equal(result.appliedCount, 0);
});
test("사라진 이벤트의 원복을 성공으로 보고하지 않는다", async () => {
  patchResult = "missing"; const result = await applyCalendarReverseSync();
  assert.equal(result.ok, false); assert.equal(result.outcomes[0].applied, false);
});
test("종일 일정으로 바꾸면 회차의 기존 시간도 빈 값으로 갱신한다", async () => {
  plan.items = [{ ...item, action: "운영현황 반영", scheduleChange: {
    from: { startDate: "2026-09-07", endDate: "2026-09-07", timeText: "10:00 ~ 17:00" },
    to: { startDate: "2026-09-07", endDate: "2026-09-07", timeText: "" }
  } }];
  const result = await applyCalendarReverseSync();
  assert.equal(result.ok, true); assert.equal(updates[0].timeText, "");
});
test("계획 단계가 실패하면 쓰기를 시작하지 않는다", async () => {
  plan.ok = false; const result = await applyCalendarReverseSync();
  assert.equal(result.ok, false); assert.equal(result.appliedCount, 0); assert.equal(updates.length, 0);
});
