import assert from "node:assert/strict";
import { test } from "node:test";

import { matchOperation, type OperationCandidate } from "./matchOperation.ts";

const baseCandidate: OperationCandidate = {
  id: "op-1",
  courseName: "데이터 분석 부트캠프",
  startDate: "2026-03-01",
  endDate: "2026-03-31"
};

test("정확히 한 후보가 일치하면 그 id를 반환한다", () => {
  const candidates: OperationCandidate[] = [
    baseCandidate,
    { id: "op-2", courseName: "다른 과정", startDate: "2026-03-01", endDate: "2026-03-31" }
  ];

  const result = matchOperation(
    { courseName: "데이터 분석 부트캠프", startDate: "2026-03-01", endDate: "2026-03-31" },
    candidates
  );

  assert.equal(result, "op-1");
});

test("두 후보 이상이 일치하면 null을 반환한다", () => {
  const candidates: OperationCandidate[] = [
    baseCandidate,
    { id: "op-2", courseName: "데이터 분석 부트캠프", startDate: "2026-03-01", endDate: "2026-03-31" }
  ];

  const result = matchOperation(
    { courseName: "데이터 분석 부트캠프", startDate: "2026-03-01", endDate: "2026-03-31" },
    candidates
  );

  assert.equal(result, null);
});

test("일치하는 후보가 없으면 null을 반환한다", () => {
  const result = matchOperation(
    { courseName: "존재하지 않는 과정", startDate: "2026-03-01", endDate: "2026-03-31" },
    [baseCandidate]
  );

  assert.equal(result, null);
});

test("앞뒤 공백과 내부 연속 공백, 대소문자를 정규화해 일치시킨다", () => {
  const candidates: OperationCandidate[] = [
    { id: "op-1", courseName: "AWS   Cloud  Practitioner", startDate: "2026-03-01", endDate: "2026-03-31" }
  ];

  const result = matchOperation(
    { courseName: "  aws cloud practitioner  ", startDate: "2026-03-01", endDate: "2026-03-31" },
    candidates
  );

  assert.equal(result, "op-1");
});

test("startDate가 다르면 일치하지 않아 null을 반환한다", () => {
  const result = matchOperation(
    { courseName: "데이터 분석 부트캠프", startDate: "2026-03-02", endDate: "2026-03-31" },
    [baseCandidate]
  );

  assert.equal(result, null);
});

test("endDate가 다르면 일치하지 않아 null을 반환한다", () => {
  const result = matchOperation(
    { courseName: "데이터 분석 부트캠프", startDate: "2026-03-01", endDate: "2026-03-30" },
    [baseCandidate]
  );

  assert.equal(result, null);
});

test("후보가 비어 있으면 null을 반환한다", () => {
  const result = matchOperation(
    { courseName: "데이터 분석 부트캠프", startDate: "2026-03-01", endDate: "2026-03-31" },
    []
  );

  assert.equal(result, null);
});
