import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { OperationSession } from "@/lib/data/operationTypes";

const logs: unknown[][] = [];
let found = true;
mock.module("@/lib/data/teamUsers/teamUserRepository", { namedExports: {
  listTeamUsers: async () => found ? [{ email: "recipient-private@example.test", slackId: "U_PRIVATE" }] : []
} });
// Slack 발송 함수를 대체하지 않는다. 실제 botPost → conversations.open → botPost를 통과한다.
const { notifyCalendarReflectSkip, buildCalendarReflectSkipMessage } = await import("./notifyCalendarReflectSkip");
const operation = { operationId: "private-operation", companyName: "합성 기업", courseName: "합성 과정", om: "합성 OM", ld: "합성 LD", roundNo: "1" } as OperationSession;
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  found = true; logs.length = 0;
  for (const [name, value] of Object.entries({ SLACK_CALENDAR_ALERT_EMAIL: "recipient-private@example.test", SLACK_OM_REQUEST_BOT_TOKEN: "synthetic-token" })) {
    saved.set(name, process.env[name]); process.env[name] = value;
  }
  for (const level of ["log", "info", "warn", "error", "debug"] as const) mock.method(console, level, (...args: unknown[]) => { logs.push(args); });
  mock.method(globalThis, "fetch", async () => { throw new Error("private-transport@example.test"); });
});
afterEach(() => {
  mock.restoreAll();
  for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  saved.clear();
});

test("수신자 미해결 경고에 이메일·operationId를 남기지 않는다", async () => {
  found = false;
  await notifyCalendarReflectSkip(operation, "승인된 사유");
  assert.deepEqual(logs, [["[gcal-alert] CALENDAR_ALERT_RECIPIENT_NOT_FOUND"]]);
});

for (const failure of ["response", "exception"] as const) {
  test(`실제 Slack 하위 ${failure} 실패와 fallback 순서를 보존하고 원문을 숨긴다`, async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      if (failure === "exception") throw new Error("private-error@example.test", { cause: "private-token" });
      return Response.json({ ok: false, error: "private-token@example.test" });
    });
    await notifyCalendarReflectSkip(operation, "승인된 사유");
    assert.deepEqual(requests.map(request => request.url), ["https://slack.com/api/chat.postMessage", "https://slack.com/api/conversations.open"]);
    assert.equal(requests[0].body.text, buildCalendarReflectSkipMessage(operation, "승인된 사유"));
    assert.equal(requests[0].body.channel, "U_PRIVATE");
    assert.equal(requests[1].body.users, "U_PRIVATE");
    assert.doesNotMatch(JSON.stringify(logs), /private|U_PRIVATE|합성|Error|stack|cause/);
    assert.equal(logs.length, 3);
  });
}

test("Slack 채널 재시도 성공 때도 승인된 DM 본문과 수신자 선택을 보존한다", async () => {
  const bodies: Record<string, unknown>[] = [];
  mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) return Response.json({ ok: false, error: "private-first-failure" });
    if (bodies.length === 2) return Response.json({ ok: true, channel: { id: "D_PRIVATE" } });
    return Response.json({ ok: true, ts: "synthetic-ts" });
  });
  await notifyCalendarReflectSkip(operation, "승인된 사유");
  assert.equal(bodies.length, 3);
  assert.equal(bodies[0].channel, "U_PRIVATE");
  assert.equal(bodies[2].channel, "D_PRIVATE");
  assert.equal(bodies[2].text, bodies[0].text);
  assert.doesNotMatch(JSON.stringify(logs), /private|U_PRIVATE|D_PRIVATE|합성/);
});
