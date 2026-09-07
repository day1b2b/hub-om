import assert from "node:assert/strict";
import { test } from "node:test";
import { blankTab } from "./lectureNoteModel";
import { clearDraft, readDraft, writeDraft, type StoredDraft } from "./lectureNoteDraftStorage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

const oldDraft: StoredDraft = {
  linkDraft: "", mode: "text", updatedAt: "2000-01-01T00:00:00.000Z",
  tabs: [{ ...blankTab("2000-01-01"), courseSummary: "서버에 없는 유일한 기록" }]
};

test("30일이 지난 미저장 기록도 그대로 복원할 수 있다", () => {
  const storage = memoryStorage();
  writeDraft("old", oldDraft, storage);
  assert.deepEqual(readDraft("old", storage), oldDraft);
  assert.deepEqual(readDraft("old", storage), oldDraft);
});

test("다른 회차를 읽거나 지워도 미저장 기록은 유지된다", () => {
  const storage = memoryStorage();
  writeDraft("old", oldDraft, storage);
  assert.equal(readDraft("other", storage), null);
  clearDraft("other", storage);
  assert.deepEqual(readDraft("old", storage), oldDraft);
  clearDraft("old", storage);
  assert.equal(readDraft("old", storage), null);
});
