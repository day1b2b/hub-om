import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";

let authorized = true, ready = true, count: number | null = 2, fail = false;
const calls: string[] = [];
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
mock.module("@/lib/auth/requireAdminSession", { namedExports: { assertAdminSession: async () => {
  if (!authorized) throw new Error("forbidden");
  return { user: { email: "admin@example.invalid" } };
} } });
mock.module("@/lib/data/courseDeletionComposition", { namedExports: { runCourseDeletionRequest: async (work: () => Promise<unknown>) => work() } });
mock.module("@/lib/googleCalendar/calendarScope", { namedExports: { assertCalendarScopeReady: () => { if (!ready) throw new Error("scope"); } } });
mock.module("@/lib/data/courseAdminRepositoryFactory", { namedExports: { getCourseAdminRepository: () => ({
  softDeleteCourseSessions: async () => { calls.push("storage"); if (fail) throw new Error("storage"); return count; },
  listDeletedCourseOperationIds: async () => ["first", "second"]
}) } });
let pending = false;
mock.module("@/lib/googleCalendar/reflectOperationToCalendar", { namedExports: { retryOperationCalendarDelete: async (id: string) => {
  calls.push(id); return pending && id === "second" ? "pending" : "completed";
} } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const { DELETE } = await import("./route"); hooks.deregister();
const run = () => DELETE(new Request("https://example.invalid/course", { method: "DELETE" }), { params: Promise.resolve({ courseId: "synthetic" }) });

test("course deletion cleans every deleted session after commit, including retries with zero new deletions", async () => {
  assert.deepEqual(await (await run()).json(), { ok: true, deletedCount: 2, calendarCleanup: "completed" });
  assert.deepEqual(calls, ["storage", "first", "second"]);
  calls.length = 0; count = 0; pending = true;
  assert.deepEqual(await (await run()).json(), { ok: true, deletedCount: 0, calendarCleanup: "pending" });
  assert.deepEqual(calls, ["storage", "first", "second"]);
  calls.length = 0; count = null;
  assert.equal((await run()).status, 404); assert.deepEqual(calls, ["storage"]);
  calls.length = 0; count = 2; fail = true;
  await assert.rejects(run(), /storage/); assert.deepEqual(calls, ["storage"]);
  calls.length = 0; fail = false; authorized = false;
  await assert.rejects(run(), /forbidden/); assert.deepEqual(calls, []);
  authorized = true; ready = false;
  await assert.rejects(run(), /scope/); assert.deepEqual(calls, []);
});
