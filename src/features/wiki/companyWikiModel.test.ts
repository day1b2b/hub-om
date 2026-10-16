import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateCompanies } from "@/features/wiki/companyWikiModel.ts";
import type { OperationSession } from "@/lib/data/operationTypes.ts";

function operation(overrides: Partial<OperationSession> = {}): OperationSession {
  return {
    operationId: "op-1",
    companyName: "샘플전자",
    courseId: "C-1",
    courseName: "AI 활용 과정",
    om: "가담당",
    ld: "나엘디",
    instructors: "다강사",
    roundNo: "1",
    startDate: "2026-09-14",
    endDate: "2026-09-14",
    operationStatus: "배정예정",
    avgSatisfaction: "",
    operationDetail: "",
    lectureManagementLink: "",
    driveLink: "",
    resultReportLink: "",
    ...overrides
  } as OperationSession;
}

test("기업별로 묶고 기업명 가나다순으로 돌려준다", () => {
  const entries = aggregateCompanies([
    operation({ operationId: "a", companyName: "한빛산업" }),
    operation({ operationId: "b", companyName: "가온물산" }),
    operation({ operationId: "c", companyName: "한빛산업" })
  ]);
  assert.deepEqual(entries.map((e) => e.name), ["가온물산", "한빛산업"]);
  assert.equal(entries[1].roundCount, 2);
});

test("기업명이 빈 행은 위키에 세우지 않는다", () => {
  const entries = aggregateCompanies([operation({ companyName: "   " }), operation({ companyName: "가온물산" })]);
  assert.deepEqual(entries.map((e) => e.name), ["가온물산"]);
});

test("담당 OM·LD를 중복 없이 모은다", () => {
  const entries = aggregateCompanies([
    operation({ operationId: "a", om: "가담당, 나담당", ld: "다엘디" }),
    operation({ operationId: "b", om: "나담당", ld: "다엘디" })
  ]);
  assert.deepEqual(entries[0].omNames, ["가담당", "나담당"]);
  assert.deepEqual(entries[0].ldNames, ["다엘디"]);
});

test("같은 코스ID·과정명 회차를 한 코스로 묶고 회차를 센다", () => {
  const entries = aggregateCompanies([
    operation({ operationId: "a", roundNo: "1", startDate: "2026-09-01" }),
    operation({ operationId: "b", roundNo: "2", startDate: "2026-09-08" })
  ]);
  assert.equal(entries[0].courseCount, 1);
  assert.equal(entries[0].courses[0].rounds, 2);
  assert.equal(entries[0].courses[0].startDate, "2026-09-01");
  assert.equal(entries[0].courses[0].endDate, "2026-09-08");
});

test("코스ID가 같아도 과정명이 다르면 다른 코스로 센다", () => {
  const entries = aggregateCompanies([
    operation({ operationId: "a", courseId: "261578", courseName: "AX 교육(실무3)" }),
    operation({ operationId: "b", courseId: "261578", courseName: "AX 교육(실무4)" })
  ]);
  assert.equal(entries[0].courseCount, 2);
});

test("운영 현황 표의 코스 한 줄에 만족도(평균)·매출(코스ID기준)이 채워진다", () => {
  const entries = aggregateCompanies([
    operation({ operationId: "a", courseId: "261578", revenue: 1_000_000, avgSatisfaction: "4.5" }),
    operation({ operationId: "b", courseId: "261578", revenue: 1_000_000, avgSatisfaction: "4.7" })
  ]);
  assert.equal(entries[0].courses[0].avgSatisfaction, "4.6");
  assert.equal(entries[0].courses[0].revenue, "1,000,000");
});

test("만족도는 숫자로 읽히는 회차만 평균한다", () => {
  const entries = aggregateCompanies([
    operation({ operationId: "a", avgSatisfaction: "4.5" }),
    operation({ operationId: "b", avgSatisfaction: "4.7" }),
    operation({ operationId: "c", avgSatisfaction: "미입력" })
  ]);
  assert.equal(entries[0].avgSatisfaction, "4.6");
});

test("만족도가 하나도 없으면 -로 둔다", () => {
  const entries = aggregateCompanies([operation({ avgSatisfaction: "" })]);
  assert.equal(entries[0].avgSatisfaction, "-");
});

