import assert from "node:assert/strict";
import { test } from "node:test";

import { redactFreeText } from "@/lib/data/instructorNotePii.ts";

test("띄어쓰기 없는 도로명 주소를 동·호까지 함께 가린다", () => {
  assert.equal(redactFreeText("경기도안양시동안구경수대로610번길36,109동2001호"), "[주소 비공개]");
});

test("문장 속 주소만 가리고 앞뒤 문장은 남긴다", () => {
  assert.equal(
    redactFreeText("교재 발송: 서울특별시 강남구 테헤란로 123 4층 (평일 수령)"),
    "교재 발송: [주소 비공개] (평일 수령)"
  );
});

test("지번 주소도 가린다", () => {
  assert.equal(redactFreeText("부산 해운대구 우동 1408-5"), "[주소 비공개]");
});

test("번지 없이 지역 이름만 있으면 주소로 보지 않는다", () => {
  assert.equal(redactFreeText("경기 남부 출강 선호, 서울 강의는 오전만"), "경기 남부 출강 선호, 서울 강의는 오전만");
});

test("전화번호·이메일 가림은 그대로 동작한다", () => {
  assert.equal(redactFreeText("담당 010-1234-5678 / a@b.com"), "담당 [연락처 비공개] / [이메일 비공개]");
});
