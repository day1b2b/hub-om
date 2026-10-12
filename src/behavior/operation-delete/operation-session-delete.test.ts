// 기획서: specs/operation-delete.spec.md — 입구 `DELETE /api/operations/[operationId]`
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, mock, test } from "node:test";
import type { OperationRepository } from "@/lib/data/operationRepository";
import type { OperationSession } from "@/lib/data/operationTypes";
import { calendar, installCalendarFake } from "../fakes/calendarFake";

const ENTRANCE = "DELETE /api/operations/[operationId]";
// 회차 삭제 후 정리 재시도 경로는 DB 저장소에서만 열린다(로컬 JSON 모드는 404로 끝남).
process.env.OPERATION_DATA_SOURCE = "db";
process.env.DATABASE_URL ??= "postgresql://behavior-spec@localhost/never-connected";

let authorized = true;
let live = new Map<string, OperationSession>();
let restoreAfterFirstLookup: string | null = null;
const storage: unknown[] = [];
const session = (operationId: string, roundNo: string) => ({ operationId, roundNo, courseId: "C-1", courseName: "과정", companyName: "기업" }) as OperationSession;

await installCalendarFake();
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
mock.module("@/lib/auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => {
  if (!authorized) throw new Error("unauthorized");
  return { user: { email: "member@example.invalid" } };
} } });
const holder: { repository?: OperationRepository } = {};
// Calendar 모듈도 같은 저장소로 "복원됐는지"를 확인하므로, 어떤 모듈보다 먼저 가짜 저장소를 건다.
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => holder.repository } });
const { CalendarReflectingOperationRepository } = await import("@/lib/data/calendarReflectingOperationRepository");
const inner = {
  getOperationById: async (id: string) => {
    const found = live.get(id) ?? null;
    if (!found && restoreAfterFirstLookup === id) { live.set(id, session(id, "3")); restoreAfterFirstLookup = null; }
    return found;
  },
  listOperations: async () => [...live.values()],
  deleteOperation: async (id: string, actor?: string) => { storage.push(["soft-delete", id, actor]); live.delete(id); }
} as unknown as OperationRepository;
holder.repository = new CalendarReflectingOperationRepository(inner);
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const { DELETE } = await import("@/app/api/operations/[operationId]/route"); hooks.deregister();
const deleteSession = async (operationId: string) => {
  const response = await DELETE(new Request(`https://example.invalid/api/operations/${operationId}`, { method: "DELETE" }), { params: Promise.resolve({ operationId }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

beforeEach(() => {
  authorized = true; calendar.reset(); storage.length = 0; restoreAfterFirstLookup = null;
  live = new Map([["op-1", session("op-1", "1")], ["op-2", session("op-2", "2")], ["op-3", session("op-3", "3")]]);
  for (const id of live.keys()) calendar.addEvent(id);
});

test(`회차 삭제는 표시 삭제하고 삭제한 사람을 남긴다 [spec:operation-delete R1 | ${ENTRANCE}]`, async () => {
  assert.equal((await deleteSession("op-2")).status, 200);
  assert.deepEqual(storage, [["soft-delete", "op-2", "member@example.invalid"]]);
});

test(`회차 삭제는 그 회차의 Calendar 일정을 지운다 [spec:operation-delete R2 | ${ENTRANCE}]`, async () => {
  await deleteSession("op-2");
  assert.deepEqual(calendar.eventsOf("op-2"), []);
  assert.deepEqual(calendar.eventsOf("op-3"), ["event-op-3"]);
});

test(`Calendar 삭제가 실패해도 회차 삭제는 유지한다 [spec:operation-delete R3 | ${ENTRANCE}]`, async () => {
  calendar.failDelete = true;
  const result = await deleteSession("op-2");
  assert.equal(result.body.ok, true);
  assert.equal(live.has("op-2"), false);
});

test(`Calendar 삭제가 실패하면 화면에 정리 대기를 알린다 [spec:operation-delete R3 | ${ENTRANCE}]`, { todo: "알려진 빈칸: specs/operation-delete.spec.md" }, async () => {
  calendar.failDelete = true;
  const result = await deleteSession("op-2");
  assert.equal(result.body.calendarCleanup, "pending");
});

test(`이미 지운 회차를 다시 삭제하면 남은 일정 정리를 다시 시도한다 [spec:operation-delete R4 | ${ENTRANCE}]`, async () => {
  calendar.failDelete = true;
  await deleteSession("op-2");
  calendar.failDelete = false;
  const retry = await deleteSession("op-2");
  assert.equal(retry.body.calendarCleanup, "completed");
  assert.deepEqual(calendar.eventsOf("op-2"), []);
});

test(`정리 재시도 중 복원된 회차의 일정은 지우지 않는다 [spec:operation-delete R5 | ${ENTRANCE}]`, async () => {
  calendar.failDelete = true;
  await deleteSession("op-2");
  calendar.failDelete = false;
  restoreAfterFirstLookup = "op-2"; // 재시도 요청이 "없음"을 확인한 직후 다른 관리자가 복원했다.
  await deleteSession("op-2");
  assert.deepEqual(calendar.eventsOf("op-2"), ["event-op-2"]);
});

test(`로그인하지 않으면 회차를 지울 수 없고 아무것도 바뀌지 않는다 [spec:operation-delete R6 | ${ENTRANCE}]`, async () => {
  authorized = false;
  await assert.rejects(deleteSession("op-2"), /unauthorized/);
  assert.deepEqual(storage, []);
  assert.deepEqual(calendar.eventsOf("op-2"), ["event-op-2"]);
});

test(`마지막 남은 회차와 1회차는 지울 수 없다 [spec:operation-delete R8 | ${ENTRANCE}]`, async () => {
  assert.equal((await deleteSession("op-1")).status, 400);
  live = new Map([["op-3", session("op-3", "3")]]);
  assert.equal((await deleteSession("op-3")).status, 400);
  assert.deepEqual(storage, []);
});
