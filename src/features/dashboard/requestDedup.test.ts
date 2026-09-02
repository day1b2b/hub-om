import assert from "node:assert/strict";
import { test } from "node:test";

import { createRequestMatcher } from "@/features/dashboard/requestDedup.ts";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes.ts";

function request(overrides: Partial<OmRequest> = {}): OmRequest {
  return {
    id: "omr-101",
    createdAt: "2026-08-01T00:00:00.000Z",
    status: "배정완료",
    team: "1팀",
    ld: "홍길동",
    company: "샘플전자",
    trainingType: "오프라인",
    courseId: "C-2608-210",
    courseName: "AI 활용 과정",
    courseCategory: "생성형AI",
    instructorName: "김강사",
    syncupLink: "",
    driveLink: "",
    skillfloSetup: "N",
    skillmatchSetup: "N",
    onSiteOperation: "N",
    coachRequest: "N",
    totalSessions: 1,
    sessions: [],
    notes: "",
    ...overrides
  };
}

test("코스ID가 같으면 담당 과정이 대표한다", () => {
  const isRepresented = createRequestMatcher([request({ courseId: "C-2608-210" })]);
  assert.equal(isRepresented({ courseId: "C-2608-210", operationId: "op-1" }), true);
});

test("코스ID가 비어 있어도 operationId로 짝을 맞춘다", () => {
  const isRepresented = createRequestMatcher([request({ courseId: "", operationId: "op-9" })]);
  assert.equal(isRepresented({ courseId: "", operationId: "op-9" }), true);
});

test("코스ID가 빈 요청 때문에 무관한 운영이 사라지지 않는다", () => {
  // 이 회귀가 실제로 났다. 빈 코스ID가 짝짓기 키에 들어가면
  // 코스ID 없는 운영이 전부 걸러져 캘린더·사전세팅이 통째로 비었다.
  const isRepresented = createRequestMatcher([request({ courseId: "", operationId: "op-9" })]);
  assert.equal(isRepresented({ courseId: "", operationId: "op-other" }), false);
  assert.equal(isRepresented({ courseId: undefined, operationId: "op-other" }), false);
});

test("담당 과정이 없으면 아무것도 걸러내지 않는다", () => {
  const isRepresented = createRequestMatcher([]);
  assert.equal(isRepresented({ courseId: "", operationId: "op-1" }), false);
  assert.equal(isRepresented({ courseId: "C-2608-210", operationId: "op-1" }), false);
});

test("코스ID가 나중에 채워져 운영이 따로 생겨도 잡는다", () => {
  const isRepresented = createRequestMatcher([request({ courseId: "C-2608-210", operationId: "op-9" })]);
  assert.equal(isRepresented({ courseId: "C-2608-210", operationId: "op-later" }), true);
});
