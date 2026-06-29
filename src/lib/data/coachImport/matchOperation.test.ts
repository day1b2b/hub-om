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

test("기간이 충분히 겹치면 같은 운영으로 매칭한다", () => {
  const result = matchOperation(
    { courseName: "데이터 분석 부트캠프", startDate: "2026-03-02", endDate: "2026-03-31" },
    [baseCandidate]
  );

  assert.equal(result, "op-1");
});

test("기간이 겹치지 않으면 null을 반환한다", () => {
  const result = matchOperation(
    { courseName: "데이터 분석 부트캠프", startDate: "2026-04-01", endDate: "2026-04-30" },
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

test("회사명이 함께 적힌 engagement도 course 후보와 매칭한다", () => {
  const candidates: OperationCandidate[] = [
    {
      id: "op-1",
      companyName: "삼성전자",
      courseName: "AI/Bigdata 인텐시브 과정",
      startDate: "2026-06-29",
      endDate: "2026-07-10"
    }
  ];

  const result = matchOperation(
    {
      courseName: "삼성전자 AI Bigdata 인텐시브 과정",
      startDate: "2026-06-29",
      endDate: "2026-07-10"
    },
    candidates
  );

  assert.equal(result, "op-1");
});

test("시간 정보가 있으면 상위 후보를 가르는 보조 기준으로 사용한다", () => {
  const candidates: OperationCandidate[] = [
    {
      id: "op-1",
      courseName: "AI/Bigdata 인텐시브 과정",
      startDate: "2026-06-29",
      endDate: "2026-07-10",
      timeText: "09:00-13:00"
    },
    {
      id: "op-2",
      courseName: "AI/Bigdata 인텐시브 과정",
      startDate: "2026-06-29",
      endDate: "2026-07-10",
      timeText: "14:00-18:00"
    }
  ];

  const result = matchOperation(
    {
      courseName: "AI/Bigdata 인텐시브 과정",
      startDate: "2026-06-29",
      endDate: "2026-07-10",
      startTime: "14:00",
      endTime: "18:00"
    },
    candidates
  );

  assert.equal(result, "op-2");
});

test("engagement 대표 기간이 달라도 개별 투입일이 운영 기간 안에 있으면 매칭한다", () => {
  const candidates: OperationCandidate[] = [
    {
      id: "op-1",
      courseName: "AI 리더십 과정",
      startDate: "2026-07-01",
      endDate: "2026-07-31"
    }
  ];

  const result = matchOperation(
    {
      courseName: "AI 리더십 과정",
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      scheduleDates: ["2026-07-03", "2026-07-10"]
    },
    candidates
  );

  assert.equal(result, "op-1");
});

test("coach_text가 있으면 동률 후보를 가르는 보조 기준으로 사용한다", () => {
  const candidates: OperationCandidate[] = [
    {
      id: "op-1",
      courseName: "AI 리더십 과정",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      coachText: "김다른"
    },
    {
      id: "op-2",
      courseName: "AI 리더십 과정",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      coachText: "홍예진"
    }
  ];

  const result = matchOperation(
    {
      courseName: "AI 리더십 과정",
      coachName: "홍예진",
      startDate: "2026-07-01",
      endDate: "2026-07-31"
    },
    candidates
  );

  assert.equal(result, "op-2");
});
