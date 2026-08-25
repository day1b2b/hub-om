import assert from "node:assert/strict";
import { test } from "node:test";

import { mapPageToInstructor } from "@/lib/instructors/notionInstructorMap.ts";

// 속성 타입은 실제 노션 강사 DB 스키마(2026-08-18 확인)를 그대로 따른다.
// 특히 소속정보·섭외지양 여부는 rich_text/select가 아니라 multi_select다. 타입이 틀리면
// 코드가 값을 못 읽어도 테스트는 통과해버리므로, 여기서 실제 타입을 고정한다.
// 값은 실제 강사/협력사 데이터를 쓰지 않고 가상 값으로 둔다.
function samplePage() {
  return {
    id: "3284576d-6ffa-80b8-ba67-f52b29c2a2e8",
    properties: {
      // 노션 auto increment ID("NO"). 이 값이 노션↔사이트 연결 키다.
      ID: { type: "unique_id", unique_id: { prefix: null, number: 385 } },
      강사명: { type: "title", title: [{ plain_text: "홍길동" }] },
      소속정보: { type: "multi_select", multi_select: [{ name: "샘플파트너스" }] },
      카테고리: { type: "multi_select", multi_select: [{ name: "생성형AI" }, { name: "마케팅" }] },
      "담당 강의 정보": { type: "multi_select", multi_select: [{ name: "생성형 AI" }, { name: "데이터분석" }] },
      "기본 강사료": { type: "number", number: 3000000 },
      "강사료 특이사항": { type: "rich_text", rich_text: [{ plain_text: "문의 010-1234-5678 / a@b.com" }] },
      메모: { type: "rich_text", rich_text: [{ plain_text: "우수 강사" }] },
      // 실제 옵션은 "섭외지양" 한 개뿐이고, 해당 없으면 값 자체가 비어 있다.
      "섭외지양 여부": { type: "multi_select", multi_select: [{ name: "섭외지양" }] },
      생년월일: { type: "rich_text", rich_text: [{ plain_text: "920407" }] },
      "시범강의 점검표": { type: "url", url: "https://notion.so/check" },
      연락처: { type: "phone_number", phone_number: "010-2693-0047" },
      "이메일 주소": { type: "email", email: "hong@example.com" }
    }
  };
}

test("강사 페이지를 InstructorNote로 매핑한다", () => {
  const mapped = mapPageToInstructor(samplePage());
  assert.ok(mapped);
  assert.equal(mapped.name, "홍길동");
  // 노션 페이지 ID는 대시를 제거해 .local 규칙과 맞춘다.
  assert.equal(mapped.note.notionId, "3284576d6ffa80b8ba67f52b29c2a2e8");

  const notion = mapped.note.notion;
  assert.ok(notion);
  assert.equal(notion.affiliation, "샘플파트너스");
  assert.deepEqual(notion.categories, ["생성형AI", "마케팅"]);
  assert.deepEqual(notion.lectureTopics, ["생성형 AI", "데이터분석"]);
  assert.equal(notion.baseFee, 3000000);
  assert.equal(notion.memo, "우수 강사");
  assert.equal(notion.demoCheckUrl, "https://notion.so/check");
  assert.equal(notion.recruitAvoid, true);
  assert.equal(mapped.note.recruitAvoid, true);
});

test("개인정보(연락처·이메일·생년월일)는 저장 대상에서 제거된다", () => {
  const mapped = mapPageToInstructor(samplePage());
  assert.ok(mapped);
  const notion = mapped.note.notion;
  assert.ok(notion);
  // 컬럼 자체가 없어야 한다.
  assert.equal(notion.contact, undefined);
  assert.equal(notion.email, undefined);
  assert.equal(notion.birthDate, undefined);
  // 자유 입력란에 섞인 번호·메일은 가려진다.
  assert.ok(notion.feeNote?.includes("[연락처 비공개]"));
  assert.ok(notion.feeNote?.includes("[이메일 비공개]"));
  assert.ok(!notion.feeNote?.includes("010-1234-5678"));
  assert.ok(!notion.feeNote?.includes("a@b.com"));
});

test("강사명이 없으면 건너뛴다(null)", () => {
  const mapped = mapPageToInstructor({
    id: "x",
    properties: {
      ID: { type: "unique_id", unique_id: { prefix: null, number: 1 } },
      강사명: { type: "title", title: [] }
    }
  });
  assert.equal(mapped, null);
});

test("소속정보가 여러 개면 콤마로 합쳐 담는다", () => {
  const page = samplePage();
  page.properties.소속정보 = {
    type: "multi_select",
    multi_select: [{ name: "샘플파트너스" }, { name: "전임강사" }]
  };
  const mapped = mapPageToInstructor(page);
  assert.ok(mapped);
  assert.equal(mapped.note.notion?.affiliation, "샘플파트너스, 전임강사");
});

test("섭외지양 여부가 비어 있으면 false다", () => {
  const page = samplePage();
  // 실제 노션에서는 지양 대상이 아닌 강사는 이 속성이 빈 multi_select로 온다.
  page.properties["섭외지양 여부"] = { type: "multi_select", multi_select: [] };
  const mapped = mapPageToInstructor(page);
  assert.ok(mapped);
  assert.equal(mapped.note.recruitAvoid, false);
  assert.equal(mapped.note.notion?.recruitAvoid, false);
});

test("빈 값·미지정 속성은 프로필에서 빠진다", () => {
  const mapped = mapPageToInstructor({
    id: "abc",
    properties: {
      ID: { type: "unique_id", unique_id: { prefix: null, number: 7 } },
      강사명: { type: "title", title: [{ plain_text: "김철수" }] }
    }
  });
  assert.ok(mapped);
  const notion = mapped.note.notion;
  assert.ok(notion);
  assert.equal(notion.affiliation, undefined);
  assert.equal(notion.categories, undefined);
  assert.equal(notion.baseFee, undefined);
  assert.equal(mapped.note.recruitAvoid, false);
});

test("노션 NO(ID)를 읽어 연결 키로 담는다", () => {
  const mapped = mapPageToInstructor(samplePage());
  assert.ok(mapped);
  assert.equal(mapped.notionNo, 385);
  assert.equal(mapped.note.notionNo, 385);
  // 이름도 값으로 함께 저장한다(NO가 키, 이름은 따라오는 값).
  assert.equal(mapped.note.instructorName, "홍길동");
});

test("NO가 없으면 건너뛴다(null)", () => {
  // 연결 키가 없으면 어느 행인지 특정할 수 없어 저장하면 안 된다.
  const page = samplePage();
  delete (page.properties as Record<string, unknown>).ID;
  assert.equal(mapPageToInstructor(page), null);
});
