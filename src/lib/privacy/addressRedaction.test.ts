import assert from "node:assert/strict";
import { test } from "node:test";

import { maskAddresses } from "@/lib/privacy/addressRedaction.ts";

test("띄어쓰기 없는 도로명 주소를 동·호까지 함께 가린다", () => {
  assert.equal(maskAddresses("경기도안양시동안구경수대로610번길36,109동2001호"), "[주소 비공개]");
});

test("문장 속 주소만 가리고 앞뒤 문장은 남긴다", () => {
  assert.equal(
    maskAddresses("교재 발송: 서울특별시 강남구 테헤란로 123 4층 (평일 수령)"),
    "교재 발송: [주소 비공개] (평일 수령)"
  );
});

test("지번 주소도 가린다", () => {
  assert.equal(maskAddresses("부산 해운대구 우동 1408-5"), "[주소 비공개]");
});

test("번지 없이 지역 이름만 있으면 주소로 보지 않는다", () => {
  assert.equal(maskAddresses("경기 남부 출강 선호, 서울 강의는 오전만"), "경기 남부 출강 선호, 서울 강의는 오전만");
});

test("강사료 조건 같은 숫자 문장은 그대로 둔다", () => {
  assert.equal(maskAddresses("시간당 15만원, 부가세 별도"), "시간당 15만원, 부가세 별도");
});
