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

test("브라우저 보관 성공은 실제로 다시 읽을 수 있을 때만 반환한다", () => {
  const storage = memoryStorage();
  assert.equal(writeDraft("op", oldDraft, storage), true);
  assert.deepEqual(readDraft("op", storage), oldDraft);
  assert.equal(writeDraft("op", oldDraft, { ...storage, setItem: () => {} , getItem: () => null }), false);
});

test("용량 초과로 새 보관이 실패하면 실패를 알리고 기존 보관본을 유지한다", () => {
  const storage = memoryStorage();
  writeDraft("op", oldDraft, storage);
  const full = { ...storage, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(writeDraft("op", { ...oldDraft, linkDraft: "https://new.example" }, full), false);
  assert.deepEqual(readDraft("op", storage), oldDraft);
});

test("저장소 접근이 차단돼도 보관 성공으로 처리하지 않는다", () => {
  const blocked = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("SecurityError"); },
    removeItem: () => {}
  };
  assert.equal(writeDraft("op", oldDraft, blocked), false);
});
