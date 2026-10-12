// 기획서: specs/operation-delete.spec.md — 입구 `DELETE /api/admin/courses/[courseId]`
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, mock, test } from "node:test";
import { calendar, installCalendarFake } from "../fakes/calendarFake";

const ENTRANCE = "DELETE /api/admin/courses/[courseId]";
let authorized = true;
let live = new Set<string>();
let deletedIds: string[] = [];
let restoreDuringCleanup: string | null = null;
const storage: unknown[] = [];

await installCalendarFake();
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
mock.module("@/lib/auth/requireAdminSession", { namedExports: {
  assertAdminSession: async () => { if (!authorized) throw new Error("forbidden"); return { user: { email: "admin@example.invalid" } }; },
  requireAdminSession: async () => { if (!authorized) throw new Error("forbidden"); return { user: { email: "admin@example.invalid" } }; }
} });
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => ({
  getOperationById: async (id: string) => live.has(id) ? { operationId: id } : null
}) } });
mock.module("@/lib/data/courseAdminRepositoryFactory", { namedExports: { getCourseAdminRepository: () => ({
  softDeleteCourseSessions: async (courseId: string, actor: string | null) => {
    storage.push(["soft-delete", courseId, actor]);
    const newly = [...live].filter((id) => id.startsWith(courseId));
    for (const id of newly) { live.delete(id); deletedIds.push(id); }
    return newly.length;
  },
  listDeletedCourseOperationIds: async () => {
    if (restoreDuringCleanup) live.add(restoreDuringCleanup); // 정리 직전에 다른 관리자가 복원한 상황
    return [...deletedIds];
  }
}) } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const { DELETE } = await import("@/app/api/admin/courses/[courseId]/route"); hooks.deregister();
const deleteCourse = async () => {
  const response = await DELETE(new Request("https://example.invalid/api/admin/courses/course", { method: "DELETE" }), { params: Promise.resolve({ courseId: "course" }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

beforeEach(() => {
  authorized = true; calendar.reset(); storage.length = 0;
  live = new Set(["course-1", "course-2"]); deletedIds = []; restoreDuringCleanup = null;
  calendar.addEvent("course-1"); calendar.addEvent("course-2");
});

test(`과정 삭제는 회차를 표시 삭제하고 삭제한 사람을 남긴다 [spec:operation-delete R1 | ${ENTRANCE}]`, async () => {
  const result = await deleteCourse();
  assert.equal(result.status, 200);
  assert.deepEqual(storage, [["soft-delete", "course", "admin@example.invalid"]]);
});

test(`과정 삭제는 지운 회차의 Calendar 일정을 지운다 [spec:operation-delete R2 | ${ENTRANCE}]`, async () => {
  await deleteCourse();
  assert.deepEqual(calendar.links, []);
  assert.deepEqual(calendar.removedEvents.sort(), ["event-course-1", "event-course-2"]);
});

test(`Calendar 삭제가 실패해도 삭제는 유지하고 정리 대기를 알린다 [spec:operation-delete R3 | ${ENTRANCE}]`, async () => {
  calendar.failDelete = true;
  const result = await deleteCourse();
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.calendarCleanup, "pending");
  assert.equal(live.size, 0);
});

test(`이미 지운 과정을 다시 삭제하면 남은 일정 정리를 다시 시도한다 [spec:operation-delete R4 | ${ENTRANCE}]`, async () => {
  calendar.failDelete = true;
  await deleteCourse();
  calendar.failDelete = false;
  const retry = await deleteCourse();
  assert.equal(retry.body.calendarCleanup, "completed");
  assert.deepEqual(calendar.links, []);
});

test(`정리 재시도 중 복원된 회차의 일정은 지우지 않는다 [spec:operation-delete R5 | ${ENTRANCE}]`, async () => {
  restoreDuringCleanup = "course-2";
  await deleteCourse();
  assert.deepEqual(calendar.eventsOf("course-2"), ["event-course-2"]);
  assert.deepEqual(calendar.eventsOf("course-1"), []);
});

test(`관리자가 아니면 과정을 지울 수 없고 아무것도 바뀌지 않는다 [spec:operation-delete R6 | ${ENTRANCE}]`, async () => {
  authorized = false;
  await assert.rejects(deleteCourse(), /forbidden/);
  assert.deepEqual(storage, []);
  assert.equal(calendar.links.length, 2);
});
