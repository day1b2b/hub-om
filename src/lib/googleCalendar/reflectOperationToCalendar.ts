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
import { deleteEvent, insertEvent, patchEvent, readEventAttendees } from "./calendarWriteClient";
import { resolveCalendarTargets } from "./calendarParticipants";
import { attendeesChanged, buildCalendarEventBodies } from "./operationCalendarEvent";
import {
  deleteCalendarEventLink,
  deleteCalendarEventLinks,
  listCalendarEventLinks,
  saveCalendarEventLink,
  type CalendarEventLink
} from "./calendarEventLinkRepository";

function logSkip(operationId: string, reason: string): void {
  console.warn(`[gcal] ${operationId} 반영 건너뜀: ${reason}`);
}

/**
 * 기능을 켜기 전부터 있던 과정은 캘린더에 올리지 않는다.
 * 그런 과정을 누가 수정했다는 이유로 뒤늦게 초대 메일이 나가면 받는 사람이 당황한다.
 * 그래서 이벤트를 새로 만드는 것은 "운영 생성" 때뿐이고, 수정은 이미 캘린더에
 * 올라가 있는 과정(매핑이 있는 과정)에만 반영한다.
 */
type ReflectTrigger = "created" | "updated";

async function reflectOperation(operation: OperationSession, trigger: ReflectTrigger): Promise<void> {
  try {
    if (!isCalendarWriteEnabled()) return;

    const targets = await resolveCalendarTargets(operation);
    if (targets.unresolvedNames.length > 0) {
      // 초대만 빠뜨리고 일정은 그대로 만든다.
      logSkip(operation.operationId, `이메일 미확인 참석자 ${targets.unresolvedNames.join(", ")}`);
    }

    const calendarId = resolvePartCalendarId(targets.partKey);
    if (!calendarId) {
      logSkip(operation.operationId, `파트 캘린더를 찾지 못함(파트=${targets.partKey ?? "없음"})`);
      return;
    }

    const existing = await listCalendarEventLinks(operation.operationId);

    // 수정인데 캘린더에 없는 과정 = 기능 도입 전에 만들어진 과정. 건드리지 않는다.
    if (existing.length === 0 && trigger === "updated") return;

    // 담당 OM이 다른 파트로 바뀌면 캘린더가 달라진다. 옛 캘린더의 이벤트를 먼저 지운다.
    const sameCalendar = new Map<string, CalendarEventLink>();
    for (const link of existing) {
      if (link.calendarId === calendarId) {
        sameCalendar.set(link.eventDate, link);
        continue;
      }

      await deleteEvent(link.calendarId, link.eventId);
      await deleteCalendarEventLink(operation.operationId, link.eventDate);
    }

    for (const plan of buildCalendarEventBodies(operation, targets.attendeeEmails, targets.partKey)) {
      const link = sameCalendar.get(plan.eventDate);

      if (link) {
        // 참석자가 달라진 수정만 메일을 보낸다. 이 서비스는 요청 접수 시 이벤트를 먼저
        // 만들고 나중에 OM을 배정하므로, 초대 메일이 실제로 나가는 시점이 이 patch다.
        // 담당·현장 OM이 같은 사람이면 목록이 그대로여서 메일이 중복으로 가지 않는다.
        const notifyAttendees = attendeesChanged(
          await readEventAttendees(calendarId, link.eventId),
          plan.body.attendees?.map((attendee) => attendee.email) ?? []
        );

        const result = await patchEvent(calendarId, link.eventId, plan.body, { notifyAttendees });
        sameCalendar.delete(plan.eventDate);

        if (result !== "missing") continue;

        // 사람이 캘린더에서 지운 이벤트다(D8: 캘린더 쪽 삭제는 운영현황에 반영하지 않는다).
        // 10분마다 도는 역반영은 이런 이벤트를 되살리지 않지만, 여기는 사람이 hub-om에서
        // 회차를 저장한 시점이다 — 잘못 지운 일정을 되살리는 길이 이것뿐이므로 다시 만든다
        // (2026-09-04 결정). 초대 메일은 insert라 다시 나간다. 매핑은 새 eventId로 갈아 끼운다.
        const recreatedId = await insertEvent(calendarId, plan.body);
        await saveCalendarEventLink({
          operationId: operation.operationId,
          calendarId,
          eventId: recreatedId,
          eventDate: plan.eventDate
        });
        console.info(
          `[gcal] ${operation.operationId} ${plan.eventDate} 이벤트가 캘린더에 없어 다시 만듦(hub-om 저장 시점) — event=${recreatedId}`
        );
        continue;
      }

      const eventId = await insertEvent(calendarId, plan.body);
      await saveCalendarEventLink({
        operationId: operation.operationId,
        calendarId,
        eventId,
        eventDate: plan.eventDate
      });
    }

    // 남은 매핑 = 교육일에서 빠진 날. 이벤트와 매핑을 함께 정리한다.
    for (const [eventDate, link] of sameCalendar) {
      await deleteEvent(link.calendarId, link.eventId);
      await deleteCalendarEventLink(operation.operationId, eventDate);
    }
  } catch (error) {
    console.error(`[gcal] ${operation.operationId} 반영 실패:`, error);
  }
}

/** 운영 생성. 교육일마다 일정을 만들고 담당·현장 OM을 초대한다. */
export function reflectOperationCreated(operation: OperationSession): Promise<void> {
  return reflectOperation(operation, "created");
}

/** 운영 수정. 이미 캘린더에 올라간 과정만 갱신한다. */
export function reflectOperationUpdated(operation: OperationSession): Promise<void> {
  return reflectOperation(operation, "updated");
}

/** 취소·삭제. 회차에 걸린 이벤트를 모두 지우고 매핑도 정리한다(스펙 D4). */
export async function reflectOperationDelete(operationId: string): Promise<void> {
  try {
    if (!isCalendarWriteEnabled()) return;

    const existing = await listCalendarEventLinks(operationId);
    if (existing.length === 0) return;

    for (const link of existing) {
      await deleteEvent(link.calendarId, link.eventId);
    }

    await deleteCalendarEventLinks(operationId);
  } catch (error) {
    console.error(`[gcal] ${operationId} 삭제 반영 실패:`, error);
  }
}
