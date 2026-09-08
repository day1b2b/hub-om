import assert from "node:assert/strict";
import { test } from "node:test";

import type { OperationSession } from "@/lib/data/operationTypes";
import { buildCalendarReflectSkipMessage } from "@/lib/googleCalendar/notifyCalendarReflectSkip.ts";

function operationFixture(overrides: Partial<OperationSession> = {}): OperationSession {
  return {
    operationId: "OP-1",
    companyName: "유한킴벌리",
    courseName: "AI&업무자동화교육 심화(전사)",
    roundNo: "6",
    om: "",
    ld: "강연정",
    ...overrides
  } as OperationSession;
}

test("알림 문구에 과정·사유·담당·상세가 담긴다", () => {
  const msg = buildCalendarReflectSkipMessage(operationFixture(), "파트를 못 정함");

  assert.match(msg, /캘린더 자동 반영 안 됨/);
  assert.match(msg, /\[유한킴벌리\] AI&업무자동화교육 심화\(전사\)_6회차/);
  assert.match(msg, /사유: 파트를 못 정함/);
  assert.match(msg, /담당 LD: 강연정/);
});

test("담당 OM이 비면 '미배정'으로 표기한다", () => {
  const msg = buildCalendarReflectSkipMessage(operationFixture({ om: "" }), "x");
  assert.match(msg, /담당 OM: 미배정/);
});

test("HUB_OM_BASE_URL이 있으면 운영 상세를 링크로 넣는다", () => {
  const prev = process.env.HUB_OM_BASE_URL;
  process.env.HUB_OM_BASE_URL = "https://hub-om.example/";
  try {
    const msg = buildCalendarReflectSkipMessage(operationFixture(), "x");
    assert.match(msg, /운영 상세: https:\/\/hub-om\.example\/operations\/OP-1/);
  } finally {
    if (prev === undefined) delete process.env.HUB_OM_BASE_URL;
    else process.env.HUB_OM_BASE_URL = prev;
  }
});

test("roundNo에 이미 '회차'가 붙어 있으면 그대로 둔다", () => {
  const msg = buildCalendarReflectSkipMessage(operationFixture({ roundNo: "3회차" }), "x");
  assert.match(msg, /_3회차/);
  assert.doesNotMatch(msg, /3회차회차/);
});
