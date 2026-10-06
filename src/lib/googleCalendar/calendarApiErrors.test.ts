import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" ? "next/server.js" : specifier, context);
} });
let failure: unknown;
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_path: string, _method: string, handler: unknown) => handler } });
mock.module("@/lib/auth/requireAdminSession", { namedExports: { assertAdminSession: async () => ({ user: { email: "admin@example.test" } }) } });
mock.module("next/server.js", { namedExports: { NextResponse: Response } });
const fail = async () => { throw failure; };
mock.module("./backfillCalendarEvents", { namedExports: { backfillMissingCalendarEvents: fail } });
mock.module("./refreshCalendarEventTexts", { namedExports: { refreshCalendarEventTexts: fail } });
mock.module("./calendarReverseSync", { namedExports: { planCalendarReverseSync: fail } });
mock.module("./applyCalendarReverseSync", { namedExports: { applyCalendarReverseSync: fail } });
mock.module("./cleanupBackfilledCalendarEvents", { namedExports: { previewBackfilledCalendarCleanup: fail, applyBackfilledCalendarCleanup: fail } });
const backfill = await import("@/app/api/admin/calendar/backfill-events/route");
const refresh = await import("@/app/api/admin/calendar/refresh-events/route");
const reverse = await import("@/app/api/sync/calendar-events/route");
hooks.deregister();
const safe = "미리보기 후 회차가 변경되었습니다.";
const generic = "캘린더 작업을 처리하지 못했습니다.";
const handlers = [
  { name: "backfill GET", run: backfill.GET, method: "GET", status: 500 },
  { name: "backfill POST", run: backfill.POST, method: "POST", status: 500 },
  { name: "backfill DELETE", run: backfill.DELETE, method: "DELETE", status: 400 },
  { name: "refresh GET", run: refresh.GET, method: "GET", status: 500 },
  { name: "refresh POST", run: refresh.POST, method: "POST", status: 500 },
  { name: "reverse GET", run: reverse.GET, method: "GET", status: 500 },
  { name: "reverse POST", run: reverse.POST, method: "POST", status: 500 }
];
for (const handler of handlers) {
  test(`${handler.name} catch는 상태를 유지하며 exact 안전 문구 외에는 generic을 반환한다`, async () => {
    for (const [error, expected] of [
      [new Error(safe), safe],
      [new Error(`${safe} private@example.test`), generic],
      [new Error("미등록 한국어 private-token"), generic],
      [new Error("events.insert 실패(403): private-google-body"), generic],
      [{ message: safe, stack: "private-stack" }, generic]
    ] as const) {
      failure = error;
      const response = await handler.run(new Request("https://example.test/calendar", {
        method: handler.method,
        ...(handler.method === "DELETE" ? { body: JSON.stringify({ tokens: ["synthetic-token"] }) } : {})
      }));
      assert.equal(response.status, handler.status);
      assert.deepEqual(await response.json(), { ok: false, error: expected });
    }
  });
}
