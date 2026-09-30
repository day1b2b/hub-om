import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { withCalendarOperationLock } from "./calendarOperationLock";
// 운영현황 변경을 구글 캘린더에 반영한다(hub-om → 구글).
//
// 이 모듈의 함수는 절대 throw하지 않는다. 운영현황 저장은 이미 끝난 뒤에 불리는
// 부수작업이라, 구글이 죽었다고 저장을 되돌리거나 요청을 실패시키면 안 된다.
// (스펙 §6, src/app/api/om-request/route.ts의 부수작업 격리와 같은 방침)
//
// 실제 교육일마다 이벤트를 따로 만든다. 회차 기간에 쉬는 날이 섞이면 기간 이벤트
// 하나로는 교육 없는 날까지 일정이 잡히기 때문이다. 교육일이 바뀌면 늘어난 날은
// 새로 만들고, 빠진 날은 지운다.

import type { OperationSession } from "@/lib/data/operationTypes";
import { isCalendarWriteEnabled, resolvePartCalendarId } from "./calendarWriteConfig";
import { deleteEvent, insertOperationEvent, patchEvent, readEventAttendees } from "./calendarWriteClient";
import { resolveCalendarTargets } from "./calendarParticipants";
import { notifyCalendarReflectSkip } from "./notifyCalendarReflectSkip";
import { attendeesChanged, buildCalendarEventBodies } from "./operationCalendarEvent";
import {
  deleteMatchingCalendarEventLink,
  listCalendarEventLinks,
  saveCalendarEventLink,
  type CalendarEventLink
} from "./calendarEventLinkRepository";

/**
 * 기능을 켜기 전부터 있던 과정은 캘린더에 올리지 않는다.
 * 그런 과정을 누가 수정했다는 이유로 뒤늦게 초대 메일이 나가면 받는 사람이 당황한다.
 * 그래서 이벤트를 새로 만드는 것은 원칙적으로 "운영 생성" 때뿐이고, 수정은 이미 캘린더에
 * 올라가 있는 과정(매핑이 있는 과정)에만 반영한다.
 *
 * 이 기능이 배포된 날짜. 매핑이 없는 과정을 "수정" 트리거로 만났을 때, 이 날짜 이후에
 * 생성된 과정이면 "기능 도입 전 과정"이 아니라 "생성 시점에 파트를 못 정해 건너뛴 과정"으로
 * 보고 뒤늦게라도 이벤트를 만든다(아래 reflectOperationUnlocked 참고, calendarParticipants.ts의
 * 관련 주석과 함께 보면 됨).
 */
const CALENDAR_REFLECT_LAUNCH_DATE = new Date("2026-08-21T00:00:00Z");

type ReflectTrigger = "created" | "updated";

async function reflectOperationUnlocked(operation: OperationSession, trigger: ReflectTrigger, skipEventId?: string): Promise<void> {
  try {
    if (!isCalendarWriteEnabled()) return;

    const targets = await resolveCalendarTargets(operation);
    if (targets.unresolvedNames.length > 0) {
      // 초대만 빠뜨리고 일정은 그대로 만든다.
      console.warn("[gcal] CALENDAR_ATTENDEES_UNRESOLVED", targets.unresolvedNames.length);
    }

    const calendarId = resolvePartCalendarId(targets.partKey);
    if (!calendarId) {
      console.warn("[gcal] CALENDAR_PART_NOT_FOUND");
      // 무음 누락 방지: 파트를 못 정하면(담당 OM 미배정 + 요청 LD 소속이 파트 아님) 담당자에게
      // DM으로 알린다. 생성 시점만 알린다 — 같은 과정을 다시 저장할 때마다 반복 알림이 가지 않게.
      if (trigger === "created") {
        await notifyCalendarReflectSkip(
          operation,
          `파트를 못 정함(담당 OM·요청 LD 소속이 파트(1/2/3)가 아님, 파트=${targets.partKey ?? "없음"})`
        );
      }
      return;
    }

    const existing = await listCalendarEventLinks(operation.operationId);

    if (existing.length === 0 && trigger === "updated") {
      // 매핑이 없는 채로 "수정"을 만났다. 기능 도입 전에 만들어진 과정이면 그대로 둔다.
      // 기능 도입 후 생성됐다면 생성 시점에 파트를 못 정해 건너뛴 것뿐이니(예: 담당 OM 미배정
      // + 요청 LD 소속도 파트가 아니었던 경우) "생성"처럼 취급해 아래로 흘려보내 지금이라도 만든다.
      const createdAt = await getOperationRepository().getOperationCreatedAt(operation.operationId);
      if (!createdAt || createdAt < CALENDAR_REFLECT_LAUNCH_DATE) return;
    }

    // 담당 OM이 다른 파트로 바뀌면 캘린더가 달라진다. 옛 캘린더의 이벤트를 먼저 지운다.
    const sameCalendar = new Map<string, CalendarEventLink>();
    for (const link of existing) {
      if (link.calendarId === calendarId) {
        sameCalendar.set(link.eventDate, link);
        continue;
      }

      await deleteEvent(link.calendarId, link.eventId);
      await deleteMatchingCalendarEventLink(link);
    }

    for (const plan of buildCalendarEventBodies(operation, targets.attendeeEmails, targets.partKey)) {
      const link = sameCalendar.get(plan.eventDate);

      if (skipEventId && link?.eventId === skipEventId) { sameCalendar.delete(plan.eventDate); continue; }
      if (link) {
        // 참석자가 달라진 수정만 메일을 보낸다. 이 서비스는 요청 접수 시 이벤트를 먼저
        // 만들고 나중에 OM을 배정하므로, 초대 메일이 실제로 나가는 시점이 이 patch다.
        // 담당·현장 OM이 같은 사람이면 목록이 그대로여서 메일이 중복으로 가지 않는다.
        const notifyAttendees = targets.unresolvedNames.length === 0 && attendeesChanged(
          await readEventAttendees(calendarId, link.eventId),
          plan.body.attendees?.map((attendee) => attendee.email) ?? []
        );

        const patchBody = { ...plan.body, location: plan.body.location ?? "" };
        // 이메일을 해석하지 못한 상태는 담당자 해제로 간주하지 않는다.
        if (targets.unresolvedNames.length === 0) patchBody.attendees = plan.body.attendees ?? [];
        else delete patchBody.attendees;
        const result = await patchEvent(calendarId, link.eventId, patchBody, { notifyAttendees });
        sameCalendar.delete(plan.eventDate);

        if (result !== "missing") continue;

        // 사람이 캘린더에서 지운 이벤트다(D8: 캘린더 쪽 삭제는 운영현황에 반영하지 않는다).
        // 10분마다 도는 역반영은 이런 이벤트를 되살리지 않지만, 여기는 사람이 hub-om에서
        // 회차를 저장한 시점이다 — 잘못 지운 일정을 되살리는 길이 이것뿐이므로 다시 만든다
        // (2026-09-04 결정). 초대 메일은 insert라 다시 나간다. 매핑은 새 eventId로 갈아 끼운다.
        const recreatedId = await insertOperationEvent(calendarId, plan.body, { operationId: operation.operationId, eventDate: plan.eventDate, source: "forward", previousEventId: link.eventId });
        await saveCalendarEventLink({
          operationId: operation.operationId,
          calendarId,
          eventId: recreatedId,
          eventDate: plan.eventDate
        });
        console.info("[gcal] CALENDAR_EVENT_RECREATED");
        continue;
      }

      const eventId = await insertOperationEvent(calendarId, plan.body, { operationId: operation.operationId, eventDate: plan.eventDate, source: "forward", occupiedEventIds: existing.filter(entry => entry.calendarId === calendarId && entry.eventDate !== plan.eventDate).map(entry => entry.eventId) });
      await saveCalendarEventLink({
        operationId: operation.operationId,
        calendarId,
        eventId,
        eventDate: plan.eventDate
      });
    }

    // 남은 매핑 = 교육일에서 빠진 날. 이벤트와 매핑을 함께 정리한다.
    for (const link of sameCalendar.values()) {
      await deleteEvent(link.calendarId, link.eventId);
      await deleteMatchingCalendarEventLink(link);
    }
  } catch {
    console.error("[gcal] CALENDAR_REFLECT_FAILED");
  }
}

