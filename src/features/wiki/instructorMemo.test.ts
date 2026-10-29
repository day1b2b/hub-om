import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyMemo, parseInstructorMemo, serializeInstructorMemo } from "@/features/wiki/instructorMemo.ts";

test("parseInstructorMemo: 머리말로 5칸을 나누고, 머리말 없는 예전 메모는 비고로 읽는다", () => {
  assert.deepEqual(parseInstructorMemo("장비 점검 요청 많음"), { ...emptyMemo(), 비고: "장비 점검 요청 많음" });

  const memo = parseInstructorMemo("[강점]\n설명이 쉬움\n\n[유의사항]\n리허설 30분\n두 줄째\n\n[비고]\n기타");
  assert.equal(memo.강점, "설명이 쉬움");
  assert.equal(memo.유의사항, "리허설 30분\n두 줄째");
  assert.equal(memo["소통 스타일"], "");
  assert.equal(memo.비고, "기타");
});

test("serializeInstructorMemo: 빈 칸은 빼고 순서대로 저장하며, 다시 읽으면 같은 값", () => {
  const memo = { ...emptyMemo(), 유의사항: "리허설 30분", 강점: " 설명이 쉬움 " };
  const text = serializeInstructorMemo(memo);
  assert.equal(text, "[강점]\n설명이 쉬움\n\n[유의사항]\n리허설 30분");
  assert.deepEqual(parseInstructorMemo(text), { ...emptyMemo(), 강점: "설명이 쉬움", 유의사항: "리허설 30분" });
  assert.equal(serializeInstructorMemo(emptyMemo()), "");
});
