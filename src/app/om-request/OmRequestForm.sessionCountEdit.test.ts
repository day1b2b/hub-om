import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const formSource = readFileSync(new URL("./OmRequestForm.tsx", import.meta.url), "utf8");
const editPageSource = readFileSync(new URL("./manage/[id]/edit/page.tsx", import.meta.url), "utf8");

test("수정 화면은 기존 회차를 고른 회차만 지우고 출처를 함께 저장한다", () => {
  assert.match(editPageSource, /linkedToOperation=\{Boolean\(request\.operationId\)\}/);
  assert.match(formSource, /className="session-remove-btn"[\s\S]*?onClick=\{\(\) => removeSession\(idx\)\}/);
  assert.match(formSource, /JSON\.stringify\(\{ \.\.\.form, sessionOrigins \}\)/);
  assert.match(formSource, /className="om-session-upload-input"[\s\S]*?disabled=\{linkedToOperation\}/);
});

test("기존 회차 삭제는 운영현황·캘린더 삭제를 경고하고 숫자 감소로는 지우지 않는다", () => {
  assert.match(formSource, /운영현황 회차\(강사·OM 등 입력 정보 포함\)와 구글 캘린더 일정도 함께 삭제됩니다/);
  assert.match(formSource, /기존 회차를 줄이려면 지울 회차의 '삭제' 버튼을 눌러주세요/);
});

test("OM 배정 후에는 수정 화면과 수정 버튼을 열지 않는다", () => {
  const actionsSource = readFileSync(new URL("./manage/[id]/RequestActions.tsx", import.meta.url), "utf8");
  assert.match(editPageSource, /request\.status === "배정완료" \|\|/);
  assert.match(actionsSource, /const canEdit = \(isAdmin \|\| isAuthor\) && !isAssigned;/);
});
