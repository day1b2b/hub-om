import assert from "node:assert/strict";
import test from "node:test";
import { resolveEditableInfoTargets } from "./editableInfoTargets";

test("기본 정보 수정은 현재 회차만 대상으로 한다", () => {
  assert.deepEqual(resolveEditableInfoTargets("round-1"), ["round-1"]);
});

test("과정 담당자 수정은 전달받은 전체 회차를 중복 없이 대상으로 한다", () => {
  assert.deepEqual(resolveEditableInfoTargets("round-1", ["round-1", "round-2", "round-1"]), ["round-1", "round-2"]);
});
