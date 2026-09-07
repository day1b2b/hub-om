import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import type { OperationSession } from "@/lib/data/operationTypes";
import type { CalendarEventLink } from "./calendarEventLinkRepository";
let links: CalendarEventLink[] = [];
let unresolvedNames: string[] = [];
let deleteFailure = "";
const removed: string[] = [];
const patched: Record<string, unknown>[] = [];
const notifications: boolean[] = [];
mock.module("./calendarWriteConfig", { namedExports: { isCalendarWriteEnabled: () => true, resolvePartCalendarId: () => "cal" } });
mock.module("./calendarParticipants", { namedExports: { resolveCalendarTargets: async () => ({ partKey: "1파트", attendeeEmails: [], unresolvedNames }) } });
mock.module("./operationCalendarEvent", { namedExports: {
  attendeesChanged: () => true,
  buildCalendarEventBodies: () => [{ eventDate: "2026-09-07", body: { summary: "fixture", start: { date: "2026-09-07" }, end: { date: "2026-09-08" } } }]
} });
mock.module("./calendarWriteClient", { namedExports: {
  insertOperationEvent: async () => "new", readEventAttendees: async () => ["old@example.test"],
  patchEvent: async (_cal: string, _id: string, body: Record<string, unknown>, options: { notifyAttendees: boolean }) => { notifications.push(options.notifyAttendees); patched.push(body); return "updated"; },
  deleteEvent: async (_cal: string, id: string) => { if (id === deleteFailure) throw new Error("simulated failure"); removed.push(id); }
} });
mock.module("./calendarEventLinkRepository", { namedExports: {
  listCalendarEventLinks: async () => [...links], saveCalendarEventLink: async () => {},
  deleteMatchingCalendarEventLink: async (link: CalendarEventLink) => { links = links.filter(x => x.eventId !== link.eventId); }
} });
const { reflectOperationUpdated, reflectOperationDelete } = await import("./reflectOperationToCalendar");
const operation = { operationId: "fixture" } as OperationSession;
const first = { operationId: "fixture", calendarId: "cal", eventId: "first", eventDate: "2026-09-07" };
beforeEach(() => { links = [first]; unresolvedNames = []; deleteFailure = ""; removed.length = 0; patched.length = 0; notifications.length = 0; });
test("장소와 담당자를 비우면 Google PATCH에도 빈 값을 전달한다", async () => {
  await reflectOperationUpdated(operation);
  assert.equal(patched[0].location, ""); assert.deepEqual(patched[0].attendees, []);
});
test("담당자 이메일 해석 실패는 기존 참석자 삭제로 이어지지 않는다", async () => {
  unresolvedNames = ["테스트 담당자"];
  await reflectOperationUpdated(operation);
  assert.equal("attendees" in patched[0], false);
  assert.equal(notifications[0], false);
});
test("두 번째 일정 삭제가 실패해도 첫 번째 성공한 매핑은 정리된다", async () => {
  links.push({ ...first, eventId: "second", eventDate: "2026-09-08" }); deleteFailure = "second";
  await reflectOperationDelete("fixture");
  assert.deepEqual(removed, ["first"]); assert.deepEqual(links.map(x => x.eventId), ["second"]);
  deleteFailure = ""; await reflectOperationDelete("fixture");
  assert.deepEqual(removed, ["first", "second"]); assert.equal(links.length, 0);
});
