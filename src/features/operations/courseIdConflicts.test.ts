import assert from "node:assert/strict";
import { test } from "node:test";

import { findCourseIdConflicts } from "@/features/operations/courseIdConflicts.ts";

const op = (courseId: string, companyName: string) => ({ courseId, companyName });

test("한 기업 안에서 같은 코스ID를 여러 과정이 쓰는 것은 정상", () => {
  const conflicts = findCourseIdConflicts([
    op("261578", "가온물산"),
    op("261578", "가온물산"),
    op("261578", "가온물산")
  ]);
  assert.equal(conflicts.size, 0);
});

test("두 기업에 같은 코스ID가 걸리면 찾아낸다", () => {
  // 실데이터: 261578에 HL만도 5건 + 효성ITX 1건이 섞여 있었다.
  const conflicts = findCourseIdConflicts([op("261578", "한빛산업"), op("261578", "가온물산")]);
  assert.equal(conflicts.size, 1);
  assert.deepEqual(conflicts.get("261578"), ["가온물산", "한빛산업"]);
});

test("기업명을 가나다순으로 돌려준다", () => {
  const conflicts = findCourseIdConflicts([
    op("1", "한빛"),
    op("1", "가온"),
    op("1", "나래")
  ]);
  assert.deepEqual(conflicts.get("1"), ["가온", "나래", "한빛"]);
});

test("코스ID가 없는 행은 판단하지 않는다", () => {
  const conflicts = findCourseIdConflicts([op("", "가온물산"), op("   ", "한빛산업")]);
  assert.equal(conflicts.size, 0);
});

test("기업명이 없는 행은 판단하지 않는다", () => {
  const conflicts = findCourseIdConflicts([op("261578", ""), op("261578", "  ")]);
  assert.equal(conflicts.size, 0);
});

test("코스ID 표기가 흔들려도 같은 값으로 본다", () => {
  // normalizeCourseId가 제로폭 문자·공백을 정리한다. 표기 차이로 충돌을 놓치면 안 된다.
  const conflicts = findCourseIdConflicts([op(" 261578 ", "가온물산"), op("261578", "한빛산업")]);
  assert.equal(conflicts.size, 1);
});

test("여러 코스ID가 각각 걸려도 모두 찾는다", () => {
  const conflicts = findCourseIdConflicts([
    op("A", "가온"), op("A", "한빛"),
    op("B", "나래"), op("B", "다솜"),
    op("C", "라온"), op("C", "라온")
  ]);
  // normalizeCourseId는 공백·제로폭 문자만 정리하고 대소문자는 그대로 둔다.
  assert.deepEqual([...conflicts.keys()].sort(), ["A", "B"]);
});
