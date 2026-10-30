import assert from "node:assert/strict";
import { test } from "node:test";

import { recommendInstructors } from "@/features/wiki/instructorRecommendation.ts";
import type { InstructorNote } from "@/lib/data/instructorNoteRepository.ts";
import type { OperationSession } from "@/lib/data/operationTypes.ts";

function op(overrides: Partial<OperationSession>): OperationSession {
  return {
    operationId: "op",
    companyName: "가나전자",
    courseName: "과정",
    courseCategory: "",
    roundNo: "1",
    startDate: "2026-06-01",
    endDate: "2026-06-01",
    instructors: "",
    coach: "",
    om: "",
    operationStatus: "완료",
    educationFormat: "오프라인",
    region: "",
    instructorSatisfaction: "",
    instructorWikiLink: "",
    ...overrides
  } as OperationSession;
}

const note = (instructorName: string, categories: string[], extra: Partial<InstructorNote> = {}): InstructorNote => ({
  instructorName,
  notion: { categories },
  ...extra
});

const target = op({ operationId: "target", courseName: "에이전트 실습", courseCategory: "AI 에이전트·업무자동화", startDate: "2026-11-04", endDate: "2026-11-05" });

test("recommendInstructors: 같은 소분류 이력 > 같은 대분류 > 노션 분야 순으로 세우고 근거를 단다", () => {
  const operations = [
    target,
    op({ operationId: "a1", courseCategory: "AI 에이전트·업무자동화", instructors: "한예시", instructorSatisfaction: "4.8" }),
    op({ operationId: "a2", courseCategory: "AI 에이전트·업무자동화", instructors: "한예시", startDate: "2026-09-01", endDate: "2026-09-01" }),
    op({ operationId: "b1", courseCategory: "생성형 AI 업무 활용", instructors: "도예시", instructorSatisfaction: "4.9" }),
    op({ operationId: "c1", courseCategory: "데이터 분석·시각화", instructors: "문예시" })
  ];
  const result = recommendInstructors({
    courseOperations: [target],
    operations,
    notes: [note("문예시", ["생성형AI"]), note("서예시", ["생성형AI"], { notionNo: 7 }), note("류예시", ["마케팅"])],
    today: "2026-10-29",
    dormantMonths: 6
  });

  assert.equal(result.needsCategory, false);
  assert.equal(result.major, "AI·AX");
  assert.deepEqual(result.candidates.map((c) => c.name), ["한예시", "도예시", "문예시", "서예시"]);
  assert.equal(result.candidates[0].reasons[0], "같은 소분류 과정 2회");
  assert.equal(result.candidates[1].reasons[0], "같은 대분류(AI·AX) 과정 1회");
  // 이력은 없지만 노션 분야가 맞는 강사는 뒤에, 강사 위키 링크는 노션 NO로.
  assert.equal(result.candidates[3].href, "/instructor-wiki/7");
  assert.equal(result.candidates[3].reasons.includes("투입 이력 없음"), true);
});

test("recommendInstructors: 이미 배정된 강사·섭외지양은 빼고, 일정 겹치는 강사는 따로 모은다", () => {
  const assignedTarget = { ...target, instructors: "배정됨" };
  const operations = [
    assignedTarget,
    op({ operationId: "x1", courseCategory: "AI 에이전트·업무자동화", instructors: "배정됨" }),
    op({ operationId: "x2", courseCategory: "AI 에이전트·업무자동화", instructors: "지양강사" }),
    op({ operationId: "x3", courseCategory: "AI 에이전트·업무자동화", instructors: "바쁜강사" }),
    op({ operationId: "x4", companyName: "다라금융", courseName: "다른 과정", courseCategory: "OA·문서 생산성", instructors: "바쁜강사", startDate: "2026-11-05", endDate: "2026-11-05" })
  ];
  const result = recommendInstructors({
    courseOperations: [assignedTarget],
    operations,
    notes: [note("지양강사", ["생성형AI"], { notion: { categories: ["생성형AI"], recruitAvoid: true } })],
    today: "2026-10-29",
    dormantMonths: 6
  });

  assert.deepEqual(result.candidates.map((c) => c.name), []);
  assert.equal(result.excludedAvoidCount, 1);
  assert.deepEqual(result.conflicts.map((c) => [c.name, c.date]), [["바쁜강사", "2026-11-05"]]);
});

test("recommendInstructors: 과정 카테고리가 없으면 추천하지 않는다", () => {
  const blank = op({ operationId: "t", courseCategory: "" });
  const result = recommendInstructors({ courseOperations: [blank], operations: [blank], notes: [], today: "2026-10-29", dormantMonths: 6 });
  assert.equal(result.needsCategory, true);
  assert.equal(result.candidates.length, 0);
});
