import assert from "node:assert/strict";
import { test } from "node:test";

import type { ArchiveCompletionInput } from "@/lib/data/operationCalculations.ts";
import { deriveArchiveStatus, isArchiveComplete, missingArchiveItems } from "@/lib/data/operationCalculations.ts";

// 아카이빙 완료 조건을 모두 채운 기준값. 각 테스트에서 한 가지만 비워 확인한다.
function completeInput(overrides: Partial<ArchiveCompletionInput> = {}): ArchiveCompletionInput {
  return {
    courseId: "265483",
    lectureManagementNote: "강의관리 시트 정리 완료",
    avgSatisfaction: "4.7",
    hasSatisfactionSurvey: "확인필요",
    hasResultReport: "무",
    resultReportLink: "",
    ...overrides
  };
}

test("네 조건을 모두 채우면 아카이빙 완료다", () => {
  assert.equal(isArchiveComplete(completeInput()), true);
});

test("코스ID나 강의관리가 비면 완료가 아니다", () => {
  assert.equal(isArchiveComplete(completeInput({ courseId: "  " })), false);
  assert.equal(isArchiveComplete(completeInput({ lectureManagementNote: "" })), false);
});

test("만족도 조사를 하는 회차는 만족도가 비면 완료가 아니다", () => {
  assert.equal(isArchiveComplete(completeInput({ avgSatisfaction: "" })), false);
});

test("조사하지 않는 회차(불필요)는 만족도가 비어도 완료가 된다", () => {
  // 채울 값이 없는 회차를 만족도 때문에 영원히 "아카이빙필요"로 두지 않기 위한 규칙이다.
  assert.equal(
    isArchiveComplete(completeInput({ avgSatisfaction: "", hasSatisfactionSurvey: "불필요" })),
    true
  );
});

test("조사하지 않는 회차라도 나머지 조건은 그대로 요구한다", () => {
  const input = completeInput({ avgSatisfaction: "", hasSatisfactionSurvey: "불필요" });

  assert.equal(isArchiveComplete({ ...input, courseId: "" }), false);
  assert.equal(isArchiveComplete({ ...input, lectureManagementNote: "" }), false);
  assert.equal(
    isArchiveComplete({ ...input, hasResultReport: "유", resultReportLink: "" }),
    false
  );
});

test("결과보고서는 '유'일 때만 링크를 요구한다", () => {
  assert.equal(isArchiveComplete(completeInput({ hasResultReport: "유", resultReportLink: "" })), false);
  assert.equal(
    isArchiveComplete(completeInput({ hasResultReport: "유", resultReportLink: "https://drive" })),
    true
  );
  assert.equal(isArchiveComplete(completeInput({ hasResultReport: "불필요" })), true);
});

test("종료일이 지나지 않았으면 조건과 무관하게 아카이빙전이다", () => {
  const future = "2999-01-01";
  assert.equal(deriveArchiveStatus(future, completeInput()), "아카이빙전");
});

test("종료일이 지난 뒤에는 조건 충족 여부로 갈린다", () => {
  const past = "2020-01-01";
  assert.equal(deriveArchiveStatus(past, completeInput()), "완료");
  assert.equal(deriveArchiveStatus(past, completeInput({ avgSatisfaction: "" })), "아카이빙필요");
  assert.equal(
    deriveArchiveStatus(past, completeInput({ avgSatisfaction: "", hasSatisfactionSurvey: "불필요" })),
    "완료"
  );
});

test("아카이빙에서 빠진 항목을 이름으로 알려준다", () => {
  const complete = {
    courseId: "C-2608-001",
    lectureManagementNote: "시트 링크",
    avgSatisfaction: "4.5",
    hasSatisfactionSurvey: "확인필요" as const,
    hasResultReport: "유" as const,
    resultReportLink: "https://example.com/report"
  };
  assert.deepEqual(missingArchiveItems(complete), []);

  assert.deepEqual(missingArchiveItems({ ...complete, courseId: "  " }), ["코스ID"]);
  assert.deepEqual(missingArchiveItems({ ...complete, lectureManagementNote: "" }), ["강의관리"]);
  assert.deepEqual(missingArchiveItems({ ...complete, avgSatisfaction: "" }), ["만족도"]);
  assert.deepEqual(missingArchiveItems({ ...complete, resultReportLink: "" }), ["결과보고서 링크"]);
});

test("조사하지 않는 회차는 만족도를 요구하지 않는다", () => {
  // 요구하면 나머지를 다 채워도 영원히 아카이빙필요에 남는다(isArchiveComplete와 같은 규칙).
  const base = {
    courseId: "C-1",
    lectureManagementNote: "시트",
    avgSatisfaction: "",
    hasSatisfactionSurvey: "불필요" as const,
    hasResultReport: "무" as const,
    resultReportLink: ""
  };
  assert.deepEqual(missingArchiveItems(base), []);
});

test("결과보고서가 유가 아니면 링크를 요구하지 않는다", () => {
  const base = {
    courseId: "C-1",
    lectureManagementNote: "시트",
    avgSatisfaction: "4.0",
    hasSatisfactionSurvey: "확인필요" as const,
    hasResultReport: "불필요" as const,
    resultReportLink: ""
  };
  assert.deepEqual(missingArchiveItems(base), []);
});

test("여러 개가 빠지면 모두 알려준다", () => {
  const empty = {
    courseId: "",
    lectureManagementNote: "",
    avgSatisfaction: "",
    hasSatisfactionSurvey: "확인필요" as const,
    hasResultReport: "유" as const,
    resultReportLink: ""
  };
  assert.deepEqual(missingArchiveItems(empty), ["코스ID", "강의관리", "만족도", "결과보고서 링크"]);
});
