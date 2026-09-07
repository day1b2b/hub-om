import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
mock.module("./calendarOperationLock", { namedExports: { calendarLockSignal: () => undefined, withCalendarOperationLock: async (_id: string, run: () => Promise<unknown>) => run() } });
mock.module("./calendarWriteConfig", { namedExports: { readCalendarWriteCredentials: () => ({ clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture" }) } });
const { insertOperationEvent, resetAccessTokenCache } = await import("./calendarWriteClient");
const body = { summary: "fixture", start: { date: "2026-09-07" }, end: { date: "2026-09-08" } };
const identity = { operationId: "fixture", eventDate: "2026-09-07", source: "forward" as const };
let events: Map<string, Record<string, unknown>>;
let posts: string[];
let loseResponse = false;
beforeEach(() => {
  events = new Map(); posts = []; loseResponse = false; resetAccessTokenCache();
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture", expires_in: 3600 });
    if (init?.method === "POST") {
      const event = JSON.parse(String(init.body)); posts.push(event.id);
      if (events.has(event.id)) return new Response(null, { status: 409 });
      events.set(event.id, event);
      if (loseResponse) { loseResponse = false; throw new Error("response lost"); }
      return Response.json(event);
    }
    const id = String(url).split("/").at(-1)!;
    return events.has(id) ? Response.json(events.get(id)) : new Response(null, { status: 404 });
  });
});
afterEach(() => mock.restoreAll());
test("정방향과 소급의 동시 생성이 같은 Google 이벤트를 사용한다", async () => {
  const ids = await Promise.all([insertOperationEvent("cal", body, identity), insertOperationEvent("cal", body, { ...identity, source: "backfill" })]);
  assert.equal(ids[0], ids[1]); assert.equal(events.size, 1);
  assert.match(ids[0], /^[0-9a-v]{64}$/);
});
test("Google 성공 후 DB 저장 실패를 가정한 재시도는 기존 이벤트를 연결한다", async () => {
  const first = await insertOperationEvent("cal", body, identity);
  resetAccessTokenCache();
  assert.equal(await insertOperationEvent("cal", body, identity), first);
  assert.equal(events.size, 1);
});
test("생성 응답 유실 후 재시도도 중복 생성하지 않는다", async () => {
  loseResponse = true;
  await assert.rejects(insertOperationEvent("cal", body, identity), /response lost/);
  await insertOperationEvent("cal", body, identity);
  assert.equal(events.size, 1);
});
test("삭제된 교육일을 다시 추가해도 재시도는 동일한 새 세대에 연결한다", async () => {
  const old = await insertOperationEvent("cal", body, identity);
  events.set(old, { id: old, status: "cancelled" });
  const next = await insertOperationEvent("cal", body, identity);
  assert.notEqual(old, next);
  assert.equal(await insertOperationEvent("cal", body, identity), next);
  assert.equal(events.size, 2);
});
test("표식이 다른 이벤트와 충돌하면 임의 연결이나 추가 생성을 하지 않는다", async () => {
  const id = await insertOperationEvent("cal", body, identity);
  events.set(id, { id });
  await assert.rejects(insertOperationEvent("cal", body, identity), /생성 표식/);
  assert.equal(events.size, 1); assert.equal(posts.length, 2);
});
test("사람이 삭제한 기존 이벤트의 복구도 이전 ID별로 재시도 가능하다", async () => {
  const restored = await insertOperationEvent("cal", body, { ...identity, previousEventId: "old" });
  assert.equal(await insertOperationEvent("cal", body, { ...identity, previousEventId: "old" }), restored);
  assert.equal(events.size, 1);
});

test("역반영으로 다른 날짜에 연결된 이벤트를 원래 날짜에 다시 연결하지 않는다", async () => {
  const moved = await insertOperationEvent("cal", body, identity);
  const next = await insertOperationEvent("cal", body, { ...identity, occupiedEventIds: [moved] });
  assert.notEqual(next, moved); assert.equal(events.size, 2);
});