test("강사가 셋 이상이면 두 명까지 쓰고 나머지는 수로 접는다", () => {
  const entries = aggregateCompanies([
    operation({ operationId: "a", instructors: "가강사, 나강사" }),
    operation({ operationId: "b", instructors: "다강사, 라강사" })
  ]);
  assert.equal(entries[0].courses[0].instructors, "가강사, 나강사 외 2명");
});

test("일정이 없으면 -로 둔다", () => {
  const entries = aggregateCompanies([operation({ startDate: "", endDate: "" })]);
  assert.equal(entries[0].firstDate, "-");
  assert.equal(entries[0].lastDate, "-");
});

test("연도 목록을 오름차순으로 모은다", () => {
  const entries = aggregateCompanies([
    operation({ operationId: "a", startDate: "2026-09-01" }),
    operation({ operationId: "b", startDate: "2025-03-01" })
  ]);
  assert.deepEqual(entries[0].years, ["2025", "2026"]);
});

test("공백만 다른 표기는 같은 기업으로 묶고 많이 쓰인 표기를 대표로 쓴다", () => {
  // 실데이터: "삼성전자 DS" 1회차 ↔ "삼성전자DS" 75회차. 위키에 두 칸으로 갈려 있었다.
  const entries = aggregateCompanies([
    operation({ operationId: "a", companyName: "샘플전자 DS" }),
    operation({ operationId: "b", companyName: "샘플전자DS" }),
    operation({ operationId: "c", companyName: "샘플전자DS" })
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "샘플전자DS");
  assert.equal(entries[0].roundCount, 3);
});

test("공백 외의 차이는 합치지 않는다", () => {
  // "KB"와 "KB국민은행"이 같은 곳인지 알 수 없으므로 임의로 묶지 않는다.
  const entries = aggregateCompanies([
    operation({ operationId: "a", companyName: "가온" }),
    operation({ operationId: "b", companyName: "가온물산" })
  ]);
  assert.deepEqual(entries.map((e) => e.name), ["가온", "가온물산"]);
});

test("과정명이 비어 있어도 정렬에서 터지지 않는다", () => {
  // localeCompare는 null에서 예외를 던진다. 코스 정렬 비교라 반드시 막아야 한다.
  const broken = { operationId: "op-x", companyName: "가온물산", startDate: "2026-09-14" } as unknown as OperationSession;
  const entries = aggregateCompanies([broken, operation({ operationId: "ok", companyName: "가온물산" })]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].courseCount, 2);
});

test("companyId가 있으면 기업명 표기가 달라도 한 기업으로 묶는다", () => {
  // Company.id가 기업을 식별한다. 운영 현황에 표기를 다르게 적어도 갈리지 않는다.
  const entries = aggregateCompanies([
    operation({ operationId: "a", companyId: "cmp-1", companyName: "가온물산" }),
    operation({ operationId: "b", companyId: "cmp-1", companyName: "가온 물산(주)" })
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].roundCount, 2);
});

test("companyId가 다르면 기업명이 같아도 나눈다", () => {
  // 이름이 같은 별개 법인이 있을 수 있다. 식별자를 이름보다 믿는다.
  const entries = aggregateCompanies([
    operation({ operationId: "a", companyId: "cmp-1", companyName: "가온물산" }),
    operation({ operationId: "b", companyId: "cmp-2", companyName: "가온물산" })
  ]);
  assert.equal(entries.length, 2);
});

test("companyId가 없으면 기업명으로 묶는다(공백·대소문자 무시)", () => {
  // 로컬 JSON 저장소나 외부 원천 병합 항목에는 companyId가 없다.
  const entries = aggregateCompanies([
    operation({ operationId: "a", companyName: "샘플전자 DS" }),
    operation({ operationId: "b", companyName: "샘플전자DS" })
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].roundCount, 2);
});

test("companyId가 있는 행과 없는 행은 섞지 않는다", () => {
  // 한쪽만 식별자를 가진 상태에서 억지로 합치면 근거 없는 병합이 된다.
  const entries = aggregateCompanies([
    operation({ operationId: "a", companyId: "cmp-1", companyName: "가온물산" }),
    operation({ operationId: "b", companyName: "가온물산" })
  ]);
  assert.equal(entries.length, 2);
});
