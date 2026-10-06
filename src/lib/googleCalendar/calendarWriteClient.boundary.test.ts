import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

let active = true;
let scoped = true;
let controller = new AbortController();
let checks = 0;
const logs: unknown[][] = [];
mock.module("./calendarOperationLock", { namedExports: {
  calendarLockSignal: () => scoped ? controller.signal : undefined,
  assertCalendarLockActive: async () => {
    checks += 1;
    if (scoped && !active) throw new Error("private-lease-error@example.test");
  }
} });
mock.module("./calendarWriteConfig", { namedExports: {
  readCalendarWriteCredentials: () => ({ clientId: "synthetic-client", clientSecret: "synthetic-secret", refreshToken: "synthetic-refresh" })
} });
const { deleteEvent, insertEvent, listUpdatedEvents, readCalendarAccessRole, getGoogleB2BAccessToken, resetAccessTokenCache } = await import("./calendarWriteClient");
const generic = "캘린더 작업을 처리하지 못했습니다.";
const body = { summary: "approved-title", start: { date: "2026-09-30" }, end: { date: "2026-10-01" } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  active = true; scoped = true; checks = 0; logs.length = 0;
  controller = new AbortController(); resetAccessTokenCache();
  for (const level of ["log", "info", "warn", "error", "debug"] as const) mock.method(console, level, (...args: unknown[]) => { logs.push(args); });
  mock.method(globalThis, "fetch", async () => { throw new Error("unexpected external request"); });
});
afterEach(() => mock.restoreAll());

test("OAuth 전 잠금 상실이면 전송하지 않는다", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => { calls++; return Response.json({}); });
  active = false;
  await assert.rejects(deleteEvent("cal", "event"), { message: generic });
  assert.equal(calls, 0);
});

test("E1 OAuth 응답 대기 중 상실하면 Calendar 전송은 0이다", async () => {
  const entered = deferred<void>();
  const token = deferred<Response>();
  let oauth = 0, calendar = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("oauth2.googleapis.com")) { oauth++; entered.resolve(); return token.promise; }
    calendar++; return new Response(null, { status: 204 });
  });
  const request = deleteEvent("private-calendar", "private-event");
  await entered.promise;
  active = false;
  token.resolve(Response.json({ access_token: "private-access-token" }));
  await assert.rejects(request, { message: generic });
  assert.equal(oauth, 1); assert.equal(calendar, 0); assert.ok(checks >= 2);
});

test("E2 유효 토큰 캐시도 Calendar 전송 직전에 잠금을 검사한다", async () => {
  let oauth = 0, calendar = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("oauth2.googleapis.com")) { oauth++; return Response.json({ access_token: "cached-token" }); }
    calendar++; return new Response(null, { status: 204 });
  });
  await getGoogleB2BAccessToken();
  const before = checks;
  // 캐시 promise를 await하는 틈에 상실시켜, token 조회 전 검사만 있는 구현을 구별한다.
  queueMicrotask(() => { active = false; });
  await assert.rejects(deleteEvent("cal", "event"), { message: generic });
  assert.equal(oauth, 1); assert.equal(calendar, 0); assert.ok(checks > before);
});

test("E3 800ms GET 재시도 대기 중 상실하면 다음 GET을 보내지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const retry = deferred<void>();
  mock.method(console, "warn", (...args: unknown[]) => { logs.push(args); retry.resolve(); });
  let gets = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "token" });
    gets++; return new Response("private-body", { status: 503 });
  });
  const request = listUpdatedEvents("cal", "2026-09-30T00:00:00Z");
  await retry.promise;
  active = false;
  t.mock.timers.tick(800);
  await assert.rejects(request, { message: generic });
  assert.equal(gets, 1);
  assert.deepEqual(logs, [["[gcal] CALENDAR_READ_RETRY"]]);
});

test("E4 lease 없는 ACL과 비Calendar OAuth는 기존대로 동작한다", async () => {
  scoped = false; active = false;
  let oauth = 0, calendar = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.ok(init?.signal);
    if (String(url).includes("oauth2.googleapis.com")) { oauth++; return Response.json({ access_token: "token" }); }
    calendar++; return Response.json({ accessRole: "writer" });
  });
  assert.equal(await getGoogleB2BAccessToken(), "token");
  assert.equal(await readCalendarAccessRole("cal"), "writer");
  assert.equal(oauth, 1); assert.equal(calendar, 1);
});

for (const stage of ["oauth-error", "oauth-json", "google-body", "google-json", "network"] as const) {
  test(`${stage} 원문·cause·stack이 공개 오류나 로그로 전달되지 않는다`, async () => {
    let calls = 0;
    mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
      calls++;
      if (String(url).includes("oauth2.googleapis.com")) {
        if (stage === "oauth-error") return Response.json({ error: "private-token@example.test" }, { status: 400 });
        if (stage === "oauth-json") return new Response("private-token@example.test", { status: 400 });
        return Response.json({ access_token: "private-token@example.test" });
      }
      if (stage === "network") throw new Error("private-network@example.test", { cause: new Error("private-cause") });
      if (stage === "google-json") return new Response("private-json@example.test");
      const response = new Response("private-body@example.test", { status: 403 });
      mock.method(response, "text", async () => { assert.fail("Google 오류 본문을 읽으면 안 된다"); });
      return response;
    });
    await assert.rejects(insertEvent("private-calendar", body), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, generic);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(error.stack ?? "", /private-/);
      return true;
    });
    assert.equal(calls, stage.startsWith("oauth") ? 1 : 2);
    assert.deepEqual(logs, []);
  });
}
