import assert from "node:assert/strict";
import { mock, test } from "node:test";
const databaseUrl = process.env.TEST_CALENDAR_LOCK_DATABASE_URL;
mock.module("./calendarWriteConfig", { namedExports: { isCalendarWriteEnabled: () => true } });
test("격리 DB에서 경합·다른 회차·재진입·실패 후 잠금 해제를 검증", { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/calendar_lock_test");
  process.env.DATABASE_URL = databaseUrl;
  const { withCalendarOperationLock } = await import("./calendarOperationLock");
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const first = withCalendarOperationLock("fixture", async () => { acquired(); await wait; });
  await ready;
  await assert.rejects(withCalendarOperationLock("fixture", async () => assert.fail("중복 진입")), /진행 중/);
  await withCalendarOperationLock("other", async () => {});
  release(); await first;
  await assert.rejects(withCalendarOperationLock("fixture", async () => { throw new Error("fixture failure"); }), /fixture failure/);
  await withCalendarOperationLock("fixture", async () => {
    await withCalendarOperationLock("fixture", async () => {});
    await assert.rejects(withCalendarOperationLock("other", async () => {}), /중첩/);
  });
});
