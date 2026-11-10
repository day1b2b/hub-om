import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { cachedRead, clearReadCache } from "@/lib/data/readCache.ts";

beforeEach(() => {
  process.env.READ_CACHE_FORCE = "1";
  delete process.env.READ_CACHE_DISABLED;
  clearReadCache();
});

afterEach(() => {
  delete process.env.READ_CACHE_FORCE;
  clearReadCache();
});

test("활성이 아니면(프로덕션·FORCE 아님) 매번 load를 통과시킨다", async () => {
  delete process.env.READ_CACHE_FORCE;
  let calls = 0;
  const load = async () => { calls += 1; return calls; };
  assert.equal(await cachedRead("k", load), 1);
  assert.equal(await cachedRead("k", load), 2);
});

test("TTL 안에서는 캐시된 값을 돌려주고 load를 다시 부르지 않는다", async () => {
  let calls = 0;
  const load = async () => { calls += 1; return calls; };
  assert.equal(await cachedRead("k", load, 10_000), 1);
  assert.equal(await cachedRead("k", load, 10_000), 1);
  assert.equal(calls, 1);
});

test("TTL이 지나면 다시 load한다", async () => {
  let calls = 0;
  const load = async () => { calls += 1; return calls; };
  assert.equal(await cachedRead("k", load, 0), 1);
  await new Promise((r) => setTimeout(r, 2));
  assert.equal(await cachedRead("k", load, 0), 2);
});

test("동시 요청은 load를 한 번만 부른다(stampede 방지)", async () => {
  let calls = 0;
  const load = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return calls; };
  const [a, b, c] = await Promise.all([cachedRead("k", load), cachedRead("k", load), cachedRead("k", load)]);
  assert.deepEqual([a, b, c], [1, 1, 1]);
  assert.equal(calls, 1);
});

test("실패한 읽기는 캐시하지 않는다(다음 호출이 다시 시도)", async () => {
  let calls = 0;
  const load = async () => { calls += 1; if (calls === 1) throw new Error("일시 장애"); return calls; };
  await assert.rejects(cachedRead("k", load));
  // 첫 실패는 굳지 않으므로 다음 호출이 다시 load → 성공값을 받는다.
  assert.equal(await cachedRead("k", load), 2);
});

test("키가 다르면 서로 간섭하지 않는다", async () => {
  assert.equal(await cachedRead("a", async () => "A"), "A");
  assert.equal(await cachedRead("b", async () => "B"), "B");
  assert.equal(await cachedRead("a", async () => "A2"), "A");
});
