import assert from "node:assert/strict";
import { test } from "node:test";

import { mapPageToCoachRecord, readEmployeeNo, readNotionNo } from "@/lib/coaches/notionCoachMap.ts";

// 속성 타입은 실제 노션 코치 DB 스키마(2026-09-04 확인)를 그대로 따른다. 연결 키인 "ID"는 number가
// 아니라 unique_id({ prefix: "CO", number: 230 })이고, 사번은 number다. 타입이 틀리면 값을 못 읽어도
// 테스트는 통과해버리므로 여기서 실제 타입을 고정한다.
// 값은 실제 코치 데이터를 쓰지 않고 가상 값으로 둔다.
function samplePage(overrides: Record<string, unknown> = {}) {
  return {
    id: "3b94576d-6ffa-8191-8ab8-ecc0d609d31f",
    properties: {
      // 노션 auto increment ID. 이 값이 노션↔사이트 연결 키다.
      ID: { type: "unique_id", unique_id: { prefix: "CO", number: 230 } },
      // 사번. 키는 아니고 값으로만 담는다.
      사번: { type: "number", number: 91000176 },
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

test("노션 ID를 연결 키로, 사번은 값으로 읽는다", () => {
  const record = mapPageToCoachRecord(samplePage());
  assert.equal(record?.name, "홍길동");
  assert.equal(record?.notionNo, 230);
  assert.equal(record?.employeeNo, "91000176");
});

test("사번 0과 공란은 값이 없는 것으로 본다(발급 전)", () => {
  assert.equal(mapPageToCoachRecord(samplePage({ 사번: { type: "number", number: 0 } }))?.employeeNo, null);
  assert.equal(mapPageToCoachRecord(samplePage({ 사번: { type: "number", number: null } }))?.employeeNo, null);
  assert.equal(mapPageToCoachRecord(samplePage({ 사번: undefined }))?.employeeNo, null);
});

test("사번이 텍스트로 적혀 있어도 숫자만 뽑는다", () => {
  // 계약시트와 같은 규칙: 재계약 차수(-2)와 괄호 메모는 떼어낸다.
  const properties = { 사번: { type: "rich_text", rich_text: [{ plain_text: "91000176-2 (재계약)" }] } };
  assert.equal(readEmployeeNo(properties), "91000176");
});

test("속성 이름이 'No ID'여도 연결 키로 읽는다", () => {
  const page = samplePage({ ID: undefined, "No ID": { type: "unique_id", unique_id: { prefix: "CO", number: 77 } } });
  assert.equal(mapPageToCoachRecord(page)?.notionNo, 77);
});

test("속성 이름이 후보에 없어도 unique_id 타입이면 읽는다", () => {
  const page = samplePage({ ID: undefined, 코치번호: { type: "unique_id", unique_id: { prefix: "CO", number: 12 } } });
  assert.equal(mapPageToCoachRecord(page)?.notionNo, 12);
});

test("ID가 없는 행은 null이다 (이 경우에만 이름으로 식별)", () => {
  const record = mapPageToCoachRecord(samplePage({ ID: undefined }));
  assert.equal(record?.notionNo, null);
});

test("number 타입 '번호'는 연결 키로 쓰지 않는다", () => {
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
