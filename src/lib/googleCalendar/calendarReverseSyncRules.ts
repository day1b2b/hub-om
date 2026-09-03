// 캘린더 역반영의 판정 규칙(순수 함수).
//
// 구글·DB를 호출하지 않는 코드만 둬서 테스트에서 규칙(D7~D9)을 그대로 검증할 수 있게 한다.
// 실행(읽기·쓰기)은 calendarReverseSync.ts / applyCalendarReverseSync.ts가 담당한다.
//
// 매핑 단위는 "연속 교육일 구간 1개 ↔ 이벤트 1건"이다(9/7~9/9 한 건, 9/11 한 건).
// 매핑 키는 구간의 시작 교육일이고, 매니저가 이벤트를 옮기면 그 구간이 옮겨진 것으로 본다.
// 제목은 파트에 따라 달라지므로(강의관리 표기) 이벤트가 있는 파트 키를 함께 받는다.

import type { OperationSession } from "@/lib/data/operationTypes";
import type { CalendarEventSnapshot } from "./calendarWriteClient";
import { enumerateDateRange } from "@/lib/data/operationCalculations";
import { buildCalendarEventBodies, normalizeEducationDates } from "./operationCalendarEvent";
import type { CalendarEventLink } from "./calendarEventLinkRepository";

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
  /** 매핑된 구간의 시작 교육일. 운영현황 반영은 이 구간을 새 구간으로 바꾸는 것이다. */
  eventDate: string;
  /** 매핑된 구간의 마지막 교육일. 하루짜리면 eventDate와 같다. */
  eventEndDate: string;
  /** 이벤트가 올라가 있는 파트 키. 제목을 다시 만들 때 필요하다. */
  partKey: null | string;
  companyName: string;
  courseName: string;
  roundNo: string;
  omName: string;
  /** 실제 교육일이 등록된 회차인지. 반영 방식이 달라진다. */
  perEducationDay: boolean;
  eventUpdatedAt: string;
  operationUpdatedAt: null | string;
  /** action이 "운영현황 반영"일 때만 채운다. */
  scheduleChange?: { from: ReverseSyncSchedule; to: ReverseSyncSchedule };
  /** 운영현황 값으로 되돌릴 필드 이름(제목·장소·날짜·시간). */
  revertFields?: string[];
}

export type ReverseSyncEvaluation =
  | { kind: "none" }
  | { kind: "skip"; reason: string }
  | { kind: "item"; item: ReverseSyncItem };

/**
 * 이벤트 1건과 회차 1건을 비교해 무엇을 할지 정한다. 구글·DB 호출이 없는 순수 함수라
 * 판정 규칙(D7~D9)을 테스트로 고정할 수 있다.
 */
export function evaluateEventAgainstOperation(
  operation: OperationSession,
  link: CalendarEventLink,
  event: CalendarEventSnapshot,
  operationUpdatedAt: Date | null,
  partKey?: string | null
): ReverseSyncEvaluation {
  const educationDates = normalizeEducationDates(operation.educationDates);
  const base = {
    operationId: operation.operationId,
    calendarId: link.calendarId,
    eventId: event.id,
    eventDate: link.eventDate,
    eventEndDate: link.eventDate,
    partKey: partKey ?? null,
    companyName: operation.companyName,
    courseName: operation.courseName,
    roundNo: operation.roundNo,
    omName: operation.om,
    perEducationDay: educationDates.length > 0,
    eventUpdatedAt: event.updated,
    operationUpdatedAt: operationUpdatedAt?.toISOString() ?? null
  };

  // 원본이 사라진 경우. 회차 취소는 운영현황에서만 하므로(D4) 이건 비정상이다.
  if (event.status === "cancelled") {
    return { kind: "item", item: { ...base, action: "이벤트 재생성" } };
  }

  const plan = buildCalendarEventBodies(operation, [], partKey).find((entry) => entry.eventDate === link.eventDate);
  if (!plan) {
    // 운영현황에서 이 교육일이 빠졌는데 정방향 반영이 아직 이벤트를 못 지운 상태.
    // 역반영에서 이벤트를 지우지는 않는다(삭제는 운영현황이 시작점이다). 다음 정방향 반영이 정리한다.
    return { kind: "skip", reason: `운영현황에 없는 교육일(${link.eventDate}) — 정방향 반영 대기` };
  }

  const expected = plan.body;
  base.eventEndDate = plan.eventEndDate;
  const scheduleDiffers = normalizeSchedule(expected.start, expected.end) !== normalizeSchedule(event.start, event.end);
  const revertFields: string[] = [];
  if (expected.summary !== event.summary) revertFields.push("제목");
  if ((expected.location ?? "") !== event.location) revertFields.push("장소");

  if (!scheduleDiffers && revertFields.length === 0) return { kind: "none" };

  // 날짜·시간이 다를 때만 승자를 따진다. 캘린더가 더 최신이면 운영현황에 반영한다(D7).
  const calendarIsNewer = isCalendarNewer(event.updated, operationUpdatedAt);
  const nextSchedule = scheduleDiffers ? eventScheduleToSession(event) : null;

  if (scheduleDiffers && calendarIsNewer && nextSchedule) {
    return {
      kind: "item",
      item: {
        ...base,
        action: "운영현황 반영",
        scheduleChange: {
          from: { startDate: operation.startDate, endDate: operation.endDate, timeText: operation.timeText },
          to: nextSchedule
        },
        // 날짜·시간은 반영하고, 사람이 함께 바꾼 제목·장소는 되돌린다.
        ...(revertFields.length > 0 ? { revertFields } : {})
      }
    };
  }

  return {
    kind: "item",
    item: {
      ...base,
      action: "캘린더 원복",
      revertFields: [...revertFields, ...(scheduleDiffers ? ["날짜·시간"] : [])]
    }
  };
}

/**
 * 교육일 목록에서 한 연속 구간을 새 구간으로 옮긴다.
 * 매니저가 3일짜리 이벤트를 옮기면 그 3일이 새 위치로 함께 움직이고, 길이를 늘리면
 * 늘어난 날짜까지 교육일이 된다.
 *
 * 옮길 곳에 (그 구간 밖의) 교육일이 이미 있으면 합치지 않고 충돌로 알린다 —
 * 하루에 이벤트가 두 개가 되는 상태를 코드가 임의로 정리하면 사람이 의도한 일정을 잃는다.
 */
export function replaceEducationRun(
  dates: string[],
  runStart: string,
  runEnd: string,
  nextStart: string,
  nextEnd: string
): { dates: string[]; conflict: boolean } {
  const normalized = normalizeEducationDates(dates);
  const oldRun = new Set(enumerateDateRange(runStart, runEnd));
  const nextRun = enumerateDateRange(nextStart, nextEnd);

  if (nextRun.length === 0) return { dates: normalized, conflict: true };

  const kept = normalized.filter((date) => !oldRun.has(date));
  if (nextRun.some((date) => kept.includes(date))) return { dates: normalized, conflict: true };

  return { dates: normalizeEducationDates([...kept, ...nextRun]), conflict: false };
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
