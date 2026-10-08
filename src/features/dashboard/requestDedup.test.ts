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
    resultReportNeeded: "N",
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
  const isRepresented = createRequestMatcher([
    request({ courseId: "", operationId: "op-9", sessions: [session("2026-09-07")] })
  ]);
  assert.equal(isRepresented({ courseId: "", operationId: "op-9", startDate: "2026-09-07" }), true);
});

test("코스ID가 빈 요청 때문에 무관한 운영이 사라지지 않는다", () => {
  // 이 회귀가 실제로 났다. 빈 코스ID가 짝짓기 키에 들어가면
  // 코스ID 없는 운영이 전부 걸러져 캘린더·사전세팅이 통째로 비었다.
  const isRepresented = createRequestMatcher([
    request({ courseId: "", operationId: "op-9", sessions: [session("2026-09-07")] })
  ]);
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

test("교육 일정 차수가 없는 담당 과정은 아무것도 대표하지 못한다", () => {
  // 실제 증상: 담당 과정 표에는 1건이 뜨는데 캘린더·사전세팅·D-day는 비어 있었다.
  // 차수가 없으면 요청은 캘린더에 찍을 날짜가 없는데, 짝인 운영까지 지워 과정이 사라진다.
  const isRepresented = createRequestMatcher([
    request({ courseId: "", operationId: "op-9", sessions: [] })
  ]);
  assert.equal(isRepresented({ courseId: "", operationId: "op-9", startDate: "2026-09-07" }), false);
});

test("차수 날짜가 빈 문자열이어도 대표하지 못한다", () => {
  const isRepresented = createRequestMatcher([
    request({ courseId: "261578", operationId: "op-9", sessions: [session("")] })
  ]);
  assert.equal(isRepresented({ courseId: "261578", operationId: "op-9", startDate: "2026-11-16" }), false);
});

test("코스ID 없는 2차수 운영도 같은 기업·과정·날짜면 담당 과정이 대표한다", () => {
  // 실제 증상(2026-10-07 제보): 접수로 자동 생성된 운영은 차수마다 한 건씩 만들어지는데
  // 요청에 적히는 operationId는 1차수 하나뿐이고 코스ID도 비어 있다. 그래서 2차수부터
  // 짝을 못 찾아 운영 막대와 요청 막대가 같은 날 나란히 그려졌다.
  const isRepresented = createRequestMatcher([
    request({
      courseId: "",
      operationId: "op-round1",
      sessions: [session("2026-11-09"), session("2026-11-16")]
    })
  ]);
  assert.equal(isRepresented({ companyName: "샘플전자", courseId: "", courseName: "AI 활용 과정", operationId: "op-round1", startDate: "2026-11-09" }), true);
  assert.equal(isRepresented({ companyName: "샘플전자", courseId: "", courseName: "AI 활용 과정", operationId: "op-round2", startDate: "2026-11-16" }), true);
});

test("기업·과정이 같아도 요청에 없는 날짜의 회차는 남긴다", () => {
  const isRepresented = createRequestMatcher([
    request({ courseId: "", operationId: "op-round1", sessions: [session("2026-11-09")] })
  ]);
  assert.equal(isRepresented({ companyName: "샘플전자", courseId: "", courseName: "AI 활용 과정", operationId: "op-round2", startDate: "2026-12-01" }), false);
});

test("기업명이나 과정명이 다르면 이름으로 짝짓지 않는다", () => {
  const isRepresented = createRequestMatcher([
    request({ courseId: "", operationId: "op-round1", sessions: [session("2026-11-09")] })
  ]);
  assert.equal(isRepresented({ companyName: "다른전자", courseId: "", courseName: "AI 활용 과정", operationId: "op-x", startDate: "2026-11-09" }), false);
  assert.equal(isRepresented({ companyName: "샘플전자", courseId: "", courseName: "다른 과정", operationId: "op-x", startDate: "2026-11-09" }), false);
});

test("기업명·과정명이 비어 있으면 이름으로 짝짓지 않는다", () => {
  // 빈 문자열끼리 맞아떨어져 무관한 운영이 사라지는 것을 막는다.
  const isRepresented = createRequestMatcher([
    request({ company: "", courseName: "", courseId: "", operationId: "op-round1", sessions: [session("2026-11-09")] })
  ]);
  assert.equal(isRepresented({ companyName: "", courseId: "", courseName: "", operationId: "op-x", startDate: "2026-11-09" }), false);
});

test("코스ID가 있는 운영은 이름 폴백을 쓰지 않는다", () => {
  // 코스ID가 있으면 회차 구분이 정확하므로 그 규칙만 쓴다. 이름까지 보면
  // 코스ID를 공유하는 다른 회차가 다시 묶여 사라질 수 있다.
  const isRepresented = createRequestMatcher([
    request({ courseId: "261578", operationId: "op-round1", sessions: [session("2026-11-16")] })
  ]);
  assert.equal(isRepresented({ companyName: "샘플전자", courseId: "261578", courseName: "AI 활용 과정", operationId: "op-x", startDate: "2026-11-02" }), false);
});

test("기업명 공백 표기가 달라도 같은 기업으로 본다", () => {
  const isRepresented = createRequestMatcher([
    request({ company: "샘플 전자", courseId: "", operationId: "op-round1", sessions: [session("2026-11-09")] })
  ]);
  assert.equal(isRepresented({ companyName: "샘플  전자 ", courseId: "", courseName: "AI 활용 과정", operationId: "op-x", startDate: "2026-11-09" }), true);
});
