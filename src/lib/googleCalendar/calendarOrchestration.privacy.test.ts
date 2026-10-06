import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { OperationSession } from "@/lib/data/operationTypes";
import type { BackfillPlanItem } from "./backfillCalendarEventsRules";

const generic = "캘린더 작업을 처리하지 못했습니다.";
const logs: unknown[][] = [];
const order: string[] = [];
let enabled = true, ready = true, failAccess = false, failInsert = false, failPatch = false;
let patchMissing = false, failMapping = false;
let currentLinks: typeof links = [];
const operation = { operationId: "private-operation", companyName: "합성 기업", courseName: "합성 과정", educationDates: ["2026-09-30"] } as OperationSession;
const link = { operationId: operation.operationId, eventDate: "2026-09-30", calendarId: "private-calendar", eventId: "private-event" };
const links = [link];
const eventPlan = { eventDate: link.eventDate, eventEndDate: link.eventDate, body: { summary: "승인된 본문", start: { date: link.eventDate }, end: { date: "2026-10-01" } } };
const planItem: BackfillPlanItem = {
  operationId: operation.operationId, companyName: operation.companyName, courseName: operation.courseName,
  roundNo: "1", om: "승인된 OM", onsiteOm: "", operationStatus: "진행중", partKey: "1파트", calendarId: link.calendarId,
  lastDate: link.eventDate, attendeeEmails: ["approved@example.test"], unresolvedNames: ["private-unresolved"], plans: [eventPlan], status: "planned"
};
mock.module("./calendarScope", { namedExports: { assertCalendarScopeReady: () => { order.push("scope"); if (!ready) throw new Error("CALENDAR_SCOPE_MISSING"); } } });
mock.module("./calendarOperationLock", { namedExports: { withCalendarOperationLock: async (_id: string, run: () => Promise<unknown>) => run() } });
mock.module("./calendarOperationRevision", { namedExports: { calendarOperationRevision: () => "same-revision" } });
mock.module("./calendarWriteConfig", { namedExports: {
  isCalendarWriteEnabled: () => { order.push("enabled"); return enabled; },
  listPartCalendars: () => [{ partKey: "1파트", calendarId: link.calendarId }], resolvePartCalendarId: () => link.calendarId
} });
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => ({
  listOperations: async () => { order.push("operations"); return [operation]; },
  getOperationById: async () => operation, getOperationCreatedAt: async () => new Date("2026-09-30")
}) } });
mock.module("@/lib/data/teamUsers/teamUserRepository", { namedExports: { listTeamUsers: async () => [] } });
mock.module("./calendarParticipants", { namedExports: { resolveCalendarTargets: async () => ({ partKey: "1파트", attendeeEmails: ["approved@example.test"], unresolvedNames: planItem.unresolvedNames }) } });
mock.module("./calendarEventLinkRepository", { namedExports: {
  listAllCalendarEventLinks: async () => links,
  listCalendarEventLinks: async () => currentLinks,
  saveCalendarEventLink: async () => { if (failMapping) throw new Error("private-mapping-error"); },
  deleteMatchingCalendarEventLink: async () => {},
  findCalendarEventLinksByCalendar: async () => new Map([[link.eventId, link]])
} });
mock.module("./operationSessionTimestamps", { namedExports: { findOperationUpdatedAt: async () => new Map() } });
mock.module("./calendarWriteClient", { namedExports: {
  readCalendarAccessRole: async () => { if (failAccess) throw new Error("private-access-error"); return "writer"; },
  insertOperationEvent: async () => { if (failInsert) throw new Error("private-insert-error"); return "private-created-event"; },
  readCalendarEventVersion: async () => ({ etag: "version" }),
  patchEvent: async () => { if (failPatch) throw new Error("private-patch-error"); return patchMissing ? "missing" : "updated"; },
  readEventAttendees: async () => [], deleteEvent: async () => {},
  listUpdatedEvents: async () => [{ id: link.eventId, status: "cancelled" }]
} });
mock.module("./backfillCalendarEventsRules", { namedExports: { planCalendarBackfill: () => ({ items: [planItem], inScope: 1, alreadyComplete: 0, excludedNoEducationDates: 0 }) } });
mock.module("./refreshCalendarEventTextsRules", { namedExports: { buildTextPatch: () => ({ summary: "승인된 제목" }) } });
mock.module("./operationCalendarEvent", { namedExports: { attendeesChanged: () => false, buildCalendarEventBodies: () => [eventPlan] } });
mock.module("./notifyCalendarReflectSkip", { namedExports: { notifyCalendarReflectSkip: async () => {} } });
mock.module("./calendarReverseSyncRules", { namedExports: { evaluateEventAgainstOperation: () => ({ kind: "skip", reason: "원본 삭제 무조치" }) } });
const { backfillMissingCalendarEvents } = await import("./backfillCalendarEvents");
const { refreshCalendarEventTexts } = await import("./refreshCalendarEventTexts");
const { planCalendarReverseSync } = await import("./calendarReverseSync");
const { reflectOperationUpdated } = await import("./reflectOperationToCalendar");
beforeEach(() => {
  enabled = true; ready = true; failAccess = false; failInsert = false; failPatch = false; patchMissing = false; failMapping = false;
  currentLinks = links; logs.length = 0; order.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) mock.method(console, level, (...args: unknown[]) => { logs.push(args); });
  mock.method(globalThis, "fetch", async () => { throw new Error("unexpected external request"); });
});
afterEach(() => mock.restoreAll());
function assertPrivateLogsAbsent() {
  assert.doesNotMatch(JSON.stringify(logs), /private-|approved@example|합성|승인된|stack|cause/);
}

