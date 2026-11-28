import { test } from "node:test";
import assert from "node:assert/strict";
import { nextKstNineAmEpochSeconds } from "./salesSyncSchedule";

const UTC_MIDNIGHT_2026_11_29 = Date.UTC(2026, 10, 29, 0, 0, 0); // 09:00 KST 2026-11-29

test("새벽 4시 KST(=전날 19:00 UTC) 실패는 같은 날 아침 9시 KST로 예약된다", () => {
  const fireAt = Date.UTC(2026, 10, 28, 19, 0, 0); // 04:00 KST 11-29
  assert.equal(nextKstNineAmEpochSeconds(fireAt), Math.floor(UTC_MIDNIGHT_2026_11_29 / 1000));
});

test("정확히 9시 KST에 걸리면 다음 날로 밀어 엄격히 미래를 보장한다", () => {
  const atNine = UTC_MIDNIGHT_2026_11_29;
  assert.equal(nextKstNineAmEpochSeconds(atNine), Math.floor(UTC_MIDNIGHT_2026_11_29 / 1000) + 86_400);
});

test("오전 9시를 막 지난 시각은 다음 날 9시로 간다", () => {
  const justAfterNine = UTC_MIDNIGHT_2026_11_29 + 60_000; // 09:01 KST
  assert.equal(nextKstNineAmEpochSeconds(justAfterNine), Math.floor(UTC_MIDNIGHT_2026_11_29 / 1000) + 86_400);
});

test("반환값은 항상 입력보다 엄격히 미래다", () => {
  const now = Date.UTC(2026, 5, 15, 13, 37, 0);
  assert.ok(nextKstNineAmEpochSeconds(now) > Math.floor(now / 1000));
});
