import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const formSource = readFileSync(new URL("./OmRequestForm.tsx", import.meta.url), "utf8");
const editPageSource = readFileSync(new URL("./manage/[id]/edit/page.tsx", import.meta.url), "utf8");

test("운영현황에 연결된 요청은 수정 화면에서 회차 수와 일괄 입력을 잠근다", () => {
  assert.match(editPageSource, /sessionCountLocked=\{Boolean\(request\.operationId\)\}/);
  assert.match(formSource, /disabled=\{sessionCountLocked\}[\s\S]*?onChange=\{\(e\) => handleTotalSessionsChange/);
  assert.match(formSource, /className="om-session-upload-input"[\s\S]*?disabled=\{sessionCountLocked\}/);
});

test("회차 잠금 안내는 기존 회차 세부 정보 수정과 관리자 조정 경로를 설명한다", () => {
  assert.match(formSource, /기존 회차의 일정·시간·장소는 수정할 수 있습니다/);
  assert.match(formSource, /관리자에게 연결 회차 조정을 요청해 주세요/);
});
