import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_LOOKUP_ROUNDS, selectLookupRounds } from "@/lib/data/courseLookupRounds";
import type { OperationSession } from "@/lib/data/operationTypes";

function op(courseId: string, roundNo: string, startDate: string, extra: Partial<OperationSession> = {}): OperationSession {
  return {
    courseId,
    roundNo,
    startDate,
    endDate: startDate,
    educationDates: [startDate],
    timeText: "09:00-18:00",
    educationFormat: "오프라인",
    instructors: "강양석",
    companyName: "한화큐셀",
    courseName: "임원 대상 교육",
    processId: "PRC-000001",
    revenue: 12_000_000,
    om: "이유진",
    driveLink: "https://drive.example/secret",
    ...extra
  } as OperationSession;
}

test("코스ID가 같은 회차만, 정규화해서 비교한다", () => {
  const rounds = selectLookupRounds(
    [op("268411", "1", "2026-09-21"), op("\u200b268411.0", "2", "2026-10-05"), op("999999", "1", "2026-09-01")],
    "268411"
  );

  assert.deepEqual(rounds.map((round) => round.roundNo), ["1", "2"]);
});

test("보고서에 필요한 일정·형태·강사만 담고 매출·담당자·링크는 뺀다", () => {
  const [round] = selectLookupRounds([op("268411", "1", "2026-09-21")], "268411");

  assert.deepEqual(round, {
    processId: "PRC-000001",
    company: "한화큐셀",
    courseName: "임원 대상 교육",
    roundNo: "1",
    startDate: "2026-09-21",
    endDate: "2026-09-21",
    educationDates: ["2026-09-21"],
    timeText: "09:00-18:00",
    educationFormat: "오프라인",
    instructors: "강양석"
  });
  assert.equal("revenue" in round, false);
  assert.equal("om" in round, false);
  assert.equal("driveLink" in round, false);
});

test("시작일 순, 같으면 회차 번호를 숫자로 비교한다", () => {
  const rounds = selectLookupRounds(
    [op("1", "10", "2026-09-01"), op("1", "2", "2026-09-01"), op("1", "1", "2026-08-01")],
    "1"
  );

  assert.deepEqual(rounds.map((round) => round.roundNo), ["1", "2", "10"]);
});

test("빈 코스ID면 아무것도 돌려주지 않는다", () => {
  assert.deepEqual(selectLookupRounds([op("", "1", "2026-09-01")], ""), []);
});

test("회차가 너무 많으면 최근 회차만 남긴다", () => {
  const many = Array.from({ length: MAX_LOOKUP_ROUNDS + 5 }, (_, i) =>
    op("1", String(i + 1), `2026-01-${String((i % 28) + 1).padStart(2, "0")}T${String(i).padStart(3, "0")}`)
  );
  const rounds = selectLookupRounds(many, "1");

  assert.equal(rounds.length, MAX_LOOKUP_ROUNDS);
});
