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

function session(date: string) {
  return { date, dateEnd: date, timeStart: "", timeEnd: "", duration: "", location: "" };
}

test("코스ID와 시작일이 같으면 담당 과정이 대표한다", () => {
  const isRepresented = createRequestMatcher([
    request({ courseId: "C-2608-210", sessions: [session("2026-11-16")] })
  ]);
  assert.equal(
    isRepresented({ courseId: "C-2608-210", operationId: "op-1", startDate: "2026-11-16" }),
    true
  );
});

test("코스ID가 같아도 다른 회차는 남긴다", () => {
  // HL만도 AX 교육 실무3(11/02)·실무4(11/16)가 코스ID 261578을 공유한다.
  // 실무4에만 담당 과정이 있을 때 실무3까지 걸러져 화면에서 사라졌던 회귀.
  const isRepresented = createRequestMatcher([
    request({ courseId: "261578", operationId: "op-4", sessions: [session("2026-11-16")] })
  ]);
  assert.equal(isRepresented({ courseId: "261578", operationId: "op-4", startDate: "2026-11-16" }), true);
  assert.equal(isRepresented({ courseId: "261578", operationId: "op-3", startDate: "2026-11-02" }), false);
});

test("운영에 시작일이 없으면 코스ID만으로 걸러내지 않는다", () => {
  const isRepresented = createRequestMatcher([
    request({ courseId: "C-2608-210", sessions: [session("2026-11-16")] })
  ]);
  assert.equal(isRepresented({ courseId: "C-2608-210", operationId: "op-x", startDate: "" }), false);
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
  assert.equal(isRepresented({ courseId: "C-2608-210", operationId: "op-1", startDate: "2026-11-16" }), false);
});

test("코스ID가 나중에 채워져 운영이 따로 생겨도 같은 날짜면 잡는다", () => {
  const isRepresented = createRequestMatcher([
    request({ courseId: "C-2608-210", operationId: "op-9", sessions: [session("2026-11-16")] })
  ]);
  assert.equal(
    isRepresented({ courseId: "C-2608-210", operationId: "op-later", startDate: "2026-11-16" }),
    true
  );
});
