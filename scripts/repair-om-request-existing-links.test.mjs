import assert from "node:assert/strict";
import test from "node:test";
import { planExistingLinks } from "./repair-om-request-existing-links.mjs";

const operation = (id, course, start, end = start) => ({ _id: id, operationId: `op-${id}`, courseRecordId: course,
  startDate: new Date(`${start}T00:00:00.000Z`), endDate: new Date(`${end}T00:00:00.000Z`), deletedAt: null });
const request = { totalSessions: 2, operationId: "op-a" };
const sessions = [{ date: "2099-01-01" }, { date: "2099-01-02" }];

test("같은 과정의 정확한 날짜 1:1 회차만 기존 연결 복구 대상으로 고른다", () => {
  const rows = [operation("a", "course-1", "2099-01-01"), operation("b", "course-1", "2099-01-02"),
    operation("other", "course-2", "2099-01-02")];
  assert.deepEqual(planExistingLinks(request, rows, sessions).map(row => row._id), ["a", "b"]);
});

test("누락·중복 날짜, 다른 과정, 대표 회차 제외와 요청 개수 불일치는 차단한다", () => {
  const exact = [operation("a", "course-1", "2099-01-01"), operation("b", "course-1", "2099-01-02")];
  const cases = [
    [request, exact.slice(0, 1), sessions],
    [request, [...exact, operation("c", "course-1", "2099-01-02")], sessions],
    [{ ...request, operationId: "op-other" }, exact, sessions],
    [{ ...request, totalSessions: 3 }, exact, sessions]
  ];
  for (const args of cases) assert.throws(() => planExistingLinks(...args));
});

test("여러 날 회차는 시작일과 종료일이 모두 정확히 일치해야 한다", () => {
  const rangeRequest = { totalSessions: 1, operationId: "op-a" };
  const rows = [operation("a", "course-1", "2099-02-01", "2099-02-03")];
  assert.equal(planExistingLinks(rangeRequest, rows, [{ date: "2099-02-01", dateEnd: "2099-02-03" }])[0]._id, "a");
  assert.throws(() => planExistingLinks(rangeRequest, rows, [{ date: "2099-02-01", dateEnd: "2099-02-02" }]));
});
