import assert from "node:assert/strict";
import { mock, test } from "node:test";
const deletes: unknown[] = [];
mock.module("@/lib/data/prisma", { namedExports: { getPrismaClient: () => ({ calendarEventLink: { deleteMany: async (args: unknown) => { deletes.push(args); } } }) } });
const { deleteMatchingCalendarEventLink } = await import("./calendarEventLinkRepository");
test("삭제 조건에 회차와 날짜뿐 아니라 조회한 캘린더·이벤트 ID를 포함한다", async () => {
  await deleteMatchingCalendarEventLink({ operationId: "fixture", calendarId: "cal", eventId: "original", eventDate: "2026-09-07" });
  assert.deepEqual(deletes, [{ where: { operationId: "fixture", calendarId: "cal", eventId: "original", eventDate: new Date("2026-09-07T00:00:00Z") } }]);
});