async function reflectOperation(operation: OperationSession, trigger: ReflectTrigger, skipEventId?: string): Promise<void> {
  try {
    await withCalendarOperationLock(operation.operationId, async () => {
      if (!isCalendarWriteEnabled()) return;
      const current = await getOperationRepository().getOperationById(operation.operationId);
      if (!current) return; // 생성 직후 취소·삭제된 회차를 오래된 객체로 되살리지 않는다.
      await reflectOperationUnlocked(current, trigger, skipEventId);
    });
  } catch {
    console.error("[gcal] CALENDAR_REFLECT_LOCK_FAILED");
  }
}

/** 운영 생성. 교육일마다 일정을 만들고 담당·현장 OM을 초대한다. */
export function reflectOperationCreated(operation: OperationSession): Promise<void> {
  return reflectOperation(operation, "created");
}

/**
 * 운영 수정. 이미 캘린더에 올라간 과정을 갱신한다. 매핑이 없는 과정은 기능 도입 전 과정이면
 * 그대로 두고, 기능 도입 후 과정이면(생성 시점에 파트를 못 정해 건너뛴 경우) 지금 만든다.
 */
export function reflectOperationUpdated(operation: OperationSession, skipEventId?: string): Promise<void> {
  return reflectOperation(operation, "updated", skipEventId);
}

/** 취소·삭제. 회차에 걸린 이벤트를 모두 지우고 매핑도 정리한다(스펙 D4). */
export type CalendarDeleteRecovery = "not-found" | "completed" | "pending";

async function reflectOperationDeleteUnlocked(operationId: string): Promise<CalendarDeleteRecovery> {
  try {
    const existing = await listCalendarEventLinks(operationId);
    if (existing.length === 0) return "not-found";
    if (!isCalendarWriteEnabled()) return "pending";

    for (const link of existing) {
      await deleteEvent(link.calendarId, link.eventId);
      await deleteMatchingCalendarEventLink(link);
    }
    return "completed";
  } catch {
    console.error("[gcal] CALENDAR_DELETE_FAILED");
    return "pending";
  }
}

export async function reflectOperationDelete(operationId: string): Promise<void> {
  try { await withCalendarOperationLock(operationId, () => reflectOperationDeleteUnlocked(operationId)); }
  catch { console.error("[gcal] CALENDAR_DELETE_LOCK_FAILED"); }
}

/** Retries only a leftover Calendar mapping after the business row was already soft-deleted. */
export async function retryOperationCalendarDelete(operationId: string): Promise<CalendarDeleteRecovery> {
  try {
    if ((await listCalendarEventLinks(operationId)).length === 0) return "not-found";
    const result = await withCalendarOperationLock(operationId, () => reflectOperationDeleteUnlocked(operationId));
    // A concurrent retry may have completed between the preflight and lock acquisition.
    return result === "not-found" ? "completed" : result;
  }
  catch { console.error("[gcal] CALENDAR_DELETE_LOCK_FAILED"); return "pending"; }
}
