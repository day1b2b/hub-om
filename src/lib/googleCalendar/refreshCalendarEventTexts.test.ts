import assert from "node:assert/strict";
import { test } from "node:test";

import type { OperationSession } from "@/lib/data/operationTypes";
import { buildTextPatch } from "@/lib/googleCalendar/refreshCalendarEventTextsRules.ts";

function operationFixture(overrides: Partial<OperationSession> = {}): OperationSession {
  return {
    operationId: "OP-1",
    companyName: "롯데정밀화학",
    courseName: "AI 업무 효율화",
    roundNo: "2",
    startDate: "2026-09-04",
    endDate: "2026-09-08",
    timeText: "10:00 ~ 17:00",
    region: "서울",
    om: "오수연",
    educationDates: ["2026-09-04", "2026-09-07", "2026-09-08"],
    ...overrides
  } as OperationSession;
}

test("매핑된 구간의 제목·설명만 뽑는다 — 날짜·시간·참석자는 patch에 들어가지 않는다", () => {
  const patch = buildTextPatch(operationFixture(), { eventDate: "2026-09-07" }, null);

  assert.ok(patch);
  assert.deepEqual(Object.keys(patch), ["summary", "description"]);
  assert.equal(patch.summary, "[롯데정밀화학] AI 업무 효율화_2회차");
  assert.ok(patch.description.includes("hub-om 운영현황과 연동된 일정입니다."));
  assert.ok(patch.description.includes("교육일: 26.09.04, 07~08 (3일)"));
});

test("파트 제목 규칙을 따른다(1파트는 [강의관리] 표기)", () => {
  const patch = buildTextPatch(operationFixture(), { eventDate: "2026-09-04" }, "1파트");

  assert.equal(patch?.summary, "[강의관리] 롯데정밀화학_AI 업무 효율화_2회차");
});

test("운영현황에 없는 교육일 매핑은 null — 정방향 반영이 정리할 몫이다", () => {
  assert.equal(buildTextPatch(operationFixture(), { eventDate: "2026-09-05" }, null), null);
});
