import assert from "node:assert/strict";
import { test } from "node:test";

import type { OperationSession } from "@/lib/data/operationTypes";
import type { CalendarEventSnapshot } from "@/lib/googleCalendar/calendarWriteClient.ts";
import type { CalendarEventLink } from "@/lib/googleCalendar/calendarEventLinkRepository.ts";
import { buildCalendarEventBodies } from "@/lib/googleCalendar/operationCalendarEvent.ts";
import {
  evaluateEventAgainstOperation,
  eventScheduleToSession,
  replaceEducationDate,
  type ReverseSyncEvaluation,
  type ReverseSyncItem
} from "@/lib/googleCalendar/calendarReverseSyncRules.ts";

const EDUCATION_DATES = ["2026-09-04", "2026-09-07", "2026-09-08"];

// 판정에 쓰이는 필드만 채운 최소 회차. 실제 교육일 3일 중 둘째 날(9/07)을 기준으로 본다.
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

function linkFixture(eventDate = "2026-09-07"): CalendarEventLink {
  return { operationId: "OP-1", calendarId: "cal-1", eventId: "EV-1", eventDate };
}

// 회차의 9/07 계획과 일치하는 이벤트. 각 테스트에서 어긋나게 만들 부분만 덮어쓴다.
function eventFixture(overrides: Partial<CalendarEventSnapshot> = {}): CalendarEventSnapshot {
  return {
    id: "EV-1",
    status: "confirmed",
    summary: "[롯데정밀화학] AI 업무 효율화_2회차 (2/3일차)",
    location: "서울",
    start: { dateTime: "2026-09-07T10:00:00+09:00" },
    end: { dateTime: "2026-09-07T17:00:00+09:00" },
    updated: "2026-09-07T02:00:00.000Z",
    ...overrides
  };
}

const OPERATION_UPDATED_AT = new Date("2026-09-07T01:00:00.000Z");

function itemOf(evaluation: ReverseSyncEvaluation): ReverseSyncItem {
  assert.equal(evaluation.kind, "item");
  return (evaluation as { kind: "item"; item: ReverseSyncItem }).item;
}

// ── 교육일별 이벤트 판정 ──────────────────────────────────────────
test("일치하면 할 일이 없다", () => {
  const evaluation = evaluateEventAgainstOperation(
    operationFixture(),
    linkFixture(),
    eventFixture(),
    OPERATION_UPDATED_AT
  );

  assert.equal(evaluation.kind, "none");
});

test("캘린더가 더 최신이고 날짜가 바뀌었으면 그 교육일을 옮긴다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-09T10:00:00+09:00" },
    end: { dateTime: "2026-09-09T17:00:00+09:00" }
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, OPERATION_UPDATED_AT));

  assert.equal(item.action, "운영현황 반영");
  assert.equal(item.perEducationDay, true);
  assert.equal(item.eventDate, "2026-09-07");
  assert.equal(item.scheduleChange?.to.startDate, "2026-09-09");
  assert.equal(item.scheduleChange?.to.timeText, "10:00 ~ 17:00");
});

test("시간만 바뀌어도 캘린더가 최신이면 반영 대상이다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-07T13:00:00+09:00" },
    end: { dateTime: "2026-09-07T18:00:00+09:00" }
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, OPERATION_UPDATED_AT));

  assert.equal(item.action, "운영현황 반영");
  assert.equal(item.scheduleChange?.to.timeText, "13:00 ~ 18:00");
});

test("운영현황이 더 최신이면 캘린더를 되돌린다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-09T10:00:00+09:00" },
    end: { dateTime: "2026-09-09T17:00:00+09:00" },
    updated: "2026-09-07T00:30:00.000Z"
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, OPERATION_UPDATED_AT));

  assert.equal(item.action, "캘린더 원복");
  assert.deepEqual(item.revertFields, ["날짜·시간"]);
});

test("회차 수정 시각을 모르면 운영현황을 덮어쓰지 않는다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-09T10:00:00+09:00" },
    end: { dateTime: "2026-09-09T17:00:00+09:00" }
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
    start: { dateTime: "2026-09-09T10:00:00+09:00" },
    end: { dateTime: "2026-09-09T17:00:00+09:00" }
  });

  const item = itemOf(evaluateEventAgainstOperation(operationFixture(), linkFixture(), event, OPERATION_UPDATED_AT));

  assert.equal(item.action, "운영현황 반영");
  assert.deepEqual(item.revertFields, ["제목"]);
});

test("원본이 취소되면 재생성 대상이다", () => {
  const item = itemOf(
    evaluateEventAgainstOperation(
      operationFixture(),
      linkFixture(),
      eventFixture({ status: "cancelled" }),
      OPERATION_UPDATED_AT
    )
  );

  assert.equal(item.action, "이벤트 재생성");
});

test("운영현황에서 빠진 교육일은 손대지 않고 건너뛴다", () => {
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
    summary: "[롯데정밀화학] AI 업무 효율화_2회차",
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
test("교육일마다 이벤트를 하나씩 만들고 제목에 일차를 붙인다", () => {
  const plans = buildCalendarEventBodies(operationFixture(), []);

  assert.deepEqual(
    plans.map((plan) => plan.eventDate),
    EDUCATION_DATES
  );
  assert.equal(plans[1].body.summary, "[롯데정밀화학] AI 업무 효율화_2회차 (2/3일차)");
  assert.deepEqual(plans[1].body.start, { dateTime: "2026-09-07T10:00:00", timeZone: "Asia/Seoul" });
  assert.deepEqual(plans[1].body.end, { dateTime: "2026-09-07T17:00:00", timeZone: "Asia/Seoul" });
});

test("교육일이 하나면 제목에 일차를 붙이지 않는다", () => {
  const plans = buildCalendarEventBodies(operationFixture({ educationDates: ["2026-09-07"] }), []);

  assert.equal(plans.length, 1);
  assert.equal(plans[0].body.summary, "[롯데정밀화학] AI 업무 효율화_2회차");
});

test("시간 표기를 못 읽으면 교육일마다 하루짜리 종일 일정을 만든다", () => {
  const plans = buildCalendarEventBodies(operationFixture({ timeText: "미정" }), []);

  assert.deepEqual(plans[0].body.start, { date: "2026-09-04" });
  assert.deepEqual(plans[0].body.end, { date: "2026-09-05" });
});

test("교육일이 없으면 기간 이벤트 1건이고 교육일 키는 시작일이다", () => {
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

// ── 교육일 교체 ───────────────────────────────────────────────────
test("교육일 하나를 다른 날짜로 옮기고 정렬한다", () => {
  const result = replaceEducationDate(EDUCATION_DATES, "2026-09-07", "2026-09-02");

  assert.equal(result.conflict, false);
  assert.deepEqual(result.dates, ["2026-09-02", "2026-09-04", "2026-09-08"]);
});

test("옮길 날짜에 이미 교육일이 있으면 충돌로 알린다", () => {
  const result = replaceEducationDate(EDUCATION_DATES, "2026-09-07", "2026-09-08");

  assert.equal(result.conflict, true);
  assert.deepEqual(result.dates, EDUCATION_DATES);
});

test("같은 날짜로 옮기면 아무것도 바뀌지 않는다", () => {
  const result = replaceEducationDate(EDUCATION_DATES, "2026-09-07", "2026-09-07");

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
