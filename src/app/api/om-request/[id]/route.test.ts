import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, mock, test } from "node:test";

let linked = true;
let assigned = false;
let syncs: unknown[][] = [];
let linkedIds: string[] = [];
let authorized = true;
let writes = 0;
let tools = 0;
const sessions = [{ date: "2099-01-01" }, { date: "2099-02-01" }];
const added = { date: "2099-03-01", timeStart: "09:00", timeEnd: "18:00", location: "합성 장소" };
mock.module("next/server.js", { namedExports: { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } } });
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
mock.module("@/auth", { namedExports: { auth: async () => ({ user: { email: "synthetic@example.invalid" } }) } });
mock.module("@/lib/auth/requireAdminSession", { namedExports: { isAdminEmail: () => authorized } });
mock.module("@/lib/data/omRequest/omRequestLocalRepository", { namedExports: {
  getOmRequest: async () => ({ id: "synthetic-request", company: "합성기업", status: assigned ? "배정완료" : "배정필요", operationId: linked ? "synthetic-operation" : undefined, totalSessions: 2, sessions }),
  setOmRequestOperationId: async (_id: string, operationId: string) => { linkedIds.push(operationId); return null; },
  updateOmRequest: async (_id: string, input: unknown) => { writes++; return input; },
  deleteOmRequest: async () => false
} });
mock.module("@/lib/data/omRequest/omRequestOperationLink", { namedExports: {
  syncOmRequestSessionsToOperations: async (...args: unknown[]) => { syncs.push(args); return "synthetic-new-first"; }
} });
mock.module("@/lib/data/omRequest/omCustomToolsLocalRepository", { namedExports: {
  getOmCustomToolsRepository: () => ({}), listCustomTools: () => [], addCustomTools: () => { tools++; }
} });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const { PATCH } = await import("./route"); hooks.deregister();
const save = (body: unknown) => PATCH(new Request("https://synthetic.invalid/api/om-request/synthetic-request", {
  method: "PATCH", body: JSON.stringify(body)
}), { params: Promise.resolve({ id: "synthetic-request" }) });
beforeEach(() => { linked = true; assigned = false; authorized = true; writes = 0; tools = 0; syncs = []; linkedIds = []; });

test("연결된 요청에서 회차를 추가하면 운영현황 회차를 만들고 요청을 저장한다", async () => {
  const response = await save({ totalSessions: 3, sessions: [...sessions, added], sessionOrigins: [0, 1, null] });
  assert.equal(response.status, 200);
  assert.equal(syncs.length, 1);
  assert.deepEqual(syncs[0][2], [0, 1, null]);
  assert.deepEqual(linkedIds, ["synthetic-new-first"]);
  assert.equal(writes, 1);
});
test("연결된 요청에서 고른 회차를 지우면 그 회차만 운영현황에 반영한다", async () => {
  assert.equal((await save({ totalSessions: 1, sessions: sessions.slice(1), sessionOrigins: [1] })).status, 200);
  assert.deepEqual(syncs[0][2], [1]);
  assert.equal(writes, 1);
});
test("추가한 회차에 일정·시간·장소가 빠지면 저장하지 않는다", async () => {
  const response = await save({ totalSessions: 3, sessions: [...sessions, { ...added, location: " " }], sessionOrigins: [0, 1, null] });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /3회차/);
  assert.equal(syncs.length + writes + tools, 0);
});
test("어느 회차를 지울지 알 수 없는 회차 감소는 저장하지 않는다", async () => {
  assert.equal((await save({ totalSessions: 1, sessions: sessions.slice(0, 1) })).status, 400);
  assert.equal(syncs.length + writes, 0);
});
test("회차 수가 같은 일반 수정은 운영현황 회차를 건드리지 않고 저장한다", async () => {
  assert.equal((await save({ totalSessions: 2, sessions, notes: "Synthetic revised note", sessionOrigins: [0, 1] })).status, 200);
  assert.equal(syncs.length, 0);
  assert.equal(writes, 1);
});
test("회차 수가 같아도 기존 회차 일정을 바꾸면 운영현황에 반영한다", async () => {
  const moved = [sessions[0], { ...sessions[1], date: "2099-02-15" }];
  assert.equal((await save({ totalSessions: 2, sessions: moved, sessionOrigins: [0, 1] })).status, 200);
  assert.equal(syncs.length, 1);
  assert.equal(writes, 1);
});
test("아직 운영현황에 연결되지 않은 요청은 회차 수를 수정할 수 있다", async () => {
  linked = false;
  assert.equal((await save({ totalSessions: 4, sessions: [...sessions, ...sessions] })).status, 200);
  assert.equal(syncs.length, 0);
  assert.equal(writes, 1);
});
test("OM 배정 후에는 관리자도 수정할 수 없다", async () => {
  assigned = true;
  assert.equal((await save({ totalSessions: 2, sessions, sessionOrigins: [0, 1] })).status, 403);
  assert.equal(syncs.length + writes, 0);
});
test("수정 권한을 회차 검사보다 먼저 확인한다", async () => {
  authorized = false;
  assert.equal((await save({ totalSessions: 4, sessions: [...sessions, ...sessions] })).status, 403);
  assert.equal(writes, 0);
});
test("연결된 요청의 기업명을 바꿔도 요청만 저장하고 운영현황은 건드리지 않는다", async () => {
  const response = await save({ company: "새합성기업", totalSessions: 2, sessions, sessionOrigins: [0, 1] });
  assert.equal(response.status, 200);
  assert.equal(syncs.length, 0);
  assert.equal(writes, 1);
});
test("기업명에 띄어쓰기가 있으면 저장하지 않는다", async () => {
  const response = await save({ company: "새 합성기업", totalSessions: 2, sessions, sessionOrigins: [0, 1] });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /띄어쓰기/);
  assert.equal(syncs.length + writes, 0);
});
