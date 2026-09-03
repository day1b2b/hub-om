import assert from "node:assert/strict";
import { test } from "node:test";

import type { OperationSession } from "@/lib/data/operationTypes";
import type { CalendarEventSnapshot } from "@/lib/googleCalendar/calendarWriteClient.ts";
import type { CalendarEventLink } from "@/lib/googleCalendar/calendarEventLinkRepository.ts";
import { buildCalendarEventBodies } from "@/lib/googleCalendar/operationCalendarEvent.ts";
import {
  evaluateEventAgainstOperation,
  eventScheduleToSession,
  replaceEducationRun,
  type ReverseSyncEvaluation,
  type ReverseSyncItem
} from "@/lib/googleCalendar/calendarReverseSyncRules.ts";

// 교육일 9/4 · 9/7 · 9/8 → 연속 구간은 [9/4], [9/7~9/8] 두 개다.
const EDUCATION_DATES = ["2026-09-04", "2026-09-07", "2026-09-08"];

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
    educationDates: EDUCATION_DATES,
    ...overrides
  } as OperationSession;
}

/** 기본 링크는 뒤 구간(9/7~9/8)을 본다. 매핑 키는 구간 시작일이다. */
function linkFixture(eventDate = "2026-09-07"): CalendarEventLink {
  return { operationId: "OP-1", calendarId: "cal-1", eventId: "EV-1", eventDate };
}

/** 9/7~9/8 구간 계획과 일치하는 이벤트. 각 테스트에서 어긋나게 만들 부분만 덮어쓴다. */
function eventFixture(overrides: Partial<CalendarEventSnapshot> = {}): CalendarEventSnapshot {
  return {
    id: "EV-1",
    status: "confirmed",
    summary: "[롯데정밀화학] AI 업무 효율화_2회차",
    location: "서울",
    start: { dateTime: "2026-09-07T10:00:00+09:00" },
    end: { dateTime: "2026-09-08T17:00:00+09:00" },
    updated: "2026-09-07T02:00:00.000Z",
    ...overrides
  };
}

const OPERATION_UPDATED_AT = new Date("2026-09-07T01:00:00.000Z");

function itemOf(evaluation: ReverseSyncEvaluation): ReverseSyncItem {
  assert.equal(evaluation.kind, "item");
  return (evaluation as { kind: "item"; item: ReverseSyncItem }).item;
}

// ── 구간 이벤트 판정 ──────────────────────────────────────────────
test("일치하면 할 일이 없다", () => {
  const evaluation = evaluateEventAgainstOperation(
    operationFixture(),
    linkFixture(),
    eventFixture(),
    OPERATION_UPDATED_AT
  );

  assert.equal(evaluation.kind, "none");
});

test("캘린더가 더 최신이고 구간이 옮겨졌으면 운영현황에 반영한다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-14T10:00:00+09:00" },
    end: { dateTime: "2026-09-15T17:00:00+09:00" }
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, OPERATION_UPDATED_AT));

  assert.equal(item.action, "운영현황 반영");
  assert.equal(item.perEducationDay, true);
  assert.equal(item.eventDate, "2026-09-07");
  assert.equal(item.eventEndDate, "2026-09-08");
  assert.equal(item.scheduleChange?.to.startDate, "2026-09-14");
  assert.equal(item.scheduleChange?.to.endDate, "2026-09-15");
});

test("시간만 바뀌어도 캘린더가 최신이면 반영 대상이다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-07T13:00:00+09:00" },
    end: { dateTime: "2026-09-08T18:00:00+09:00" }
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, OPERATION_UPDATED_AT));

  assert.equal(item.action, "운영현황 반영");
  assert.equal(item.scheduleChange?.to.timeText, "13:00 ~ 18:00");
});

test("운영현황이 더 최신이면 캘린더를 되돌린다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-14T10:00:00+09:00" },
    end: { dateTime: "2026-09-15T17:00:00+09:00" },
    updated: "2026-09-07T00:30:00.000Z"
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, OPERATION_UPDATED_AT));

  assert.equal(item.action, "캘린더 원복");
  assert.deepEqual(item.revertFields, ["날짜·시간"]);
});

test("회차 수정 시각을 모르면 운영현황을 덮어쓰지 않는다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-14T10:00:00+09:00" },
    end: { dateTime: "2026-09-15T17:00:00+09:00" }
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, null));

  assert.equal(item.action, "캘린더 원복");
});

test("제목·장소만 바뀌었으면 원복 대상이다", () => {
  const event = eventFixture({ summary: "사람이 바꾼 제목", location: "부산" });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, OPERATION_UPDATED_AT));

  assert.equal(item.action, "캘린더 원복");
  assert.deepEqual(item.revertFields, ["제목", "장소"]);
});

