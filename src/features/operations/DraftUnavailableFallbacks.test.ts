import assert from "node:assert/strict";
import { test } from "node:test";
import type { OperationSession } from "@/lib/data/operationTypes";
import { lockedIssueValues, lockedSavedHref } from "./draftUnavailableFallback";

const operation = {
  specialNotes: "저장된 특이사항",
  operationIssue: "저장된 회고",
  omUpdate: "저장된 메모",
  driveLink: "https://drive.example.test/folder"
} as OperationSession;

test("초안 연결 실패 화면은 저장된 강의관리 링크를 그대로 사용한다", () => {
  assert.equal(lockedSavedHref("https://sheet.example.test/course"), "https://sheet.example.test/course");
  assert.equal(lockedSavedHref("javascript:alert(1)"), null);
});

test("초안 연결 실패 화면은 서버에 저장된 특이사항과 회고 값을 보존한다", () => {
  assert.deepEqual(lockedIssueValues(operation).map(({ value }) => value), ["저장된 특이사항", "저장된 회고", "저장된 메모"]);
});
