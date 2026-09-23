import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

let allowed = true;
let conflict = false;
let email: string | null = "fixture@day1company.co.kr";
const calls: unknown[] = [];
class OmAssignmentConflict extends Error {}
mock.module("next/server.js", { namedExports: { NextResponse: { json: (data: unknown, options?: ResponseInit) => Response.json(data, options) } } });
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
mock.module("@/auth", { namedExports: { auth: async () => ({ user: { name: "fixture", email } }) } });
mock.module("@/lib/auth/omRequestAssignmentAccess", { namedExports: { canManageOmRequestAssignment: async () => { await Promise.resolve(); calls.push("guard"); return allowed; } } });
mock.module("@/lib/data/omRequest/omRequestLocalRepository", { namedExports: { getOmRequest: async () => { calls.push("read"); return { id: "fixture-request", assignedOm: "기존 담당", operationId: "fixture-operation", team: "fixture" }; } } });
mock.module("@/lib/data/omRequest/omRequestAssignment", { namedExports: {
  OmAssignmentConflict,
  previewOmAssignment: async (_existing: unknown, next: string | null, actor: string) => {
    calls.push(["preview", next, actor]);
    if (conflict) throw new OmAssignmentConflict("변경할 회차를 다시 확인해주세요.");
    return { token: "fixture-token", count: 1, operations: [{ operationId: "fixture-operation", omName: "수동 담당" }] };
  },
  assignOmRequestAtomically: async (_existing: unknown, next: string | null, actor: string, token: string) => {
    calls.push(["write", next, actor, token]);
    if (conflict) throw new OmAssignmentConflict("변경할 회차를 다시 확인해주세요.");
    return { updated: { assignedOm: next }, operationIds: ["fixture-operation"] };
  }
} });
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => ({ getOperationById: async () => ({ operationId: "fixture-operation" }) }) } });
mock.module("@/lib/googleCalendar/reflectOperationToCalendar", { namedExports: { reflectOperationUpdated: async () => { calls.push("calendar"); } } });
mock.module("@/lib/slack/notifySlack", { namedExports: { notifyOmAssigned: async () => { calls.push("slack"); } } });
const { POST, PATCH } = await import("./route");
const input = (assignedOm: unknown, token: unknown = "fixture-token") => new Request("http://localhost/api/om-request/assign", { method: "POST", body: JSON.stringify({ id: "fixture-request", assignedOm, confirmationToken: token }) });
beforeEach(() => { allowed = true; conflict = false; email = "fixture@day1company.co.kr"; calls.length = 0; });

test("미리보기는 권한을 await하고 쓰기나 외부 반영 없이 no-store로 반환한다", async () => {
  const response = await POST(input("신규 담당"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).preview.count, 1);
  assert.deepEqual(calls, ["read", "guard", ["preview", "신규 담당", email]]);
});
test("확인한 취소만 원자 저장 이후 캘린더에 전달한다", async () => {
  assert.equal((await PATCH(input(null))).status, 200);
  assert.deepEqual(calls, ["read", "guard", ["write", null, email, "fixture-token"], "calendar"]);
});
test("확인한 수동 배정 변경은 commit 이후 캘린더와 Slack을 반영한다", async () => {
  assert.equal((await PATCH(input("신규 담당"))).status, 200);
  assert.deepEqual(calls, ["read", "guard", ["write", "신규 담당", email, "fixture-token"], "calendar", "slack"]);
});
test("권한 없는 preview/write는 async guard 이후 종료한다", async () => {
  allowed = false;
  for (const handler of [POST, PATCH]) {
    calls.length = 0;
    assert.equal((await handler(input("신규 담당"))).status, 403);
    assert.deepEqual(calls, ["read", "guard"]);
  }
});
test("익명은 대상 정보 조회 전에 거부한다", async () => {
  email = null;
  for (const handler of [POST, PATCH]) assert.equal((await handler(input("신규 담당"))).status, 401);
  assert.deepEqual(calls, []);
});
test("토큰 누락과 변경 충돌은409이며 외부 반영하지 않는다", async () => {
  assert.equal((await PATCH(input("신규 담당", null))).status, 409);
  assert.deepEqual(calls, ["read", "guard"]);
  calls.length = 0;
  conflict = true;
  const response = await PATCH(input("신규 담당"));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /다시 확인/);
  assert.deepEqual(calls, ["read", "guard", ["write", "신규 담당", email, "fixture-token"]]);
});
test("동일 요청 OM도 수동으로 달라진 회차가 있으므로 확인토큰을 검증한다", async () => {
  assert.equal((await PATCH(input("기존 담당"))).status, 200);
  assert.deepEqual(calls, ["read", "guard", ["write", "기존 담당", email, "fixture-token"], "calendar"]);
});
test("누락·공백·숫자 담당자는 취소 null로 해석하지 않는다", async () => {
  for (const next of [undefined, " ", 123, {}, "a".repeat(201)]) {
    for (const handler of [POST, PATCH]) assert.equal((await handler(input(next))).status, 400);
  }
  assert.deepEqual(calls, []);
});
