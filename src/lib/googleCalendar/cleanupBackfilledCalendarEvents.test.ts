import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import type { CalendarEventLink } from "./calendarEventLinkRepository";
const previousSecret = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "calendar-cleanup-fixture-only";
after(() => { if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret; });
const first: CalendarEventLink = { operationId: "fixture", calendarId: "cal", eventId: "first", eventDate: "2026-09-07" };
let links: CalendarEventLink[];
let revision: string;
let deleteFailure: string;
let dbFailure: boolean;
let proofs: Map<string, { etag: string; status: string; source?: string; creationKey?: string }>;
let deleted: string[];
mock.module("./calendarOperationLock", { namedExports: { withCalendarOperationLock: async (_id: string, run: () => Promise<unknown>) => run() } });
mock.module("./calendarOperationRevision", { namedExports: { calendarOperationRevision: () => revision } });
mock.module("./calendarWriteConfig", { namedExports: { isCalendarWriteEnabled: () => true } });
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => ({ getOperationById: async () => ({ operationId: "fixture" }) }) } });
mock.module("./calendarEventLinkRepository", { namedExports: {
  listCalendarEventLinks: async () => [...links],
  deleteMatchingCalendarEventLink: async (link: CalendarEventLink) => {
    if (dbFailure) throw new Error("DB fixture failure");
    links = links.filter(entry => entry.eventId !== link.eventId);
  }
} });
mock.module("./calendarWriteClient", { namedExports: {
  readCalendarCreationProof: async (_cal: string, id: string) => proofs.get(id) ?? null,
  deleteEvent: async (_cal: string, id: string, options: { expectedEtag: string; notifyAttendees: boolean }) => {
    assert.equal(options.notifyAttendees, false); assert.equal(options.expectedEtag, proofs.get(id)?.etag);
    if (id === deleteFailure) throw new Error("Google fixture failure");
    deleted.push(id); proofs.delete(id);
  }
} });
const { previewBackfilledCalendarCleanup, applyBackfilledCalendarCleanup } = await import("./cleanupBackfilledCalendarEvents");
const { signCalendarCleanup, verifyCalendarCleanup } = await import("./calendarCleanupToken");
beforeEach(() => {
  links = [{ ...first }]; revision = "initial"; deleteFailure = ""; dbFailure = false; deleted = [];
  proofs = new Map([["first", { etag: "v1", status: "confirmed", source: "backfill", creationKey: "first" }]]);
});
async function tokens() { return (await previewBackfilledCalendarCleanup(["fixture"])).candidates.map(entry => entry.token); }
test("정방향·출처 불명 이벤트는 삭제 미리보기에서 제외한다", async () => {
  proofs.get("first")!.source = "forward"; assert.deepEqual(await tokens(), []);
  proofs.get("first")!.source = undefined; assert.deepEqual(await tokens(), []);
  assert.deepEqual(deleted, []); assert.equal(links.length, 1);
});
test("서명 변조 또는 만료 토큰은 어떤 삭제도 시작하지 않는다", async () => {
  const [token] = await tokens();
  await assert.rejects(applyBackfilledCalendarCleanup([token, token + "tamper"]), /서명/);
  const expired = signCalendarCleanup({ ...verifyCalendarCleanup(token), expiresAt: Date.now() - 1 });
  const expiredResult = await applyBackfilledCalendarCleanup([expired]);
  assert.equal(expiredResult.ok, false); assert.match(expiredResult.outcomes[0].detail!, /만료/);
  assert.deepEqual(deleted, []);
});
test("미리보기 이후 회차·매핑·Google 변경은 각각 삭제를 거절한다", async () => {
  const selected = await tokens();
  revision = "changed"; assert.equal((await applyBackfilledCalendarCleanup(selected)).ok, false);
  revision = "initial"; links[0].eventId = "new"; assert.equal((await applyBackfilledCalendarCleanup(selected)).ok, false);
  links = [{ ...first }]; proofs.get("first")!.etag = "v2"; assert.equal((await applyBackfilledCalendarCleanup(selected)).ok, false);
  assert.deepEqual(deleted, []);
});
test("부분 실패는 실제 삭제 수를 보고하고 성공한 매핑만 정리한다", async () => {
  links.push({ ...first, eventId: "second", eventDate: "2026-09-08" });
  proofs.set("second", { etag: "v1", status: "confirmed", source: "backfill", creationKey: "second" });
  const selected = await tokens(); deleteFailure = "second";
  const result = await applyBackfilledCalendarCleanup(selected);
  assert.equal(result.ok, false); assert.equal(result.deletedEvents, 1); assert.equal(result.failedEvents, 1);
  assert.deepEqual(links.map(link => link.eventId), ["second"]);
  deleteFailure = "";
  assert.equal((await applyBackfilledCalendarCleanup(selected)).ok, true); assert.equal(links.length, 0);
  assert.deepEqual(deleted, ["first", "second"]);
});
test("Google 삭제 후 DB 실패도 같은 미리보기로 매핑 정리를 재시도한다", async () => {
  const selected = await tokens(); dbFailure = true;
  const firstResult = await applyBackfilledCalendarCleanup(selected);
  assert.equal(firstResult.ok, false); assert.equal(firstResult.deletedEvents, 1); assert.equal(links.length, 1);
  dbFailure = false;
  assert.equal((await applyBackfilledCalendarCleanup(selected)).ok, true);
  assert.equal(links.length, 0); assert.deepEqual(deleted, ["first"]);
});
test("회차 범위와 이벤트 상한을 넘으면 미리보기·적용을 거절한다", async () => {
  await assert.rejects(previewBackfilledCalendarCleanup([]), /1~20/);
  await assert.rejects(applyBackfilledCalendarCleanup([]), /1~100/);
  links = Array.from({ length: 101 }, (_, index) => ({ ...first, eventId: String(index) }));
  await assert.rejects(previewBackfilledCalendarCleanup(["fixture"]), /상한/);
  assert.deepEqual(deleted, []);
});

test("토큰 만료 후에도 이미 삭제된 Google 이벤트의 매핑 정리만 재시도할 수 있다", async () => {
  const [token] = await tokens();
  const expired = signCalendarCleanup({ ...verifyCalendarCleanup(token), expiresAt: Date.now() - 1 });
  proofs.clear();
  assert.equal((await applyBackfilledCalendarCleanup([expired])).ok, true);
  assert.equal(links.length, 0); assert.deepEqual(deleted, []);
});
