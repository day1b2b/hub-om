import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyNotionLinks,
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

function withCourse(name: string, company: string, startDate: string): InstructorWikiEntry {
  return {
    id: name,
    name,
    companies: [company],
    courseCount: 1,
    courses: [
      {
        operationId: `${name}-1`,
        companyName: company,
        courseName: "과정",
        roundNo: "1",
        role: "강사",
        status: "진행중",
        startDate,
        endDate: startDate,
        om: "OM",
        educationFormat: "",
        region: "",
        instructorSatisfaction: "",
        instructorWikiLink: ""
      }
    ],
    coach: null,
    categories: []
  };
}

test("연결된 표기의 코스 이력을 노션 강사 항목으로 합친다", () => {
  const merged = applyNotionLinks(
    [withCourse("디노랩스_김진태", "A사", "2026-01-01"), withCourse("김진태", "B사", "2026-03-01")],
    { "디노랩스_김진태": "김진태" }
  );

  assert.deepEqual(merged.map((entry) => entry.name), ["김진태"]);
  assert.equal(merged[0].courseCount, 2);
  // 최근 순 정렬 유지 + 기업 목록 재계산
  assert.equal(merged[0].courses[0].startDate, "2026-03-01");
  assert.deepEqual([...merged[0].companies].sort(), ["A사", "B사"]);
});

test("연결 대상이 목록에 없으면 빈 항목을 만들어 이력을 옮긴다", () => {
  const merged = applyNotionLinks([withCourse("파이퀀트_유종훈", "C사", "2026-02-01")], {
    "파이퀀트_유종훈": "유종훈"
  });
  assert.deepEqual(merged.map((entry) => entry.name), ["유종훈"]);
  assert.equal(merged[0].courseCount, 1);
});

test("자기 자신을 가리키는 연결은 무시한다", () => {
  const entries = [withCourse("김진태", "A사", "2026-01-01")];
  const merged = applyNotionLinks(entries, { 김진태: "김진태" });
  assert.deepEqual(merged.map((entry) => entry.name), ["김진태"]);
  assert.equal(merged[0].courseCount, 1);
});

test("연결이 없으면 목록을 그대로 둔다", () => {
  const entries = [withCourse("김진태", "A사", "2026-01-01")];
  assert.equal(applyNotionLinks(entries, {}), entries);
});
