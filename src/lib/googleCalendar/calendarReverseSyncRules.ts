// 캘린더 역반영의 판정 규칙(순수 함수).
//
// 구글·DB를 호출하지 않는 코드만 둬서 테스트에서 규칙(D7~D9)을 그대로 검증할 수 있게 한다.
// 실행(읽기·쓰기)은 calendarReverseSync.ts가 담당한다.

import type { OperationSession } from "@/lib/data/operationTypes";
import type { CalendarEventSnapshot } from "./calendarWriteClient";
import { buildCalendarEventBody } from "./operationCalendarEvent";

export type ReverseSyncAction =
  /** 캘린더가 더 최신이고 날짜·시간이 다르다 → 운영현황을 갱신한다. */
  | "운영현황 반영"
  /** 운영현황이 더 최신이거나 날짜 외 필드가 바뀌었다 → 캘린더를 운영현황 값으로 되돌린다. */
  | "캘린더 원복"
  /** 원본 이벤트가 사라졌다 → 다시 만들고 담당 OM에게 알린다. */
  | "이벤트 재생성";

export interface ReverseSyncSchedule {
  startDate: string;
  endDate: string;
  timeText: string;
}

export interface ReverseSyncItem {
  action: ReverseSyncAction;
  operationId: string;
  calendarId: string;
  eventId: string;
  companyName: string;
  courseName: string;
  roundNo: string;
  omName: string;
  eventUpdatedAt: string;
  operationUpdatedAt: null | string;
  /** action이 "운영현황 반영"일 때만 채운다. */
  scheduleChange?: { from: ReverseSyncSchedule; to: ReverseSyncSchedule };
  /** 운영현황 값으로 되돌릴 필드 이름(제목·장소·날짜·시간). */
  revertFields?: string[];
}

/**
 * 이벤트 1건과 회차 1건을 비교해 무엇을 할지 정한다. 구글·DB 호출이 없는 순수 함수라
 * 판정 규칙(D7~D9)을 테스트로 고정할 수 있다. 바꿀 것이 없으면 null.
 */
export function evaluateEventAgainstOperation(
  operation: OperationSession,
  link: { operationId: string; calendarId: string; eventId: string },
  event: CalendarEventSnapshot,
  operationUpdatedAt: Date | null
): null | ReverseSyncItem {
  const base = {
    operationId: operation.operationId,
    calendarId: link.calendarId,
    eventId: event.id,
    companyName: operation.companyName,
    courseName: operation.courseName,
    roundNo: operation.roundNo,
    omName: operation.om,
    eventUpdatedAt: event.updated,
    operationUpdatedAt: operationUpdatedAt?.toISOString() ?? null
  };

  // 원본이 사라진 경우. 회차 취소는 운영현황에서만 하므로(D4) 이건 비정상이다.
  if (event.status === "cancelled") {
    return { ...base, action: "이벤트 재생성" };
  }

  const expected = buildCalendarEventBody(operation, []);
  const expectedSchedule = normalizeSchedule(expected.start, expected.end);
  const eventSchedule = normalizeSchedule(event.start, event.end);
  const scheduleDiffers = expectedSchedule !== eventSchedule;

  const revertFields: string[] = [];
  if (expected.summary !== event.summary) revertFields.push("제목");
  if ((expected.location ?? "") !== event.location) revertFields.push("장소");

  if (!scheduleDiffers && revertFields.length === 0) return null;

  // 날짜·시간이 다를 때만 승자를 따진다. 캘린더가 더 최신이면 운영현황에 반영한다(D7).
  const calendarIsNewer = isCalendarNewer(event.updated, operationUpdatedAt);
  const nextSchedule = scheduleDiffers ? eventScheduleToSession(event) : null;

  if (scheduleDiffers && calendarIsNewer && nextSchedule) {
    return {
      ...base,
      action: "운영현황 반영",
      scheduleChange: {
        from: { startDate: operation.startDate, endDate: operation.endDate, timeText: operation.timeText },
        to: nextSchedule
      },
      // 날짜·시간은 반영하고, 사람이 함께 바꾼 제목·장소는 되돌린다.
      ...(revertFields.length > 0 ? { revertFields } : {})
    };
  }

  return {
    ...base,
    action: "캘린더 원복",
    revertFields: [...revertFields, ...(scheduleDiffers ? ["날짜·시간"] : [])]
  };
}

/** 종일/시간 지정 두 형태를 한 문자열로 만들어 비교한다. 초·오프셋 표기 차이는 무시한다. */
function normalizeSchedule(
  start: { date?: string; dateTime?: string },
  end: { date?: string; dateTime?: string }
): string {
  if (start.dateTime && end.dateTime) {
    return `time:${start.dateTime.slice(0, 16)}~${end.dateTime.slice(0, 16)}`;
  }

  return `allday:${start.date ?? ""}~${end.date ?? ""}`;
}

/** 이벤트 일정 → 회차의 startDate·endDate·timeText. 종일 일정이면 시간 표기를 비운다. */
export function eventScheduleToSession(event: CalendarEventSnapshot): null | ReverseSyncSchedule {
  if (event.start.dateTime && event.end.dateTime) {
    return {
      startDate: event.start.dateTime.slice(0, 10),
      endDate: event.end.dateTime.slice(0, 10),
      timeText: `${event.start.dateTime.slice(11, 16)} ~ ${event.end.dateTime.slice(11, 16)}`
    };
  }

  if (event.start.date && event.end.date) {
    // 종일 일정의 end.date는 배타적이라 마지막 날은 하루 전이다.
    return { startDate: event.start.date, endDate: previousDay(event.end.date), timeText: "" };
  }

  return null;
}

function previousDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);

  return parsed.toISOString().slice(0, 10);
}

/**
 * 회차 수정 시각을 모르면(로컬 JSON 저장소 등) 캘린더를 최신으로 보지 않는다.
 * 판단 근거 없이 운영현황을 덮어쓰지 않는 쪽이 안전하다.
 */
function isCalendarNewer(eventUpdated: string, operationUpdatedAt: Date | null): boolean {
  if (!operationUpdatedAt) return false;

  const eventTime = Date.parse(eventUpdated);
  if (Number.isNaN(eventTime)) return false;

  return eventTime > operationUpdatedAt.getTime();
}

