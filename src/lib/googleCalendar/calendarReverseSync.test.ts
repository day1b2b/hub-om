import assert from "node:assert/strict";
import { test } from "node:test";

import type { OperationSession } from "@/lib/data/operationTypes";
import type { CalendarEventSnapshot } from "@/lib/googleCalendar/calendarWriteClient.ts";
import {
  evaluateEventAgainstOperation,
  eventScheduleToSession
} from "@/lib/googleCalendar/calendarReverseSyncRules.ts";

// 판정에 쓰이는 필드만 채운 최소 회차. 나머지는 비교 대상이 아니다.
function operationFixture(overrides: Partial<OperationSession> = {}): OperationSession {
  return {
    operationId: "OP-1",
    companyName: "롯데정밀화학",
    courseName: "AI 업무 효율화",
    roundNo: "2",
    startDate: "2026-09-07",
    endDate: "2026-09-07",
    timeText: "10:00 ~ 17:00",
    region: "서울",
    om: "오수연",
    ...overrides
  } as OperationSession;
}

// 회차 fixture와 일치하는 이벤트. 각 테스트에서 어긋나게 만들 부분만 덮어쓴다.
function eventFixture(overrides: Partial<CalendarEventSnapshot> = {}): CalendarEventSnapshot {
  return {
    id: "EV-1",
    status: "confirmed",
    summary: "[롯데정밀화학] AI 업무 효율화_2회차",
    location: "서울",
    start: { dateTime: "2026-09-07T10:00:00+09:00" },
    end: { dateTime: "2026-09-07T17:00:00+09:00" },
    updated: "2026-09-07T02:00:00.000Z",
    ...overrides
  };
}

const link = { operationId: "OP-1", calendarId: "cal-1", eventId: "EV-1" };
const OPERATION_UPDATED_AT = new Date("2026-09-07T01:00:00.000Z");

test("일치하면 할 일이 없다", () => {
  const item = evaluateEventAgainstOperation(operationFixture(), link, eventFixture(), OPERATION_UPDATED_AT);

  assert.equal(item, null);
});

test("캘린더가 더 최신이고 시간이 바뀌었으면 운영현황에 반영한다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-07T13:00:00+09:00" },
    end: { dateTime: "2026-09-07T18:00:00+09:00" }
  });

  const item = evaluateEventAgainstOperation(operationFixture(), link, event, OPERATION_UPDATED_AT);

  assert.equal(item?.action, "운영현황 반영");
  assert.deepEqual(item?.scheduleChange?.to, {
    startDate: "2026-09-07",
    endDate: "2026-09-07",
    timeText: "13:00 ~ 18:00"
  });
  assert.equal(item?.scheduleChange?.from.timeText, "10:00 ~ 17:00");
});

test("운영현황이 더 최신이면 캘린더를 되돌린다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-07T13:00:00+09:00" },
    end: { dateTime: "2026-09-07T18:00:00+09:00" },
    updated: "2026-09-07T00:30:00.000Z"
  });

  const item = evaluateEventAgainstOperation(operationFixture(), link, event, OPERATION_UPDATED_AT);

  assert.equal(item?.action, "캘린더 원복");
  assert.deepEqual(item?.revertFields, ["날짜·시간"]);
});

test("회차 수정 시각을 모르면 운영현황을 덮어쓰지 않는다", () => {
  const event = eventFixture({
    start: { dateTime: "2026-09-07T13:00:00+09:00" },
    end: { dateTime: "2026-09-07T18:00:00+09:00" }
  });

  const item = evaluateEventAgainstOperation(operationFixture(), link, event, null);

  assert.equal(item?.action, "캘린더 원복");
});

test("제목·장소만 바뀌었으면 원복 대상이다", () => {
  const event = eventFixture({ summary: "사람이 바꾼 제목", location: "부산" });

  const item = evaluateEventAgainstOperation(operationFixture(), link, event, OPERATION_UPDATED_AT);

  assert.equal(item?.action, "캘린더 원복");
  assert.deepEqual(item?.revertFields, ["제목", "장소"]);
});

test("시간과 제목이 함께 바뀌면 시간은 반영하고 제목은 원복한다", () => {
  const event = eventFixture({
    summary: "사람이 바꾼 제목",
    start: { dateTime: "2026-09-07T13:00:00+09:00" },
    end: { dateTime: "2026-09-07T18:00:00+09:00" }
  });

  const item = evaluateEventAgainstOperation(operationFixture(), link, event, OPERATION_UPDATED_AT);

  assert.equal(item?.action, "운영현황 반영");
  assert.deepEqual(item?.revertFields, ["제목"]);
});

test("원본이 취소되면 재생성 대상이다", () => {
  const item = evaluateEventAgainstOperation(
    operationFixture(),
    link,
    eventFixture({ status: "cancelled" }),
    OPERATION_UPDATED_AT
  );

  assert.equal(item?.action, "이벤트 재생성");
});

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
