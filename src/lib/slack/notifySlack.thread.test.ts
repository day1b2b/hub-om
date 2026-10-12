import assert from "node:assert/strict";
import { mock, test } from "node:test";

mock.module("@/lib/data/teamUsers/teamUserRepository", { namedExports: { listTeamUsers: async () => [
  { name: "Synthetic first", email: "first@example.invalid", slackId: "UFIRST" },
  { name: "Synthetic second", email: "second@example.invalid", slackId: "USECOND" },
  { name: "Synthetic LD", email: "ld@example.invalid", slackId: "ULD" }
] } });
const { notifyOmAssigned } = await import("./notifySlack");

test("assignment and reassignment append replies to the original thread with the new OM and LD mentions [spec:om-change R2 | 공통]", async () => {
  const saved = process.env.SLACK_OM_REQUEST_BOT_TOKEN;
  process.env.SLACK_OM_REQUEST_BOT_TOKEN = "synthetic-token";
  const messages: Record<string, unknown>[] = [];
  const fetch = mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://slack.com/api/chat.postMessage");
    messages.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, ts: "reply" });
  });
  try {
    const base = { company: "Synthetic", courseName: "Synthetic course", ld: "Synthetic LD",
      ldEmail: "ld@example.invalid", channel: "CHANNEL", threadTs: "original-thread" };
    await notifyOmAssigned({ ...base, assignedOm: "Synthetic first" });
    await notifyOmAssigned({ ...base, assignedOm: "Synthetic second" });
    assert.equal(messages.length, 2);
    for (const message of messages) {
      assert.equal(message.channel, "CHANNEL"); assert.equal(message.thread_ts, "original-thread");
      assert.match(String(message.text), /<@ULD>/);
    }
    assert.match(String(messages[0].text), /<@UFIRST>/);
    assert.match(String(messages[1].text), /<@USECOND>/);
    assert.doesNotMatch(String(messages[1].text), /<@UFIRST>/);
  } finally {
    fetch.mock.restore();
    if (saved === undefined) delete process.env.SLACK_OM_REQUEST_BOT_TOKEN; else process.env.SLACK_OM_REQUEST_BOT_TOKEN = saved;
  }
});

test("스레드 정보가 없으면 웹훅으로 단독 배정 메시지를 보낸다 [spec:om-change R2 | 공통]", async () => {
  const saved = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = "https://hooks.example.invalid/synthetic";
  const urls: string[] = [];
  const fetch = mock.method(globalThis, "fetch", async (url: string | URL | Request) => { urls.push(String(url)); return Response.json({ ok: true }); });
  try {
    await notifyOmAssigned({ company: "Synthetic", courseName: "Synthetic course", assignedOm: "Synthetic first" });
    assert.deepEqual(urls, ["https://hooks.example.invalid/synthetic"]);
  } finally {
    fetch.mock.restore();
    if (saved === undefined) delete process.env.SLACK_WEBHOOK_URL; else process.env.SLACK_WEBHOOK_URL = saved;
  }
});
