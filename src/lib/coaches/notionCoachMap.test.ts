import assert from "node:assert/strict";
import { test } from "node:test";

import { mapPageToCoachRecord, readNotionNo } from "@/lib/coaches/notionCoachMap.ts";

// 속성 타입은 실제 노션 코치 DB 스키마를 그대로 따른다. 특히 "No ID"는 number가 아니라
// unique_id({ prefix: "CH", number: 51 })다. 타입이 틀리면 값을 못 읽어도 테스트는 통과해버리므로
// 여기서 실제 타입을 고정한다. 값은 실제 코치 데이터를 쓰지 않고 가상 값으로 둔다.
function samplePage(overrides: Record<string, unknown> = {}) {
  return {
    id: "3b94576d-6ffa-8191-8ab8-ecc0d609d31f",
    properties: {
      // 노션 auto increment ID("No ID"). 이 값이 노션↔사이트 연결 키다.
      ID: { type: "unique_id", unique_id: { prefix: "CH", number: 51 } },
      이름: { type: "title", title: [{ plain_text: "홍길동" }] },
      연락처: { type: "rich_text", rich_text: [{ plain_text: "010-0000-0000" }] },
      이메일: { type: "rich_text", rich_text: [{ plain_text: "sample@example.com" }] },
      소속: { type: "rich_text", rich_text: [{ plain_text: "샘플파트너스" }] },
      유형: { type: "multi_select", multi_select: [{ name: "삼전 DX" }, { name: "기존" }] },
      "교육 및 가능 분야": { type: "multi_select", multi_select: [{ name: "인공지능" }] },
      "가능 커리큘럼": { type: "multi_select", multi_select: [{ name: "Python 기초" }] },
      "근무 가능 기간": { type: "multi_select", multi_select: [{ name: "하반기 활동 가능" }] },
      ...overrides
    }
  };
}

test("No ID(unique_id)를 연결 키로 읽는다", () => {
  const record = mapPageToCoachRecord(samplePage());
  assert.equal(record?.name, "홍길동");
  assert.equal(record?.notionNo, 51);
});

test("속성 이름이 'No ID'여도 읽는다", () => {
  const page = samplePage({ ID: undefined, "No ID": { type: "unique_id", unique_id: { prefix: "CH", number: 77 } } });
  assert.equal(mapPageToCoachRecord(page)?.notionNo, 77);
});

test("속성 이름이 후보에 없어도 unique_id 타입이면 읽는다", () => {
  const page = samplePage({ ID: undefined, 코치번호: { type: "unique_id", unique_id: { prefix: "CH", number: 12 } } });
  assert.equal(mapPageToCoachRecord(page)?.notionNo, 12);
});

test("No ID가 없는 행은 null이다 (이 경우에만 이름으로 식별)", () => {
  const record = mapPageToCoachRecord(samplePage({ ID: undefined }));
  assert.equal(record?.notionNo, null);
});

test("number 타입 '번호'는 No ID로 쓰지 않는다", () => {
  // 노션 코치 DB에는 auto increment ID와 별개로 사람이 적는 number 속성(번호·사번)이 있다.
  // 이 값은 중복·공란이 생기므로 연결 키가 아니다.
  const properties = { 번호: { type: "number", number: 3 } };
  assert.equal(readNotionNo(properties), null);
});

test("이름이 없으면 건너뛴다", () => {
  const page = samplePage({ 이름: { type: "title", title: [] } });
  assert.equal(mapPageToCoachRecord(page), null);
});

test("근무유형은 신규·기존 태그를 걸러내고 정규화한다", () => {
  const record = mapPageToCoachRecord(samplePage());
  assert.equal(record?.workType, "삼전 DX");
});
