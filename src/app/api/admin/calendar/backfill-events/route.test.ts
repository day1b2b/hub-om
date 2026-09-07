import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
let allowed = true;
let calls: unknown[] = [];
const previous = process.env.SYNC_API_SECRET;
process.env.SYNC_API_SECRET = "calendar-route-fixture";
after(() => { if (previous === undefined) delete process.env.SYNC_API_SECRET; else process.env.SYNC_API_SECRET = previous; });
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_path: string, _method: string, handler: unknown) => handler } });
mock.module("@/lib/auth/requireAdminSession", { namedExports: { assertAdminSession: async () => { if (!allowed) throw new Error("unauthorized"); return { user: { email: "admin@example.test" } }; } } });
mock.module("@/lib/googleCalendar/backfillCalendarEvents", { namedExports: { backfillMissingCalendarEvents: async () => ({ ok: true }) } });
mock.module("@/lib/googleCalendar/cleanupBackfilledCalendarEvents", { namedExports: {
  previewBackfilledCalendarCleanup: async (ids: string[]) => { calls.push({ preview: ids }); return { ok: true, dryRun: true }; },
  applyBackfilledCalendarCleanup: async (tokens: string[]) => { calls.push({ apply: tokens }); return { ok: true }; }
} });
const { GET, DELETE } = await import("./route");
beforeEach(() => { allowed = true; calls = []; });
test("관리자 미리보기는 삭제를 실행하지 않는다", async () => {
  const response = await GET(new Request("https://example.test/api/admin/calendar/backfill-events?mode=cleanup&operationIds=fixture"));
  assert.equal(response.status, 200); assert.deepEqual(calls, [{ preview: ["fixture"] }]);
});
test("관리자도 원본 회차 ID만으로 삭제할 수 없다", async () => {
  const response = await DELETE(new Request("https://example.test/api/admin/calendar/backfill-events", { method: "DELETE", body: JSON.stringify({ operationIds: ["fixture"] }) }));
  assert.equal(response.status, 400); assert.deepEqual(calls, []);
});
test("인증되지 않은 요청은 삭제 서비스에 도달하지 않는다", async () => {
  allowed = false;
  const response = await DELETE(new Request("https://example.test/api/admin/calendar/backfill-events", { method: "DELETE", body: JSON.stringify({ tokens: ["fixture"] }) }));
  assert.notEqual(response.status, 200); assert.deepEqual(calls, []);
});
test("기존 서버 인증도 명시적으로 선택한 미리보기 토큰만 전달한다", async () => {
  allowed = false;
  const response = await DELETE(new Request("https://example.test/api/admin/calendar/backfill-events", { method: "DELETE", headers: { Authorization: "Bearer calendar-route-fixture" }, body: JSON.stringify({ tokens: ["fixture-token"] }) }));
  assert.equal(response.status, 200); assert.deepEqual(calls, [{ apply: ["fixture-token"] }]);
});

test("크기 초과 본문은 서비스 호출 전에 413으로 거절한다", async () => {
  const response = await DELETE(new Request("https://example.test/api/admin/calendar/backfill-events", { method: "DELETE", body: JSON.stringify({ tokens: ["x".repeat(1_200_001)] }) }));
  assert.equal(response.status, 413); assert.deepEqual(calls, []);
});
