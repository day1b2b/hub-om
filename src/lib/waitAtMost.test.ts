import assert from "node:assert/strict";
import { test } from "node:test";

import { waitAtMost } from "@/lib/waitAtMost";

test("상한 안에 끝나면 결과를 그대로 준다", async () => {
  const result = await waitAtMost(Promise.resolve("값"), 1_000);

  assert.equal(result, "값");
});

test("상한을 넘기면 null을 주고 원래 읽기는 계속 돈다", async () => {
  let finished = false;
  const slow = new Promise<string>((resolve) => {
    setTimeout(() => {
      finished = true;
      resolve("늦게 도착");
    }, 60);
  });

  assert.equal(await waitAtMost(slow, 10), null);
  assert.equal(finished, false, "상한 시점엔 아직 안 끝났다");

  // 취소하지 않았으므로 뒤에서 계속 돌아 결국 끝난다 — 이 값이 캐시를 채운다.
  assert.equal(await slow, "늦게 도착");
  assert.equal(finished, true);
});

test("상한 안에 실패하면 그 실패를 그대로 올린다", async () => {
  await assert.rejects(waitAtMost(Promise.reject(new Error("실패")), 1_000), /실패/);
});