test("disabled도 scope 확인을 먼저 하고 누락 때 업무를 시작하지 않는다", async () => {
  enabled = false; ready = false;
  await assert.rejects(backfillMissingCalendarEvents({ dryRun: false, from: "all" }), /CALENDAR_SCOPE_MISSING/);
  assert.deepEqual(order, ["scope"]);
  ready = true; order.length = 0;
  const result = await backfillMissingCalendarEvents({ dryRun: false, from: "all" });
  assert.equal(result.enabled, false);
  assert.equal(result.totals.insertedEvents, 0);
  assert.deepEqual(order, ["scope", "enabled"]);
});

test("backfill accessError·실패 detail은 generic이며 승인 DTO·집계는 유지한다", async () => {
  failAccess = true; failInsert = true; currentLinks = [];
  const result = await backfillMissingCalendarEvents({ dryRun: false, from: "all" });
  assert.equal(result.calendars[0].calendarId, link.calendarId);
  assert.equal(result.calendars[0].accessError, generic);
  assert.equal(result.outcomes[0].operationId, operation.operationId);
  assert.deepEqual(result.outcomes[0].unresolvedNames, planItem.unresolvedNames);
  assert.equal(result.outcomes[0].detail, generic);
  assert.equal(result.totals.failedOperations, 1);
  assert.equal(result.totals.insertedEvents, 0);
  assertPrivateLogsAbsent();
});

test("refresh 실패 결과의 기존 식별자와 실패 집계를 유지한다", async () => {
  failPatch = true;
  const result = await refreshCalendarEventTexts({ dryRun: false });
  assert.equal(result.counts.failed, 1);
  assert.equal(result.outcomes[0].eventId, link.eventId);
  assert.equal(result.outcomes[0].detail, generic);
  assertPrivateLogsAbsent();
});

test("정방향 미해결 이름·재생성 eventId·실패 오류는 로그에 남기지 않는다", async () => {
  patchMissing = true;
  await reflectOperationUpdated(operation);
  assert.ok(logs.some(args => args[0] === "[gcal] CALENDAR_ATTENDEES_UNRESOLVED" && args[1] === 1));
  assert.ok(logs.some(args => args[0] === "[gcal] CALENDAR_EVENT_RECREATED"));
  failMapping = true;
  await reflectOperationUpdated(operation);
  assert.ok(logs.some(args => args[0] === "[gcal] CALENDAR_REFLECT_FAILED"));
  assertPrivateLogsAbsent();
});

test("역반영 삭제 감지 DTO는 유지하고 로그 식별자는 숨긴다", async () => {
  const result = await planCalendarReverseSync({ now: new Date("2026-09-30T12:00:00Z") });
  assert.deepEqual(result.skipped, [{ calendarId: link.calendarId, eventId: link.eventId, reason: "원본 삭제 무조치" }]);
  assert.deepEqual(logs, [["[gcal-reverse] CALENDAR_SOURCE_DELETED"]]);
});
