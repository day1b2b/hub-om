import assert from "node:assert/strict";
import { test } from "node:test";

import { missingPromotionFields, parsePromotionDate } from "@/lib/data/importPromotionFields.ts";

const FULL = {
  companyName: "가온물산",
  courseName: "AI 활용 과정",
  startDate: "2026-09-01",
  endDate: "2026-09-02"
};

test("필수 4개가 다 있으면 부족한 것이 없다", () => {
  assert.deepEqual(missingPromotionFields(FULL), []);
});

test("비어 있는 필드를 라벨로 알려준다", () => {
  assert.deepEqual(missingPromotionFields({ ...FULL, endDate: "" }), ["종료일"]);
});

test("여러 개가 비면 모두 알려준다", () => {
  assert.deepEqual(missingPromotionFields({}), ["기업명", "과정명", "시작일", "종료일"]);
});

test('값이 "-"이거나 공백이면 비어 있는 것으로 본다', () => {
  assert.deepEqual(missingPromotionFields({ ...FULL, companyName: "-", courseName: "   " }), [
    "기업명",
    "과정명"
  ]);
});

test("날짜가 있는데 형식이 아니면 형식 확인이라고 알려준다", () => {
  assert.deepEqual(missingPromotionFields({ ...FULL, endDate: "미정" }), ["종료일(형식 확인)"]);
});

test("점·슬래시 구분 날짜도 받아들인다", () => {
  for (const value of ["2026.9.4", "2026/9/4", "2026-09-04"]) {
    assert.deepEqual(missingPromotionFields({ ...FULL, endDate: value }), [], value);
  }
});

test("정의되지 않은 값도 비어 있는 것으로 본다", () => {
  assert.deepEqual(missingPromotionFields({ ...FULL, startDate: undefined }), ["시작일"]);
});

test("날짜 파서는 형식이 맞을 때만 값을 준다", () => {
  assert.equal(parsePromotionDate("2026-09-04")?.getDate(), 4);
  for (const bad of ["", "-", "미정", "26-09-04", "2026-9", undefined]) {
    assert.equal(parsePromotionDate(bad), null, String(bad));
  }
});
