import assert from "node:assert/strict";
import { test } from "node:test";
import { nameComboboxSegments } from "./nameComboboxRules";

test("단일 선택은 쉼표가 포함된 이름 전체로 검색·검증한다", () => {
  const value = "Example, Inc";
  const segments = nameComboboxSegments(value, false);
  assert.deepEqual(segments, [value]);
  assert.equal(segments.at(-1)?.trim().toLowerCase(), "example, inc");
});
test("다중 선택은 완료된 이름과 다음 검색어를 구분한다", () => {
  assert.deepEqual(nameComboboxSegments("코치 하나, 코치 둘, ", true), ["코치 하나", " 코치 둘", " "]);
});
