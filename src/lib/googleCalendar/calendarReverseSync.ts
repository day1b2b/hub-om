// 구글 캘린더 → 운영현황 역반영의 "무엇을 바꿀지" 계산 단계.
//
// 이 모듈은 읽기만 한다. 실제 DB 쓰기·캘린더 patch는 이 계획을 받아 다음 단계에서 한다.
// 스펙: docs/plans/2026-08-19-operations-calendar-reflect.md (D6~D9, 5-B절)
//
// 판정 원칙
//  - 매핑 단위는 "회차의 실제 교육일 1일 ↔ 이벤트 1건"이다.
//  - 담당 매니저가 캘린더에서 고칠 수 있는 것은 날짜·시간뿐이다(D7).
//  - 제목·장소가 바뀌었으면 운영현황 값으로 되돌린다(원복).
//  - 같은 회차가 양쪽에서 바뀌면 최신 수정이 이긴다. 이벤트 updated vs 회차 updatedAt.
//  - 원본 이벤트가 사라졌으면(cancelled) 손대지 않는다. 캘린더에서의 삭제는 hub-om에
//    반영하지 않고 매핑도 남겨 둔다(D8). 아무 처리도 없으니 로그가 유일한 흔적이다.
//
// syncToken 대신 updatedMin 시간 창을 쓴다. 저장할 상태가 없어 마이그레이션이 필요 없고,
// 실행이 한 번 빠져도 다음 창이 겹치면 따라잡는다.

import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { listUpdatedEvents, type CalendarEventSnapshot } from "./calendarWriteClient";
import { findCalendarEventLinksByCalendar, type CalendarEventLink } from "./calendarEventLinkRepository";
import { isCalendarWriteEnabled, listPartCalendars } from "./calendarWriteConfig";
import { findOperationUpdatedAt } from "./operationSessionTimestamps";
import {
  evaluateEventAgainstOperation,
  type ReverseSyncAction,
  type ReverseSyncItem
} from "./calendarReverseSyncRules";

export * from "./calendarReverseSyncRules";

const DEFAULT_LOOKBACK_MINUTES = 60;

export interface ReverseSyncSkipped {
  calendarId: string;
  eventId: string;
  reason: string;
}

export interface ReverseSyncPlan {
  ok: boolean;
  enabled: boolean;
  lookbackMinutes: number;
  minLagSeconds: number;
  updatedMin: string;
  calendars: { partKey: string; calendarId: string; scannedEvents: number; linkedEvents: number }[];
  items: ReverseSyncItem[];
  counts: Record<ReverseSyncAction, number>;
  skipped: ReverseSyncSkipped[];
  warning?: string;
}

export async function planCalendarReverseSync(options?: { now?: Date }): Promise<ReverseSyncPlan> {
  const now = options?.now ?? new Date();
  const lookbackMinutes = readLookbackMinutes();
  const updatedMin = new Date(now.getTime() - lookbackMinutes * 60_000).toISOString();
  const empty: ReverseSyncPlan = {
    ok: true,
    enabled: true,
    lookbackMinutes,
    minLagSeconds: readMinLagMs() / 1000,
    updatedMin,
    calendars: [],
    items: [],
    counts: { "운영현황 반영": 0, "캘린더 원복": 0 },
    skipped: []
  };

  if (!isCalendarWriteEnabled()) {
    return { ...empty, enabled: false, warning: "구글 캘린더 연동이 꺼져 있습니다(GOOGLE_CAL_OAUTH_*·GOOGLE_CAL_PART_CALENDARS 확인)." };
  }

  const partCalendars = listPartCalendars();
  if (partCalendars.length === 0) {
    return { ...empty, enabled: false, warning: "GOOGLE_CAL_PART_CALENDARS에 파트 캘린더가 없습니다." };
  }

  const operations = new Map(
    (await getOperationRepository().listOperations()).map((operation) => [operation.operationId, operation])
  );

  const calendars: ReverseSyncPlan["calendars"] = [];
  const skipped: ReverseSyncSkipped[] = [];
  const pending: { link: CalendarEventLink; partKey: string; event: CalendarEventSnapshot }[] = [];

  for (const { partKey, calendarId } of partCalendars) {
    const [events, links] = await Promise.all([
      listUpdatedEvents(calendarId, updatedMin),
      findCalendarEventLinksByCalendar(calendarId)
    ]);

    let linkedEvents = 0;

    for (const event of events) {
      const link = links.get(event.id);

      if (!link) {
        // 매핑이 없는 이벤트 = hub-om이 만들지 않은 일정. 손대지 않고 기록만 남긴다.
        skipped.push({ calendarId, eventId: event.id, reason: "hub-om 매핑 없음(직접 만든 일정)" });
        continue;
      }

      linkedEvents += 1;
      pending.push({ link, partKey, event });
    }

    calendars.push({ partKey, calendarId, scannedEvents: events.length, linkedEvents });
  }

  const updatedAtByOperation = await findOperationUpdatedAt(pending.map((entry) => entry.link.operationId));
  const items: ReverseSyncItem[] = [];

  for (const { link, partKey, event } of pending) {
    const operation = operations.get(link.operationId);

    if (!operation) {
      skipped.push({ calendarId: link.calendarId, eventId: event.id, reason: `매핑된 회차를 찾지 못함(${link.operationId})` });
      continue;
    }

    const evaluation = evaluateEventAgainstOperation(
      operation,
      link,
      event,
      updatedAtByOperation.get(link.operationId) ?? null,
      partKey,
      readMinLagMs()
    );

    if (evaluation.kind === "item") items.push(evaluation.item);
    if (evaluation.kind === "skip") {
      // 사람이 원본을 지운 건 아무 처리도 하지 않으므로 로그가 유일한 흔적이다.
      // 응답의 skipped는 스케줄 실행에서 아무도 읽지 않는다.
      if (event.status === "cancelled") {
        console.warn(
          `[gcal-reverse] ${link.operationId} 원본 삭제 감지 — 무조치` +
            ` (교육일=${link.eventDate}, event=${event.id}, calendar=${link.calendarId})`
        );
      }

      skipped.push({ calendarId: link.calendarId, eventId: event.id, reason: evaluation.reason });
    }
  }

  const counts = { "운영현황 반영": 0, "캘린더 원복": 0 } satisfies Record<ReverseSyncAction, number>;
  for (const item of items) counts[item.action] += 1;

  return { ...empty, calendars, items: sortItems(items), counts, skipped };
}

const ACTION_ORDER: ReverseSyncAction[] = ["운영현황 반영", "캘린더 원복"];

function sortItems(items: ReverseSyncItem[]): ReverseSyncItem[] {
  return [...items].sort((a, b) => {
    if (a.action !== b.action) return ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action);

    return a.companyName.localeCompare(b.companyName, "ko");
  });
}

/**
 * 사람의 수정으로 인정하는 최소 시차(초). hub-om 자기 쓰기의 잔향(1~2초)을 걸러낸다.
 * 0으로 두면 시차 없이 최신 승자 판정만 한다(권장하지 않음).
 */
function readMinLagMs(): number {
  const parsed = Number(process.env.CALENDAR_REVERSE_SYNC_MIN_LAG_SECONDS?.trim());

  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) * 1000 : 120_000;
}

function readLookbackMinutes(): number {
  const parsed = Number(process.env.CALENDAR_REVERSE_SYNC_LOOKBACK_MINUTES?.trim());

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_LOOKBACK_MINUTES;
}
