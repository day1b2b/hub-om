// 기획서: specs/om-change.spec.md — 입구 `PATCH /api/admin/database/cell` (회차 OM 칸)
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, mock, test } from "node:test";
import { installSlackFake, omRequest, withLinkedOmRequest } from "../fakes/omAssignmentFake";

const ENTRANCE = "PATCH /api/admin/database/cell";
const TODO = "알려진 빈칸: specs/om-change.spec.md";
let authorized = true;
let storedOm: string | null = "기존 OM";
const writes: Array<Record<string, unknown>> = [];

const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
await installSlackFake();
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
const adminSession = async () => { if (!authorized) throw new Error("forbidden"); return { user: { email: "admin@example.invalid" } }; };
mock.module("@/lib/auth/requireAdminSession", { namedExports: { requireAdminSession: adminSession, assertAdminSession: adminSession } });
mock.module("@/lib/data/adminDatabaseRepositoryFactory", { namedExports: { getAdminDatabaseRepository: () => ({
  updateCell: async (input: Record<string, unknown>) => { writes.push(input); storedOm = input.value as string | null; }
}) } });
const { PATCH } = await import("@/app/api/admin/database/cell/route"); hooks.deregister();
const editOm = (value: string) => withLinkedOmRequest(async () => {
  const response = await PATCH(new Request("http://localhost/api/admin/database/cell", {
    method: "PATCH", body: JSON.stringify({ table: "operation_sessions", rowId: "op-1", field: "omName", value })
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
});

beforeEach(() => { authorized = true; storedOm = "기존 OM"; writes.length = 0; omRequest.reset(); });

test(`DB 화면에서 회차 OM을 고치면 업무요청 담당자도 같은 값이 된다 [spec:om-change R1 | ${ENTRANCE}]`, { todo: TODO }, async () => {
  await editOm("새 OM");
  assert.deepEqual(omRequest.syncCalls, [["op-1", "새 OM"]]);
});

test(`DB 화면에서 회차 OM을 고치면 Slack 접수 스레드에 배정 댓글을 단다 [spec:om-change R2 | ${ENTRANCE}]`, { todo: TODO }, async () => {
  await editOm("새 OM");
  assert.equal(omRequest.slackMessages.length, 1);
});

test(`DB 화면에서 같은 OM으로 다시 저장하거나 비우면 Slack 알림을 보내지 않는다 [spec:om-change R3 | ${ENTRANCE}]`, async () => {
  await editOm("기존 OM");
  await editOm("");
  assert.equal(omRequest.slackMessages.length, 0);
});

test(`DB 화면에서 Slack 알림이 실패해도 OM 변경은 저장된다 [spec:om-change R4 | ${ENTRANCE}]`, async () => {
  omRequest.slackFails = true;
  assert.equal((await editOm("새 OM")).status, 200);
  assert.equal(storedOm, "새 OM");
});

test(`관리자가 아니면 DB 화면에서 OM을 고칠 수 없다 [spec:om-change R5 | ${ENTRANCE}]`, async () => {
  authorized = false;
  await assert.rejects(editOm("새 OM"), /forbidden/);
  assert.deepEqual(writes, []);
});
