import assert from "node:assert/strict";
import { mock, test } from "node:test";

mock.module("@/lib/data/teamUsers/teamUserRepository", { namedExports: { listTeamUsers: async () => [
  { name: "Synthetic first", email: "first@example.invalid", slackId: "UFIRST" },
  { name: "Synthetic second", email: "second@example.invalid", slackId: "USECOND" },
  { name: "Synthetic LD", email: "ld@example.invalid", slackId: "ULD" }
] } });
const { notifyOmAssigned } = await import("./notifySlack");

test("assignment and reassignment append replies to the original thread with the new OM and LD mentions", async () => {
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

test("intake notification reports a thread, a webhook-only send, or throws when nothing reached Slack", async () => {
  const { notifyOmRequestCreated } = await import("./notifySlack");
  const saved = { token: process.env.SLACK_OM_REQUEST_BOT_TOKEN, channels: process.env.SLACK_OM_REQUEST_CHANNELS, webhook: process.env.SLACK_WEBHOOK_URL };
  const input = { team: "1파트", ld: "Synthetic LD", company: "Synthetic", trainingType: "", courseName: "Synthetic course", syncupLink: "", skillfloSetup: "N", onSiteOperation: "N", coachRequest: "N", totalSessions: 1, sessions: [{ date: "2026-10-20", timeStart: "", timeEnd: "", duration: "", location: "" }], notes: "" };
  let botOk = true, webhookOk = true; const calls: string[] = [];
  const fetch = mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    calls.push(String(url));
    if (String(url).startsWith("https://slack.com/")) return Response.json(botOk ? { ok: true, ts: "intake" } : { ok: false, error: "not_in_channel" });
    return new Response(null, { status: webhookOk ? 200 : 500 });
  });
  try {
    process.env.SLACK_OM_REQUEST_BOT_TOKEN = "synthetic-token";
    process.env.SLACK_OM_REQUEST_CHANNELS = "1파트:CPART1";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.example.invalid/synthetic";
    assert.deepEqual(await notifyOmRequestCreated(input), { channel: "CPART1", ts: "intake" });
    botOk = false;
    assert.equal(await notifyOmRequestCreated(input), null);
    assert.equal(calls.at(-1), "https://hooks.example.invalid/synthetic");
    webhookOk = false;
    await assert.rejects(notifyOmRequestCreated(input), /SLACK_OM_REQUEST_NOT_DELIVERED/);
    delete process.env.SLACK_WEBHOOK_URL;
    await assert.rejects(notifyOmRequestCreated(input), /SLACK_OM_REQUEST_NOT_DELIVERED/);
  } finally {
    fetch.mock.restore();
    for (const [key, value] of [["SLACK_OM_REQUEST_BOT_TOKEN", saved.token], ["SLACK_OM_REQUEST_CHANNELS", saved.channels], ["SLACK_WEBHOOK_URL", saved.webhook]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("assignment notification reports thread or channel delivery and throws when nothing reached Slack", async () => {
  const saved = { token: process.env.SLACK_OM_REQUEST_BOT_TOKEN, webhook: process.env.SLACK_WEBHOOK_URL };
  let botOk = true, webhookOk = true;
  const fetch = mock.method(globalThis, "fetch", async (url: string | URL | Request) =>
    String(url).startsWith("https://slack.com/") ? Response.json(botOk ? { ok: true, ts: "reply" } : { ok: false }) : new Response(null, { status: webhookOk ? 200 : 500 }));
  const base = { company: "Synthetic", courseName: "Synthetic course", assignedOm: "Synthetic first", channel: "CHANNEL", threadTs: "original-thread" };
  try {
    process.env.SLACK_OM_REQUEST_BOT_TOKEN = "synthetic-token";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.example.invalid/synthetic";
    assert.equal(await notifyOmAssigned(base), "thread");
    botOk = false;
    assert.equal(await notifyOmAssigned(base), "channel");
    assert.equal(await notifyOmAssigned({ ...base, threadTs: undefined }), "channel");
    webhookOk = false;
    await assert.rejects(notifyOmAssigned(base), /SLACK_OM_ASSIGNMENT_NOT_DELIVERED/);
  } finally {
    fetch.mock.restore();
    for (const [key, value] of [["SLACK_OM_REQUEST_BOT_TOKEN", saved.token], ["SLACK_WEBHOOK_URL", saved.webhook]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
