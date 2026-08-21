// 운영현황 변경을 구글 캘린더에 반영한다(hub-om → 구글 단방향).
//
// 이 모듈의 함수는 절대 throw하지 않는다. 운영현황 저장은 이미 끝난 뒤에 불리는
// 부수작업이라, 구글이 죽었다고 저장을 되돌리거나 요청을 실패시키면 안 된다.
// (스펙 §6, src/app/api/om-request/route.ts의 부수작업 격리와 같은 방침)

import type { OperationSession } from "@/lib/data/operationTypes";
import { isCalendarWriteEnabled, resolvePartCalendarId } from "./calendarWriteConfig";
import { deleteEvent, insertEvent, patchEvent } from "./calendarWriteClient";
import { resolveCalendarTargets } from "./calendarParticipants";
import { buildCalendarEventBody } from "./operationCalendarEvent";
import {
  deleteCalendarEventLink,
  findCalendarEventLink,
  saveCalendarEventLink
} from "./calendarEventLinkRepository";

function logSkip(operationId: string, reason: string): void {
  console.warn(`[gcal] ${operationId} 반영 건너뜀: ${reason}`);
}

/** 생성·수정 공통. 매핑이 있으면 patch, 없으면 insert 후 매핑을 남긴다. */
export async function reflectOperationUpsert(operation: OperationSession): Promise<void> {
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

    const body = buildCalendarEventBody(operation, targets.attendeeEmails);
    const existing = await findCalendarEventLink(operation.operationId);

    // 담당 OM이 다른 파트로 바뀌면 캘린더가 달라진다. 옛 캘린더의 이벤트를 지우고 새로 만든다.
    if (existing && existing.calendarId !== calendarId) {
      await deleteEvent(existing.calendarId, existing.eventId);
      const eventId = await insertEvent(calendarId, body);
      await saveCalendarEventLink({ operationId: operation.operationId, calendarId, eventId });
      return;
    }

    if (existing) {
      await patchEvent(existing.calendarId, existing.eventId, body);
      return;
    }

    const eventId = await insertEvent(calendarId, body);
    await saveCalendarEventLink({ operationId: operation.operationId, calendarId, eventId });
  } catch (error) {
    console.error(`[gcal] ${operation.operationId} 반영 실패:`, error);
  }
}

/** 취소·삭제. 이벤트를 지우고 매핑도 정리한다(스펙 D4). */
export async function reflectOperationDelete(operationId: string): Promise<void> {
  try {
    if (!isCalendarWriteEnabled()) return;

    const existing = await findCalendarEventLink(operationId);
    if (!existing) return;

    await deleteEvent(existing.calendarId, existing.eventId);
    await deleteCalendarEventLink(operationId);
  } catch (error) {
    console.error(`[gcal] ${operationId} 삭제 반영 실패:`, error);
  }
}
