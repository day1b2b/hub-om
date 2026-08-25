import assert from "node:assert/strict";
import { test } from "node:test";

import { requestHref } from "@/features/dashboard/requestHref.ts";
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

test("같은 courseId의 운영이 있으면 운영 현황으로 간다", () => {
  const map = new Map([["C-2608-210", "op-777"]]);
  assert.equal(requestHref(request(), map), "/operations/op-777");
});

test("courseId 매칭이 없으면 접수 때 생성된 운영으로 간다", () => {
  const href = requestHref(request({ operationId: "op-111" }), new Map());
  assert.equal(href, "/operations/op-111");
});

test("courseId 매칭이 operationId보다 우선한다", () => {
  // 운영이 다시 만들어졌으면 request.operationId가 낡을 수 있다.
  const map = new Map([["C-2608-210", "op-new"]]);
  assert.equal(requestHref(request({ operationId: "op-old" }), map), "/operations/op-new");
});

test("운영을 못 찾으면 담당관리 상세로 폴백한다", () => {
  assert.equal(requestHref(request(), new Map()), "/om-request/manage/omr-101");
});

test("courseId가 비어 있어도 폴백이 동작한다", () => {
  const href = requestHref(request({ courseId: "" }), new Map([["", "op-wrong"]]));
  // 빈 courseId로 잘못 매칭되면 엉뚱한 운영으로 간다. 빈 값은 매칭으로 보지 않는다.
  assert.equal(href, "/om-request/manage/omr-101");
});
