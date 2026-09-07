import assert from "node:assert/strict";
import { test } from "node:test";
import { flushLectureNote } from "./flushLectureNote";

test("닫기 중 세 번 연속 입력이 바뀌면 마지막 입력 저장 전에는 닫지 않는다", async () => {
  let pending = { value: "A", editVersion: 1 };
  const sent: string[] = [];
  const closed = await flushLectureNote(() => pending, async (value, version) => {
    sent.push(value);
    pending = { value: String.fromCharCode(value.charCodeAt(0) + 1), editVersion: version + 1 };
    return true;
  });
  assert.deepEqual(sent, ["A", "B", "C"]);
  assert.equal(pending.value, "D");
  assert.equal(closed, false);
  assert.equal(await flushLectureNote(() => pending, async (value) => { sent.push(value); return true; }), true);
  assert.equal(sent.at(-1), "D");
});

test("추가 저장에는 최신 편집 버전을 전달하고 마지막 입력이 저장된 뒤 닫는다", async () => {
  let pending = { value: "before", editVersion: 1 };
  const versions: number[] = [];
  const closed = await flushLectureNote(() => pending, async (_value, version) => {
    versions.push(version);
    if (version === 1) pending = { value: "after", editVersion: 2 };
    return true;
  });
  assert.deepEqual(versions, [1, 2]);
  assert.equal(closed, true);
});

test("후속 저장이 실패하면 닫지 않고 같은 요청을 즉시 반복하지 않는다", async () => {
  let calls = 0;
  const closed = await flushLectureNote(() => ({ value: "unsaved", editVersion: 1 }), async () => { calls += 1; return false; });
  assert.equal(closed, false);
  assert.equal(calls, 1);
});