test("날짜와 제목이 함께 바뀌면 날짜는 반영하고 제목은 원복한다", () => {
  const event = eventFixture({
    summary: "사람이 바꾼 제목",
    start: { dateTime: "2026-09-14T10:00:00+09:00" },
    end: { dateTime: "2026-09-15T17:00:00+09:00" }
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, OPERATION_UPDATED_AT));

  assert.equal(item.action, "운영현황 반영");
  assert.deepEqual(item.revertFields, ["제목"]);
});

test("원본이 삭제되면 아무 것도 하지 않는다(캘린더 삭제는 반영하지 않음)", () => {
  const evaluation = evaluateEventAgainstOperation(
    operationFixture(),
    linkFixture(),
    eventFixture({ status: "cancelled" }),
    OPERATION_UPDATED_AT
  );

  assert.equal(evaluation.kind, "skip");
});

test("원본이 삭제된 회차는 매핑을 지우지 않는다(다음 정방향 반영이 되살리지 않도록)", () => {
  // 판정은 skip만 돌려주고 매핑에 손대는 지시를 내지 않는다.
  // item이 없으므로 적용 단계가 실행할 쓰기도 없다.
  const evaluation = evaluateEventAgainstOperation(
    operationFixture(),
    linkFixture(),
    eventFixture({ status: "cancelled", summary: "누가 제목까지 바꿔놓은 상태" }),
    OPERATION_UPDATED_AT
  );

  assert.equal(evaluation.kind, "skip");
  assert.match((evaluation as { kind: "skip"; reason: string }).reason, /무조치/);
});

test("운영현황에서 빠진 구간은 손대지 않고 건너뛴다", () => {
  const evaluation = evaluateEventAgainstOperation(
    operationFixture(),
    linkFixture("2026-09-05"),
    eventFixture(),
    OPERATION_UPDATED_AT
  );

  assert.equal(evaluation.kind, "skip");
  assert.match((evaluation as { kind: "skip"; reason: string }).reason, /2026-09-05/);
});

// ── 교육일이 없는 옛 회차(기간 이벤트) ────────────────────────────
test("교육일이 없으면 기간 이벤트로 보고 시작·종료를 반영한다", () => {
  const operation = operationFixture({ educationDates: [] });
  const event = eventFixture({
    start: { dateTime: "2026-09-05T10:00:00+09:00" },
    end: { dateTime: "2026-09-09T17:00:00+09:00" }
  });

  const item = itemOf(
    evaluateEventAgainstOperation(operation, linkFixture("2026-09-04"), event, OPERATION_UPDATED_AT)
  );

  assert.equal(item.action, "운영현황 반영");
  assert.equal(item.perEducationDay, false);
  assert.deepEqual(item.scheduleChange?.to, {
    startDate: "2026-09-05",
    endDate: "2026-09-09",
    timeText: "10:00 ~ 17:00"
  });
});

