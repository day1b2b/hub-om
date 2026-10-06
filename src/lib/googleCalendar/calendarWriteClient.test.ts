import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
mock.module("./calendarOperationLock", { namedExports: { calendarLockSignal: () => undefined, withCalendarOperationLock: async (_id: string, run: () => Promise<unknown>) => run() } });
mock.module("./calendarWriteConfig", { namedExports: { readCalendarWriteCredentials: () => ({ clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture" }) } });
const { listUpdatedEvents, resetAccessTokenCache, deleteEvent, shouldRetryCalendarRead } = await import("./calendarWriteClient");
let pages = 0;
let finalPage = 1;
beforeEach(() => {
  pages = 0; finalPage = 1; resetAccessTokenCache();
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture", expires_in: 3600 });
    pages += 1;
    return Response.json({ items: [{ id: `event-${pages}` }], ...(pages < finalPage ? { nextPageToken: `page-${pages+1}` } : {}) });
  });
});
afterEach(() => mock.restoreAll());
test("마지막 페이지까지 읽으면 이벤트를 모두 반환한다", async () => {
  finalPage = 2; const events = await listUpdatedEvents("fixture", "2026-09-07T00:00:00Z");
  assert.deepEqual(events.map(e => e.id), ["event-1", "event-2"]);
});
test("10페이지가 마지막이면 정상 반환한다", async () => {
  finalPage = 10; assert.equal((await listUpdatedEvents("fixture", "2026-09-07T00:00:00Z")).length, 10);
});
test("10페이지 뒤에 결과가 남으면 부분 결과를 전체처럼 반환하지 않는다", async () => {
  finalPage = 11;
  await assert.rejects(listUpdatedEvents("fixture", "2026-09-07T00:00:00Z"), /페이지 상한/);
  assert.equal(pages, 10);
});

test("소급 삭제는 미리보기 ETag를 전달하고 Google 충돌을 성공으로 처리하지 않는다", async () => {
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture" });
    assert.equal(init?.method, "DELETE");
    assert.equal(new Headers(init?.headers).get("If-Match"), "preview-v1");
    assert.match(String(url), /sendUpdates=none/);
    return new Response("changed", { status: 412 });
  });
  await assert.rejects(deleteEvent("cal", "event", { expectedEtag: "preview-v1", notifyAttendees: false }), /412/);
});
test("권한 상실로 인한 404는 소급 삭제 성공으로 처리하지 않는다", async () => {
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture" });
    return new Response(null, { status: 404 });
  });
  await assert.rejects(deleteEvent("cal", "event", { expectedEtag: "preview-v1", notifyAttendees: false }), /권한 상실/);
});

// ── 읽기 재시도 ───────────────────────────────────────────────
// 구글이 순간 5xx를 주면 역반영 라우트가 500이 되고 실패 알림이 나간다.
// 읽기만 한 번 다시 시도해 일시 오류를 흡수한다. 쓰기는 재시도하지 않는다.

test("일시 오류로 볼 상태코드만 재시도 대상이다", () => {
  assert.equal(shouldRetryCalendarRead(500), true);
  assert.equal(shouldRetryCalendarRead(503), true);
  assert.equal(shouldRetryCalendarRead(429), true);
  assert.equal(shouldRetryCalendarRead(403), false);
  assert.equal(shouldRetryCalendarRead(404), false);
  assert.equal(shouldRetryCalendarRead(200), false);
});

test("읽기가 일시 오류를 한 번 만나면 다시 읽어 성공한다", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture" });
    calls += 1;
    if (calls === 1) return new Response("upstream hiccup", { status: 503 });

    return Response.json({ items: [{ id: "event-1" }] });
  });

  const events = await listUpdatedEvents("cal", "2026-09-09T00:00:00.000Z");

  assert.deepEqual(events.map((event) => event.id), ["event-1"]);
  assert.equal(calls, 2);
});

test("읽기가 두 번 다 일시 오류면 오류를 올린다(지속 고장은 알림으로 간다)", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture" });
    calls += 1;

    return new Response("still broken", { status: 503 });
  });

  await assert.rejects(listUpdatedEvents("cal", "2026-09-09T00:00:00.000Z"), /events\.list 실패\(503\)/);
  assert.equal(calls, 2);
});

test("권한·설정 오류(4xx)는 다시 읽지 않는다", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture" });
    calls += 1;

    return new Response("forbidden", { status: 403 });
  });

  await assert.rejects(listUpdatedEvents("cal", "2026-09-09T00:00:00.000Z"), /events\.list 실패\(403\)/);
  assert.equal(calls, 1);
});

test("쓰기는 일시 오류라도 다시 부르지 않는다(중복 생성 방지)", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture" });
    calls += 1;

    return new Response("upstream hiccup", { status: 503 });
  });

  await assert.rejects(deleteEvent("cal", "event", { notifyAttendees: false }));
  assert.equal(calls, 1);
});
