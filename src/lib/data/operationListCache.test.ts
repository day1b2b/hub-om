import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearOperationListCache, listOperationsCached } from "./operationListCache";
import type { OperationRepository } from "./operationRepository";
import type { OperationSession } from "./operationTypes";

function repository(read: () => Promise<OperationSession[]>) {
  let reads = 0;
  return { get reads() { return reads; }, value: { listOperations: () => { reads++; return read(); } } as unknown as OperationRepository };
}
const rows = (id: string) => [{ operationId: id }] as unknown as OperationSession[];

beforeEach(() => clearOperationListCache());

test("reuses the list within the TTL", async () => {
  const repo = repository(async () => rows("a"));
  assert.deepEqual(await listOperationsCached(repo.value), rows("a"));
  assert.deepEqual(await listOperationsCached(repo.value), rows("a"));
  assert.equal(repo.reads, 1);
});

test("a write clears the cache so the next list reads again", async () => {
  let current = "before";
  const repo = repository(async () => rows(current));
  await listOperationsCached(repo.value);
  current = "after";
  clearOperationListCache();
  assert.deepEqual(await listOperationsCached(repo.value), rows("after"));
  assert.equal(repo.reads, 2);
});

test("a read that started before a write is not kept after the write", async () => {
  let release!: () => void;
  const slow = repository(() => new Promise<OperationSession[]>(resolve => { release = () => resolve(rows("stale")); }));
  const pending = listOperationsCached(slow.value);
  clearOperationListCache();
  release();
  assert.deepEqual(await pending, rows("stale"));
  const fresh = repository(async () => rows("fresh"));
  assert.deepEqual(await listOperationsCached(fresh.value), rows("fresh"));
  assert.equal(fresh.reads, 1);
});

test("a failed read is not cached", async () => {
  const failing = repository(async () => { throw new Error("DOWN"); });
  await assert.rejects(listOperationsCached(failing.value), /DOWN/);
  const ok = repository(async () => rows("ok"));
  assert.deepEqual(await listOperationsCached(ok.value), rows("ok"));
});
