import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

let linked = true;
let authorized = true;
let writes = 0;
let tools = 0;
const sessions = [{ date: "2099-01-01" }, { date: "2099-02-01" }];
mock.module("next/server.js", { namedExports: { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } } });
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
mock.module("@/auth", { namedExports: { auth: async () => ({ user: { email: "synthetic@example.invalid" } }) } });
mock.module("@/lib/auth/requireAdminSession", { namedExports: { isAdminEmail: () => authorized } });
mock.module("@/lib/data/omRequest/omRequestLocalRepository", { namedExports: {
  getOmRequest: async () => ({ id: "synthetic-request", operationId: linked ? "synthetic-operation" : undefined, totalSessions: 2, sessions }),
  updateOmRequest: async (_id: string, input: unknown) => { writes++; return input; },
  deleteOmRequest: async () => false
} });
mock.module("@/lib/data/omRequest/omCustomToolsLocalRepository", { namedExports: {
  getOmCustomToolsRepository: () => ({}), listCustomTools: () => [], addCustomTools: () => { tools++; }
} });
const { PATCH } = await import("./route");
const save = (body: unknown) => PATCH(new Request("https://synthetic.invalid/api/om-request/synthetic-request", {
  method: "PATCH", body: JSON.stringify(body)
}), { params: Promise.resolve({ id: "synthetic-request" }) });
beforeEach(() => { linked = true; authorized = true; writes = 0; tools = 0; });

test("연결된 2회차 요청을 4회차로 바꾸면 저장 전에 차단한다", async () => {
  const response = await save({ totalSessions: 4, sessions: [...sessions, ...sessions] });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /연결된 운영 회차/);
  assert.equal(writes, 0);
  assert.equal(tools, 0);
});
test("회차 감소와 총 회차 수를 유지한 일정 개수 변경도 차단한다", async () => {
  for (const body of [{ totalSessions: 1, sessions: sessions.slice(0, 1) }, { totalSessions: 2, sessions: [...sessions, ...sessions] }]) {
    assert.equal((await save(body)).status, 409);
  }
  assert.equal(writes, 0);
});
test("회차 수가 같은 일반 수정은 저장한다", async () => {
  assert.equal((await save({ totalSessions: 2, sessions, notes: "Synthetic revised note" })).status, 200);
  assert.equal(writes, 1);
});
test("아직 운영현황에 연결되지 않은 요청은 회차 수를 수정할 수 있다", async () => {
  linked = false;
  assert.equal((await save({ totalSessions: 4, sessions: [...sessions, ...sessions] })).status, 200);
  assert.equal(writes, 1);
});
test("수정 권한을 회차 검사보다 먼저 확인한다", async () => {
  authorized = false;
  assert.equal((await save({ totalSessions: 4, sessions: [...sessions, ...sessions] })).status, 403);
  assert.equal(writes, 0);
});
