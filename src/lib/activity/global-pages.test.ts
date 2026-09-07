import test from "node:test";
import assert from "node:assert/strict";
import { koreaDate, usageFilters } from "./usage";
import { legacyAction, legacyWhere } from "./legacy";
import { changedText } from "./presentation";

test("today metrics respect KST midnight and exclude monitoring and automated traffic from people", () => {
  const now = new Date("2026-09-07T15:00:00Z");
  assert.equal(koreaDate(now), "2026-09-08");
  const filters = usageFilters("2026-09-08", now);
  assert.deepEqual(filters.occurredAt, { gte: now, lt: new Date("2026-09-08T15:00:00Z") });
  assert.equal(filters.human.actorType, "user");
  assert.equal(filters.automated.actorType, "token_request");
  assert.deepEqual(filters.human.route, { notIn: ["/api/admin/activity", "/api/admin/activity/usage", "/api/activity-feed"] });
  assert.throws(() => usageFilters("2026-09-09", now));
  assert.throws(() => usageFilters("2026-08-09", now));
  assert.throws(() => usageFilters("2026-02-31", now));
});

test("legacy records preserve action filtering and stable date/id pagination", () => {
  assert.equal(legacyAction("메모 작성: 내용"), "create");
  assert.equal(legacyAction("리뷰 삭제"), "delete");
  assert.equal(legacyAction("프로필 수정: name"), "update");
  const where = legacyWhere(new URLSearchParams("email=example&from=2026-09-01&action=delete&cursor=2026-09-07T00:00:00Z|12345678-1234-1234-1234-123456789012"));
  assert.equal(where?.kind, "EDIT_HISTORY");
  assert.deepEqual(where?.authorEmail, { contains: "example", mode: "insensitive" });
  assert.equal((where?.AND as unknown[]).length, 2);
  assert.equal(legacyWhere(new URLSearchParams("actorType=token_request")), null);
  assert.equal(legacyWhere(new URLSearchParams("targetType=announcements")), null);
  assert.equal(legacyWhere(new URLSearchParams("requestId=12345678-1234-1234-1234-123456789012")), null);
});

test("labels never reinterpret a redacted value or truncation object as a name", () => {
  assert.equal(changedText({ name: { after: "before-name", redacted: true } }, "name"), undefined);
  assert.equal(changedText({ name: { after: { truncated: true, preview: "partial" } } }, "name"), undefined);
  assert.equal(changedText({ name: { before: "deleted name", after: null } }, "name"), "deleted name");
});
