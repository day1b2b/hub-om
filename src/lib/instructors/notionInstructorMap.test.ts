import assert from "node:assert/strict";
import { test } from "node:test";

import { mapPageToInstructor } from "@/lib/instructors/notionInstructorMap.ts";

function samplePage() {
  return {
    id: "3284576d-6ffa-80b8-ba67-f52b29c2a2e8",
    properties: {
      강사명: { type: "title", title: [{ plain_text: "홍길동" }] },
      소속정보: { type: "rich_text", rich_text: [{ plain_text: "블랙브레인" }] },
      카테고리: { type: "multi_select", multi_select: [{ name: "생성형AI" }, { name: "마케팅" }] },
      "담당 강의 정보": { type: "multi_select", multi_select: [{ name: "생성형 AI" }, { name: "데이터분석" }] },
      "기본 강사료": { type: "number", number: 3000000 },
      "강사료 특이사항": { type: "rich_text", rich_text: [{ plain_text: "문의 010-1234-5678 / a@b.com" }] },
      메모: { type: "rich_text", rich_text: [{ plain_text: "우수 강사" }] },
      "섭외지양 여부": { type: "select", select: { name: "지양" } },
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
  assert.equal(notion.affiliation, "블랙브레인");
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
  const mapped = mapPageToInstructor({ id: "x", properties: { 강사명: { type: "title", title: [] } } });
  assert.equal(mapped, null);
});

test("빈 값·미지정 속성은 프로필에서 빠진다", () => {
  const mapped = mapPageToInstructor({
    id: "abc",
    properties: { 강사명: { type: "title", title: [{ plain_text: "김철수" }] } }
  });
  assert.ok(mapped);
  const notion = mapped.note.notion;
  assert.ok(notion);
  assert.equal(notion.affiliation, undefined);
  assert.equal(notion.categories, undefined);
  assert.equal(notion.baseFee, undefined);
  assert.equal(mapped.note.recruitAvoid, false);
});
