import assert from "node:assert/strict";
import { test } from "node:test";

import { planRoundApply } from "@/lib/data/satisfactionRoundApply";
import type { RoundApplyTarget } from "@/lib/data/satisfactionRoundApply";
import type { SatisfactionMatchResult, SatisfactionSheetRow } from "@/lib/data/satisfactionSheet";

function row(overall = "4.55"): SatisfactionSheetRow {
  return {
    recordId: "r_1",
    courseId: "260455",
    client: "삼성전자DX",
    course: "AI Essential",
    degree: "",
    rawDate: "260708",
    date: "2026-07-08",
    audience: "",
    rawInstructor: "강수현",
    instructor: "강수현",
    respondents: 113,
    rawOverall: overall,
    overall,
    posPct: null
  };
}

function matched(operationId = "op-1"): SatisfactionMatchResult {
  return { row: row(), status: "matched", operationId, ranked: [] };
}

function target(avgSatisfaction: null | string): RoundApplyTarget {
  return { id: "op-1", operationId: "260455", companyName: "삼성전자DX", courseName: "AI Essential", avgSatisfaction };
}

const find = (op: RoundApplyTarget | undefined) => () => op;

test("빈 칸이면 채운다", () => {
  const d = planRoundApply("4.55", matched(), find(target("")));
  assert.equal(d.write, true);
  assert.equal(d.status, "filled");
  assert.equal(d.value, "4.55");
  assert.equal(d.previous, null);
});

test("기존 값이 있어도 덮어쓴다 — 시트가 원본이다", () => {
  const d = planRoundApply("4.55", matched(), find(target("4.20")));
  assert.equal(d.write, true);
  assert.equal(d.status, "overwritten");
  assert.equal(d.previous, "4.20");
  assert.match(d.message, /4\.20/);
  assert.match(d.message, /4\.55/);
});

test("값이 같으면 쓰지 않는다", () => {
  const d = planRoundApply("4.55", matched(), find(target("4.55")));
  assert.equal(d.write, false);
  assert.equal(d.status, "same");
});

test("만족도가 비면 쓰지 않는다", () => {
  const d = planRoundApply("", matched(), find(target("")));
  assert.equal(d.write, false);
  assert.equal(d.status, "empty");
});

test("모호하면 쓰지 않는다", () => {
  const m: SatisfactionMatchResult = { row: row(), status: "ambiguous", operationId: null, ranked: [] };
  const d = planRoundApply("4.55", m, find(target("")));
  assert.equal(d.write, false);
  assert.equal(d.status, "ambiguous");
  assert.match(d.message, /코스ID/);
});

test("미매칭이면 쓰지 않고 사유를 그대로 전한다", () => {
  const m: SatisfactionMatchResult = {
    row: row(),
    status: "unmatched",
    operationId: null,
    ranked: [],
    reason: "코스ID 260455와 같은 운영을 찾지 못했어요."
  };
  const d = planRoundApply("4.55", m, find(target("")));
  assert.equal(d.write, false);
  assert.equal(d.status, "unmatched");
  assert.equal(d.message, "코스ID 260455와 같은 운영을 찾지 못했어요.");
});

test("매칭됐는데 운영 정보를 못 찾으면 조용히 넘기지 않는다", () => {
  const d = planRoundApply("4.55", matched(), find(undefined));
  assert.equal(d.write, false);
  assert.equal(d.status, "missing");
});

test("어떤 경우에도 사용자에게 보여줄 문장이 있다", () => {
  const cases: SatisfactionMatchResult[] = [
    matched(),
    { row: row(), status: "ambiguous", operationId: null, ranked: [] },
    { row: row(), status: "unmatched", operationId: null, ranked: [] }
  ];
  for (const m of cases) {
    for (const prev of ["", "4.20", "4.55"]) {
      const d = planRoundApply("4.55", m, find(target(prev)));
      assert.ok(d.message.trim().length > 0, `문장이 비었다: ${m.status}/${prev}`);
    }
  }
  assert.ok(planRoundApply("", matched(), find(target(""))).message.trim().length > 0);
});
