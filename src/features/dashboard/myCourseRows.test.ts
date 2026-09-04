import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMyCourseRows } from "@/features/dashboard/myCourseRows.ts";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes.ts";
import type { OperationSession } from "@/lib/data/operationTypes.ts";

function operation(overrides: Partial<OperationSession> = {}): OperationSession {
  return {
    operationId: "op-1", companyName: "샘플전자", courseName: "AI 활용 과정", courseId: "C-1",
    ld: "홍길동", instructors: "김강사", startDate: "2026-09-14", endDate: "2026-09-14",
    ...overrides
  } as OperationSession;
}

function request(overrides: Partial<OmRequest> = {}): OmRequest {
  return {
    id: "omr-1", company: "샘플식품", courseName: "데이터 입문", totalSessions: 2,
    ld: "이엘디", instructorName: "박강사", courseId: "C-9", operationId: "op-9",
    sessions: [{ date: "2026-09-20", dateEnd: "2026-09-20" }],
    ...overrides
  } as unknown as OmRequest;
}

const scheduleRange = (r: OmRequest) => {
  const dates = r.sessions.map((s) => s.date).filter(Boolean).sort();
  return dates.length === 0 ? { start: "-", end: "-" } : { start: dates[0], end: dates[dates.length - 1] };
};
const href = (r: OmRequest) => `/om-request/manage/${r.id}`;
const noneRepresented = () => false;

test("운영현황에서 OM 배정만 된 과정도 표에 뜬다", () => {
  // 실제 증상: 운영 현황엔 20건인데 나의 담당 과정은 "배정된 담당 과정이 없습니다".
  // 업무요청이 없으면 표가 통째로 비었다.
  const rows = buildMyCourseRows([], [operation()], noneRepresented, scheduleRange, href);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].courseName, "AI 활용 과정");
  assert.equal(rows[0].href, "/operations/op-1");
  assert.equal(rows[0].source, "operation");
});

test("요청과 운영을 합쳐 시작일 순으로 정렬한다", () => {
  const rows = buildMyCourseRows(
    [request()], // 09-20
    [operation()], // 09-14
    noneRepresented,
    scheduleRange,
    href
  );
  assert.deepEqual(rows.map((r) => r.start), ["2026-09-14", "2026-09-20"]);
});

test("요청과 짝이 되는 운영은 표에 두 번 뜨지 않는다", () => {
  const rows = buildMyCourseRows(
    [request()],
    [operation()],
    (op) => op.operationId === "op-1",
    scheduleRange,
    href
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "request");
});

test("시작일 없는 줄은 뒤로 보낸다", () => {
  const rows = buildMyCourseRows(
    [request({ sessions: [] })], // 일정 "-"
    [operation()],
    noneRepresented,
    scheduleRange,
    href
  );
  assert.deepEqual(rows.map((r) => r.start), ["2026-09-14", "-"]);
});

test("LD·강사가 비면 미정/-로 채운다", () => {
  const rows = buildMyCourseRows(
    [],
    [operation({ ld: "", instructors: "" })],
    noneRepresented,
    scheduleRange,
    href
  );
  assert.equal(rows[0].ld, "미정");
  assert.equal(rows[0].instructor, "-");
});

test("같은 과정의 여러 회차는 총 회차로 센다", () => {
  const rows = buildMyCourseRows(
    [],
    [
      operation({ operationId: "op-1", startDate: "2026-09-14", endDate: "2026-09-14" }),
      operation({ operationId: "op-2", startDate: "2026-09-21", endDate: "2026-09-21" })
    ],
    noneRepresented,
    scheduleRange,
    href
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.totalSessions), [2, 2]);
});

test("코스ID가 비어도 기업+과정명으로 회차를 묶는다", () => {
  const rows = buildMyCourseRows(
    [],
    [
      operation({ operationId: "op-1", courseId: "", startDate: "2026-09-14" }),
      operation({ operationId: "op-2", courseId: "", startDate: "2026-09-21" }),
      operation({ operationId: "op-3", courseId: "", courseName: "다른 과정", startDate: "2026-09-28" })
    ],
    noneRepresented,
    scheduleRange,
    href
  );
  assert.deepEqual(rows.map((r) => r.totalSessions), [2, 2, 1]);
});

test("기업명·과정명이 비어 있어도 터지지 않는다", () => {
  // 타입은 string이지만 원천에서 비어 들어온 행이 있을 수 있다.
  // courseKey가 이 값에 .trim()을 바로 걸어서, 한 행만 비어도 대시보드 전체가 죽었다.
  const broken = { operationId: "op-x", startDate: "2026-09-14" } as unknown as OperationSession;
  const rows = buildMyCourseRows([], [broken], noneRepresented, scheduleRange, href);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company, "");
  assert.equal(rows[0].courseName, "");
  assert.equal(rows[0].ld, "미정");
  assert.equal(rows[0].instructor, "-");
});

test("연간·상시형 운영은 alwaysOn으로 표시한다", () => {
  // 이 줄은 달 필터가 숨기지 않는다. 시작일이 3월이어도 9월에 챙길 일이 있다.
  for (const type of ["연간", "상시형"]) {
    const rows = buildMyCourseRows(
      [],
      [operation({ operationType: type as OperationSession["operationType"] })],
      noneRepresented,
      scheduleRange,
      href
    );
    assert.equal(rows[0].alwaysOn, true, type);
  }
});

test("그 밖의 운영유형은 alwaysOn이 아니다", () => {
  for (const type of ["특강", "단기", "중기", "장기", "검토필요"]) {
    const rows = buildMyCourseRows(
      [],
      [operation({ operationType: type as OperationSession["operationType"] })],
      noneRepresented,
      scheduleRange,
      href
    );
    assert.equal(rows[0].alwaysOn, false, type);
  }
});

test("담당 과정(업무요청)은 운영유형이 없어 alwaysOn이 아니다", () => {
  const rows = buildMyCourseRows([request()], [], noneRepresented, scheduleRange, href);
  assert.equal(rows[0].alwaysOn, false);
});
