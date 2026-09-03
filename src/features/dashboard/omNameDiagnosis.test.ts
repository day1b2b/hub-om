import assert from "node:assert/strict";
import { test } from "node:test";

import { collectOmNames, diagnoseOmNameMismatch } from "@/features/dashboard/omNameDiagnosis.ts";
import type { OperationSession } from "@/lib/data/operationTypes.ts";

function operation(om: string, onsiteOm = ""): OperationSession {
  return { operationId: `op-${om}${onsiteOm}`, om, onsiteOm } as OperationSession;
}

const OPS = [operation("김가온"), operation("나한빛", "다샘물"), operation("김가온A")];

test("OM·현장운영 칸의 이름을 중복 없이 모은다", () => {
  assert.deepEqual(collectOmNames(OPS), ["김가온", "김가온A", "나한빛", "다샘물"]);
});

test("담당이 잡히면 진단하지 않는다", () => {
  const result = diagnoseOmNameMismatch({
    omName: "김가온", matchedOperations: 3, matchedRequests: 0, operations: OPS, rosterNamesForEmail: ["김가온"]
  });
  assert.equal(result, null);
});

test("이름이 운영 현황 표기와 맞는데 0건이면 이름을 지목하지 않는다", () => {
  // 다른 원인일 수 있으므로 엉뚱하게 이름 문제로 몰지 않는다.
  const result = diagnoseOmNameMismatch({
    omName: "김가온", matchedOperations: 0, matchedRequests: 0, operations: OPS, rosterNamesForEmail: ["김가온"]
  });
  assert.equal(result, null);
});

test("이름이 운영 현황 어디에도 없으면 진단한다", () => {
  const result = diagnoseOmNameMismatch({
    omName: "라없음", matchedOperations: 0, matchedRequests: 0, operations: OPS, rosterNamesForEmail: ["라없음"]
  });
  assert.ok(result);
  assert.equal(result.omName, "라없음");
  assert.equal(result.totalOperations, 3);
  assert.deepEqual(result.omNamesInOperations, ["김가온", "김가온A", "나한빛", "다샘물"]);
});

test("이메일 중복은 이름이 맞아도 알린다", () => {
  // 실제 원인이었다. 지금 이긴 이름이 우연히 맞았을 뿐이고, 명단 순서가 바뀌면 또 깨진다.
  const result = diagnoseOmNameMismatch({
    omName: "김가온",
    matchedOperations: 0,
    matchedRequests: 0,
    operations: OPS,
    rosterNamesForEmail: ["김가온", "김가온(퇴사)"]
  });
  assert.ok(result);
  assert.deepEqual(result.rosterNamesForEmail, ["김가온", "김가온(퇴사)"]);
});

test("내 이름과 겹치는 표기를 앞에 보여 준다", () => {
  const result = diagnoseOmNameMismatch({
    omName: "김가온B", matchedOperations: 0, matchedRequests: 0, operations: OPS, rosterNamesForEmail: ["김가온B"]
  });
  assert.ok(result);
  // "김가온"은 "김가온B"에 포함되므로 먼저 온다.
  assert.equal(result.omNamesInOperations[0], "김가온");
});

test("명단 미등록(이름 없음)은 별도 화면이 맡으므로 진단하지 않는다", () => {
  for (const omName of [null, "", "   "]) {
    const result = diagnoseOmNameMismatch({
      omName, matchedOperations: 0, matchedRequests: 0, operations: OPS, rosterNamesForEmail: []
    });
    assert.equal(result, null);
  }
});

test("운영 현황 자체가 비면 이름 문제로 몰지 않는다", () => {
  const result = diagnoseOmNameMismatch({
    omName: "김가온", matchedOperations: 0, matchedRequests: 0, operations: [], rosterNamesForEmail: ["김가온"]
  });
  assert.equal(result, null);
});
