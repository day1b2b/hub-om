import test from "node:test";
import assert from "node:assert/strict";
import { activityQuery } from "./query";

test("Korean inclusive dates convert to UTC half-open bounds", () => {
  const query = activityQuery(new URLSearchParams("from=2026-09-07&until=2026-09-07"));
  assert.deepEqual(query.changes.occurredAt, { gte: new Date("2026-09-06T15:00:00Z"), lt: new Date("2026-09-07T15:00:00Z") });
});
test("reject invalid dates, inverted ranges and malformed cursors", () => {
  for (const value of ["from=2026-02-30", "from=x", "from=2026-09-08&until=2026-09-07", "cursor=oops", "actorType=admin", "action=oops", "requestId=abc"]) {
    assert.throws(() => activityQuery(new URLSearchParams(value)), value);
  }
});
test("stable cursor uses timestamp and ID without requiring the cursor row to survive retention", () => {
  const params = new URLSearchParams({ cursor: "2026-09-07T00:00:00Z|00000000-0000-0000-0000-000000000001", tab: "requests", errors: "true" });
  const result = activityQuery(params);
  assert.deepEqual(result.requests.status, { gte: 400 });
  assert.ok(result.requests.AND);
});