// ── 이벤트 계획 만들기 ────────────────────────────────────────────
test("연속 구간마다 이벤트를 하나씩 만든다", () => {
  const plans = buildCalendarEventBodies(
    operationFixture({ educationDates: ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-11"] }),
    []
  );

  assert.deepEqual(
    plans.map((plan) => [plan.eventDate, plan.eventEndDate]),
    [
      ["2026-09-07", "2026-09-09"],
      ["2026-09-11", "2026-09-11"]
    ]
  );
  assert.deepEqual(plans[0].body.start, { dateTime: "2026-09-07T10:00:00", timeZone: "Asia/Seoul" });
  assert.deepEqual(plans[0].body.end, { dateTime: "2026-09-09T17:00:00", timeZone: "Asia/Seoul" });
  assert.deepEqual(plans[1].body.start, { dateTime: "2026-09-11T10:00:00", timeZone: "Asia/Seoul" });
});

test("제목은 회차 제목 그대로이고 설명에 교육일 목록이 들어간다", () => {
  const plans = buildCalendarEventBodies(
    operationFixture({ educationDates: ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-11"] }),
    []
  );

  assert.equal(plans[0].body.summary, "[롯데정밀화학] AI 업무 효율화_2회차");
  assert.ok((plans[0].body.description ?? "").includes("교육일: 26.09.07~09, 11 (4일)"));
});

test("전체가 연속이면 이벤트 1건으로 묶인다", () => {
  const plans = buildCalendarEventBodies(
    operationFixture({ educationDates: ["2026-09-04", "2026-09-05", "2026-09-06"] }),
    []
  );

  assert.equal(plans.length, 1);
  assert.equal(plans[0].eventDate, "2026-09-04");
  assert.equal(plans[0].eventEndDate, "2026-09-06");
});

test("시간 표기를 못 읽으면 구간 전체를 종일 일정으로 만든다", () => {
  const plans = buildCalendarEventBodies(
    operationFixture({ timeText: "미정", educationDates: ["2026-09-07", "2026-09-08"] }),
    []
  );

  assert.deepEqual(plans[0].body.start, { date: "2026-09-07" });
  assert.deepEqual(plans[0].body.end, { date: "2026-09-09" });
});

test("교육일이 없으면 기간 이벤트 1건이고 키는 시작일이다", () => {
  const plans = buildCalendarEventBodies(operationFixture({ educationDates: [] }), []);

  assert.equal(plans.length, 1);
  assert.equal(plans[0].eventDate, "2026-09-04");
  assert.deepEqual(plans[0].body.start, { dateTime: "2026-09-04T10:00:00", timeZone: "Asia/Seoul" });
  assert.deepEqual(plans[0].body.end, { dateTime: "2026-09-08T17:00:00", timeZone: "Asia/Seoul" });
});

test("형식이 틀린 교육일과 중복은 걸러진다", () => {
  const plans = buildCalendarEventBodies(
    operationFixture({ educationDates: ["2026-09-07", "2026-09-07", "9월 7일", ""] }),
    []
  );

  assert.deepEqual(
    plans.map((plan) => plan.eventDate),
    ["2026-09-07"]
  );
});

// ── 교육일 구간 교체 ─────────────────────────────────────────────
test("구간을 옮기면 그 구간의 날짜가 함께 움직인다", () => {
  const result = replaceEducationRun(EDUCATION_DATES, "2026-09-07", "2026-09-08", "2026-09-14", "2026-09-15");

  assert.equal(result.conflict, false);
  assert.deepEqual(result.dates, ["2026-09-04", "2026-09-14", "2026-09-15"]);
});

test("구간 길이를 늘리면 늘어난 날까지 교육일이 된다", () => {
  const result = replaceEducationRun(
    ["2026-09-07", "2026-09-08"],
    "2026-09-07",
    "2026-09-08",
    "2026-09-07",
    "2026-09-10"
  );

  assert.equal(result.conflict, false);
  assert.deepEqual(result.dates, ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]);
});

test("옮긴 구간이 다른 교육일과 겹치면 충돌로 알린다", () => {
  const result = replaceEducationRun(EDUCATION_DATES, "2026-09-07", "2026-09-08", "2026-09-03", "2026-09-04");

  assert.equal(result.conflict, true);
  assert.deepEqual(result.dates, EDUCATION_DATES);
});

test("같은 자리로 옮기면 아무것도 바뀌지 않는다", () => {
  const result = replaceEducationRun(EDUCATION_DATES, "2026-09-07", "2026-09-08", "2026-09-07", "2026-09-08");

  assert.equal(result.conflict, false);
  assert.deepEqual(result.dates, EDUCATION_DATES);
});

// ── 이벤트 일정 → 회차 값 ─────────────────────────────────────────
test("종일 일정의 종료일은 배타적이라 하루를 뺀다", () => {
  const schedule = eventScheduleToSession(
    eventFixture({ start: { date: "2026-09-07" }, end: { date: "2026-09-10" } })
  );

  assert.deepEqual(schedule, { startDate: "2026-09-07", endDate: "2026-09-09", timeText: "" });
});

test("시간 지정 일정은 여러 날에 걸쳐도 시작·종료 날짜를 각각 읽는다", () => {
  const schedule = eventScheduleToSession(
    eventFixture({
      start: { dateTime: "2026-09-07T10:00:00+09:00" },
      end: { dateTime: "2026-09-08T17:30:00+09:00" }
    })
  );

  assert.deepEqual(schedule, {
    startDate: "2026-09-07",
    endDate: "2026-09-08",
    timeText: "10:00 ~ 17:30"
  });
});

// ── 자기 쓰기 잔향 방어 (최소 시차) ──────────────────────────────
test("hub-om이 방금 쓴 잔향(1초 차이)은 사람의 수정으로 보지 않는다", () => {
  const operationUpdatedAt = new Date("2026-09-03T06:27:26.598Z");
  const event = eventFixture({
    start: { dateTime: "2026-09-14T10:00:00+09:00" },
    end: { dateTime: "2026-09-15T17:00:00+09:00" },
    updated: "2026-09-03T06:27:27.688Z"
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, operationUpdatedAt));

  // 운영현황을 덮어쓰지 않고 캘린더를 되돌리는 쪽으로 판정한다.
  assert.equal(item.action, "캘린더 원복");
});

test("시차를 충분히 넘기면 사람의 수정으로 본다", () => {
  const operationUpdatedAt = new Date("2026-09-03T06:00:00.000Z");
  const event = eventFixture({
    start: { dateTime: "2026-09-14T10:00:00+09:00" },
    end: { dateTime: "2026-09-15T17:00:00+09:00" },
    updated: "2026-09-03T06:10:00.000Z"
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, operationUpdatedAt));

  assert.equal(item.action, "운영현황 반영");
});
