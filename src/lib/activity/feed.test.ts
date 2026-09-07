import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { authorizeActivityFeed, feedQuery } from "./feed";
const key = "test-only-key-".repeat(4);
test("feed requires a configured dedicated bearer key", () => {
  assert.equal(authorizeActivityFeed(new Headers(), "short"), 503);
  assert.equal(authorizeActivityFeed(new Headers(), key), 401);
  assert.equal(authorizeActivityFeed(new Headers({ authorization: "Bearer wrong" }), key), 401);
  assert.equal(authorizeActivityFeed(new Headers({ authorization: `Bearer ${key}` }), key), 200);
});
test("feed period uses KST dates and summary ignores cursor and table filters", () => {
  const query = feedQuery(new URLSearchParams("period=7&summary=true&action=delete&email=test&from=1900-01-01"), new Date("2026-09-07T16:00:00Z"));
  assert.deepEqual(query.list.changes.occurredAt, { gte: new Date("2026-09-01T15:00:00Z"), lt: new Date("2026-09-08T15:00:00Z") });
  assert.equal(query.list.changes.action, "delete");
  assert.equal(query.summary.changes.action, undefined);
  assert.deepEqual(query.summary.requests.actorEmail, { contains: "test", mode: "insensitive" });
  assert.throws(() => feedQuery(new URLSearchParams("period=100000")));
});
const query = mock.fn(() => { throw new Error("must not query"); });
mock.module("@/lib/data/prisma", { namedExports: { getPrismaClient: query } });
const { GET } = await import("@/app/api/activity-feed/route");
test("feed rejects unauthenticated requests before parsing or DB access", async () => {
  const old = process.env.ACTIVITY_FEED_KEY;
  process.env.ACTIVITY_FEED_KEY = key;
  try { assert.equal((await GET(new Request("http://localhost/api/activity-feed?period=invalid"))).status, 401); assert.equal(query.mock.callCount(), 0); }
  finally { if (old === undefined) delete process.env.ACTIVITY_FEED_KEY; else process.env.ACTIVITY_FEED_KEY = old; }
});
