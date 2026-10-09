import assert from "node:assert/strict";
import test from "node:test";
import { memoSaveStatusText } from "./memoSaveStatus";

test("서버 저장 상태와 미저장 상태를 구분한다", () => {
  assert.equal(memoSaveStatusText("idle", false, null), "변경 사항 없음");
  assert.equal(memoSaveStatusText("idle", true, null), "저장하지 않은 변경 사항");
  assert.equal(memoSaveStatusText("saving", true, null), "저장 중…");
  assert.equal(memoSaveStatusText("saved", false, "14:30"), "저장됨 · 14:30");
  assert.equal(memoSaveStatusText("failed", true, null), "저장하지 못했습니다. 다시 시도해 주세요.");
});

test("확인된 성공 시각이 없으면 저장됨으로 표시하지 않는다", () => {
  assert.equal(memoSaveStatusText("saved", false, null), "변경 사항 없음");
});
