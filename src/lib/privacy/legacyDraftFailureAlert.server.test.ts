import assert from "node:assert/strict";
import { mock, test } from "node:test";

const sent: string[] = [];
mock.module("@/lib/data/teamUsers/teamUserRepository", { namedExports: { listTeamUsers: async () => [{ email: "admin@example.test", slackId: "U_ADMIN" }] } });
mock.module("@/lib/slack/notifySlack", { namedExports: { sendSlackDirectMessage: async (_id: string, text: string) => { sent.push(text); return true; } } });
const { notifyLegacyDraftFailure } = await import("./legacyDraftFailureAlert.server");

test("DMs the admin once per hour per reason and counts the suppressed repeats", async () => {
  process.env.SLACK_ADMIN_ALERT_EMAIL = "admin@example.test";
  assert.equal(await notifyLegacyDraftFailure("quarantine_failed", "a@example.test", 0), "sent");
  assert.equal(await notifyLegacyDraftFailure("quarantine_failed", "b@example.test", 1000), "throttled");
  assert.equal(await notifyLegacyDraftFailure("locks_unsupported", "c@example.test", 2000), "sent");
  assert.equal(await notifyLegacyDraftFailure("quarantine_failed", "d@example.test", 60 * 60 * 1000 + 1), "sent");
  assert.equal(sent.length, 3);
  assert.match(sent[0], /예전 초안 자동 정리 실패/);
  assert.match(sent[2], /같은 사유 1건 더 발생/);
  delete process.env.SLACK_ADMIN_ALERT_EMAIL;
});
