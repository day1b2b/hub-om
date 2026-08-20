import assert from "node:assert/strict";
import { test } from "node:test";

import {
  groupEntriesByCategory,
  mergeNotionInstructors,
  parseInstructorNames,
  type InstructorWikiEntry
} from "@/features/wiki/instructorWikiModel.ts";

function entry(name: string, categories: string[] = [], courseCount = 0): InstructorWikiEntry {
  return { id: name, name, companies: [], courseCount, courses: [], coach: null, categories };
}

test("공백·구분자로 나열된 강사명을 분리한다", () => {
  assert.deepEqual(parseInstructorNames("신동형 정백 신도용"), ["신동형", "정백", "신도용"]);
  assert.deepEqual(parseInstructorNames("홍길동, 김철수/이영희"), ["홍길동", "김철수", "이영희"]);
});

test("이름 자리에 들어온 자리표시자는 걸러낸다", () => {
  // 배포 화면에 "강사"라는 이름의 강사 카드가 생긴 사례가 있었다.
  assert.deepEqual(parseInstructorNames("강사"), []);
  assert.deepEqual(parseInstructorNames("없음 (VOD) 미정 담당자"), []);
  assert.deepEqual(parseInstructorNames("홍길동 강사"), ["홍길동"]);
});

test("이름에 포함된 글자는 자리표시자로 오인하지 않는다", () => {
  // "강사"가 들어간 이름은 남아야 한다(완전일치만 제외).
  assert.deepEqual(parseInstructorNames("박강사현"), ["박강사현"]);
});

test("노션에만 있는 강사를 코스 없는 항목으로 합친다", () => {
  const merged = mergeNotionInstructors([entry("정백", [], 2)], ["정백", "이한나"]);
  assert.equal(merged.length, 2);
  // 이름이 겹치면 운영 현황 쪽 이력을 유지한다.
  assert.equal(merged.find((item) => item.name === "정백")?.courseCount, 2);
  assert.equal(merged.find((item) => item.name === "이한나")?.courseCount, 0);
});

test("카테고리별로 묶고 미지정은 맨 뒤에 둔다", () => {
  const groups = groupEntriesByCategory([
    entry("A", ["마케팅"]),
    entry("B", ["마케팅", "생성형AI"]),
    entry("C", [])
  ]);
  assert.deepEqual(groups.map((group) => group.label), ["마케팅", "생성형AI", "카테고리 미지정"]);
  // 복수 카테고리 강사는 각 그룹에 모두 들어간다.
  assert.equal(groups[0].entries.length, 2);
  assert.equal(groups[1].entries.length, 1);
  assert.equal(groups[2].entries.length, 1);
});
