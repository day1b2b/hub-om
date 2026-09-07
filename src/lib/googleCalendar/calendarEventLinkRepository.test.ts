import assert from "node:assert/strict";
import { mock, test } from "node:test";
let affected = 1;
let moved: unknown;
const deletes: unknown[] = [];
mock.module("@/lib/data/prisma", { namedExports: { getPrismaClient: () => ({ calendarEventLink: { updateMany: async (args: unknown) => { moved = args; return { count: affected }; }, deleteMany: async (args: unknown) => { deletes.push(args); } } }) } });
const { deleteMatchingCalendarEventLink, moveCalendarEventLinkDate } = await import("./calendarEventLinkRepository");
test("삭제 조건에 회차와 날짜뿐 아니라 조회한 캘린더·이벤트 ID를 포함한다", async () => {
  await deleteMatchingCalendarEventLink({ operationId: "fixture", calendarId: "cal", eventId: "original", eventDate: "2026-09-07" });
  assert.deepEqual(deletes, [{ where: { operationId: "fixture", calendarId: "cal", eventId: "original", eventDate: new Date("2026-09-07T00:00:00Z") } }]);
});

test("매핑 이동도 이벤트 식별자가 일치해야 하며 변경된 매핑은 거절한다", async () => {
  const link = { operationId: "fixture", calendarId: "cal", eventId: "original", eventDate: "2026-09-07" };
  await moveCalendarEventLinkDate(link, "2026-09-08");
  assert.deepEqual(moved, { where: { ...link, eventDate: new Date("2026-09-07T00:00:00Z") }, data: { eventDate: new Date("2026-09-08T00:00:00Z") } });
  affected = 0; await assert.rejects(moveCalendarEventLinkDate(link, "2026-09-08"), /매핑이 변경/);
});
