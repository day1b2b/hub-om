import { test } from "node:test";
import assert from "node:assert/strict";
import { isOperationBackedSourceId } from "./operationBacked";

test("manual-session: 접두사면 운영현황 출신이다", () => {
  assert.equal(isOperationBackedSourceId("manual-session:7580b3ab:9dfdea24"), true);
});

test("UUID 등 다른 형태는 운영현황 출신이 아니다(계약시트·삼성 스케줄시트)", () => {
  assert.equal(isOperationBackedSourceId("2370fdf8-9aaa-4352-9d88-0b90748693fd"), false);
});

test("null·undefined·빈 문자열은 false", () => {
  assert.equal(isOperationBackedSourceId(null), false);
  assert.equal(isOperationBackedSourceId(undefined), false);
  assert.equal(isOperationBackedSourceId(""), false);
});

test("접두사 문자열만으로도 true(경계)", () => {
  assert.equal(isOperationBackedSourceId("manual-session:"), true);
});
