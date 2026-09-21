import test from "node:test";
import assert from "node:assert/strict";
import { hasLegacyDraft } from "./operationDraftSession";

test("legacy 안내는 key 이름만 확인하고 소유 미확인 내용을 읽거나 삭제하지 않는다", () => {
  const keys = ["other", "hub-om:issue-review-draft:fixture"];
  const storage = {
    length: keys.length,
    key: (index: number) => keys[index] ?? null,
    getItem: () => { throw new Error("Unowned plaintext must not be read"); },
    removeItem: () => { throw new Error("Unowned plaintext must not be deleted"); }
  };
  assert.equal(hasLegacyDraft(keys[1], storage), true);
  assert.equal(hasLegacyDraft("not-present", storage), false);
});

test("legacy 저장소 접근 차단은 plaintext fallback 없이 처리한다", () => {
  const blocked = { get length(): number { throw new Error("Storage denied"); }, key: () => null };
  assert.equal(hasLegacyDraft("legacy", blocked), false);
});

test("지연 저장과 삭제는 예약 시점이 아닌 실행 직전의 세션을 확인한다", async (t) => {
  const { runActiveDraftTask } = await import("./operationDraftSession");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queuedOwner = "owner-a";
  let owner = queuedOwner;
  let generation = 1;
  const calls: string[] = [];
  const active = () => owner === queuedOwner && generation === 1;
  setTimeout(() => { void runActiveDraftTask(active, async () => { calls.push(`write:${owner}`); }); }, 300);
  setTimeout(() => { void runActiveDraftTask(active, async () => { calls.push(`remove:${owner}`); }); }, 500);
  owner = "owner-b";
  generation++;
  t.mock.timers.tick(500);
  assert.equal(calls.length, 0);
  owner = queuedOwner;
  assert.equal(runActiveDraftTask(active, async () => { calls.push("old-generation"); }), undefined);
  assert.equal(calls.length, 0);
  generation = 1;
  await runActiveDraftTask(active, async () => { calls.push("current-session"); });
  assert.deepEqual(calls, ["current-session"]);
});

test("읽기 await 중 세션이 바뀌면 이어지는 삭제를 호출하지 않는다", async () => {
  const { runActiveDraftTask } = await import("./operationDraftSession");
  let current = true;
  let finishRead!: () => void;
  let removed = false;
  const read = new Promise<void>(resolve => { finishRead = resolve; });
  const work = (async () => {
    await read;
    await runActiveDraftTask(() => current, async () => { removed = true; });
  })();
  current = false;
  finishRead();
  await work;
  assert.equal(removed, false);
});
