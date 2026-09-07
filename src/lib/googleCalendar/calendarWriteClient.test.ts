import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
mock.module("./calendarWriteConfig", { namedExports: { readCalendarWriteCredentials: () => ({ clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture" }) } });
const { listUpdatedEvents, resetAccessTokenCache } = await import("./calendarWriteClient");
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
