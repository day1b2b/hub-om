import assert from "node:assert/strict";
import { test } from "node:test";

import { getSeoulToday } from "@/lib/seoulDate";

test("UTC로 자정을 넘긴 시각도 한국 날짜로는 다음날이면 다음날로 계산한다", () => {
  // 2026-08-21 16:00 UTC = 2026-08-22 01:00 KST
  const result = getSeoulToday(new Date("2026-08-21T16:00:00.000Z"));

  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 7);
  assert.equal(result.getDate(), 22);
});

test("UTC로 아직 같은 날이면 한국 날짜도 같은 날이다", () => {
  // 2026-08-21 10:00 UTC = 2026-08-21 19:00 KST
  const result = getSeoulToday(new Date("2026-08-21T10:00:00.000Z"));

  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 7);
  assert.equal(result.getDate(), 21);
});
