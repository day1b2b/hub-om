import assert from "node:assert/strict";
import test from "node:test";
import { commonNoteEntries } from "./courseCommonNoteModel";

test("공통 메모는 값이 있는 항목만 과정 단위로 표시한다", () => {
  assert.deepEqual(
    commonNoteEntries({ specialNotes: "  과정 특이사항  ", operationIssue: "", omUpdate: "\n다음 회차 전 확인\n" }),
    [
      { label: "특이사항 / 이슈", value: "과정 특이사항" },
      { label: "메모", value: "다음 회차 전 확인" }
    ]
  );
});
