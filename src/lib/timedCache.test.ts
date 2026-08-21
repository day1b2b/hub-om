import assert from "node:assert/strict";
import { test } from "node:test";

import { readTimedCache, type TimedCacheEntry } from "@/lib/timedCache";

const TTL = 60_000;

/** 원하는 시점에 끝낼 수 있는 읽기 — 진행 중 상태를 재현하기 위한 장치. */
function deferredRead<T>(): { readFresh: () => Promise<T>; finish: (value: T) => void; calls: () => number } {
  let calls = 0;
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });

  return {
    readFresh: () => {
      calls += 1;
      return promise;
    },
    finish: (value: T) => resolve?.(value),
    calls: () => calls
  };
}

test("값이 살아 있으면 다시 읽지 않는다", async () => {
  const read = deferredRead<string>();
  const entry: TimedCacheEntry<string> = { expiresAt: Date.now() + TTL, hasValue: true, value: "캐시" };

  const result = await readTimedCache(entry, TTL, read.readFresh);

  assert.equal(result.value, "캐시");
  assert.equal(read.calls(), 0);
});

test("진행 중인 읽기를 onPending으로 공개하면 그 사이 호출은 새로 읽지 않는다", async () => {
  const read = deferredRead<string>();
  let stored: TimedCacheEntry<string> | null = null;

  const first = readTimedCache(stored, TTL, read.readFresh, (pending) => {
    stored = pending;
  });

  // 첫 읽기가 끝나기 전에 들어온 두 번째 호출 — 같은 promise를 기다려야 한다.
  const second = readTimedCache(stored, TTL, read.readFresh, (pending) => {
    stored = pending;
  });

  read.finish("한 번만 읽음");

  assert.equal((await first).value, "한 번만 읽음");
  assert.equal((await second).value, "한 번만 읽음");
  assert.equal(read.calls(), 1);
});

test("onPending을 안 주면 진행 중 읽기를 알 수 없어 요청마다 새로 읽는다(콜백이 필요한 이유)", async () => {
  const read = deferredRead<string>();
  const stored: TimedCacheEntry<string> | null = null;

  const first = readTimedCache(stored, TTL, read.readFresh);
  const second = readTimedCache(stored, TTL, read.readFresh);

  read.finish("값");
  await first;
  await second;

  assert.equal(stored, null);
  assert.equal(read.calls(), 2);
});

test("읽기가 실패하면 캐시가 오염되지 않고 다음 호출이 다시 읽는다", async () => {
  let calls = 0;
  let stored: TimedCacheEntry<string> | null = null;
  const failing = () => {
    calls += 1;
    return Promise.reject(new Error("읽기 실패"));
  };

  await assert.rejects(
    readTimedCache(stored, TTL, failing, (pending) => {
      stored = pending;
    })
  );

  const succeeding = () => {
    calls += 1;
    return Promise.resolve("두 번째는 성공");
  };
  const retry = await readTimedCache(stored, TTL, succeeding, (pending) => {
    stored = pending;
  });

  assert.equal(retry.value, "두 번째는 성공");
  assert.equal(calls, 2);
});
