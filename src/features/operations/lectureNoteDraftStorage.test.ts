import assert from "node:assert/strict";
import { test } from "node:test";
import { blankTab } from "./lectureNoteModel";
import { clearDraft, readDraft, writeDraft, type LectureDraftPort, type StoredDraft } from "./lectureNoteDraftStorage";

function memoryPort(): LectureDraftPort {
  const values = new Map<string, unknown>();
  return {
    async read<T>(kind: string, id: string) { return (structuredClone(values.get(`${kind}:${id}`)) ?? null) as T | null; },
    async write(kind, id, value) { values.set(`${kind}:${id}`, structuredClone(value)); },
    async remove(kind, id) { values.delete(`${kind}:${id}`); }
  };
}
const oldDraft: StoredDraft = { linkDraft: "", mode: "text", updatedAt: "2000-01-01T00:00:00.000Z", tabs: [{ ...blankTab("2000-01-01"), courseSummary: "가상 미저장 기록" }] };

test("오래된 강의 초안도 async 개인 저장소에서 복원하며 회차를 분리한다", async () => {
  const port = memoryPort();
  assert.equal(await writeDraft("old", oldDraft, port), true);
  assert.deepEqual(await readDraft("old", port), oldDraft);
  await clearDraft("other", port);
  assert.equal(await readDraft("other", port), null);
  assert.deepEqual(await readDraft("old", port), oldDraft);
  await clearDraft("old", port);
  assert.equal(await readDraft("old", port), null);
});

test("write promise commit 이전에는 보관 성공을 반환하지 않는다", async () => {
  let commit!: () => void;
  const port = memoryPort();
  let completed = false;
  const result = writeDraft("op", oldDraft, { ...port, write: () => new Promise<void>(resolve => { commit = resolve; }) }).then(value => { completed = true; return value; });
  await Promise.resolve();
  assert.equal(completed, false);
  commit();
  assert.equal(await result, true);
});

test("저장 실패는 실패로 반환하고 기존 입력을 대체하지 않는다", async () => {
  const port = memoryPort();
  await writeDraft("op", oldDraft, port);
  assert.equal(await writeDraft("op", { ...oldDraft, linkDraft: "https://example.test/new" }, { ...port, write: async () => { throw new Error("Quota"); } }), false);
  assert.deepEqual(await readDraft("op", port), oldDraft);
});

test("잠김·손상 read와 remove 실패를 빈 초안이나 삭제 성공으로 숨기지 않는다", async () => {
  const port = memoryPort();
  await assert.rejects(readDraft("op", { ...port, read: async () => { throw new Error("Locked"); } }));
  await port.write("lecture-note", "op", { ...oldDraft, tabs: [null] });
  await assert.rejects(readDraft("op", port));
  await assert.rejects(clearDraft("op", { ...port, remove: async () => { throw new Error("Locked"); } }));
});
