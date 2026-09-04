// 설명·제목 일괄 갱신의 순수 규칙. 저장소를 끌어오지 않아 테스트에서 그대로 부를 수 있다.

import type { OperationSession } from "@/lib/data/operationTypes";
import type { CalendarEventLink } from "./calendarEventLinkRepository";
import { buildCalendarEventBodies } from "./operationCalendarEvent";

/** 매핑 하나에 쓸 제목·설명. 운영현황에 그 교육일 구간이 없으면 null(정방향 반영이 정리할 매핑). */
export function buildTextPatch(
  operation: OperationSession,
  link: Pick<CalendarEventLink, "eventDate">,
  partKey: string | null
): { summary: string; description: string } | null {
  const plan = buildCalendarEventBodies(operation, [], partKey).find((entry) => entry.eventDate === link.eventDate);
  if (!plan) return null;

  return { summary: plan.body.summary, description: plan.body.description ?? "" };
}
