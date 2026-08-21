// 운영 1건 ↔ 구글 이벤트 1건 매핑 저장소.
// OperationSession에 컬럼을 붙이지 않고 별도 테이블로 둔 이유:
//  - 로컬 JSON 저장소(LocalJsonOperationRepository)까지 스키마를 맞출 필요가 없다.
//  - 연동을 껐다 켜도 운영 데이터가 오염되지 않는다.

import { getPrismaClient } from "@/lib/data/prisma";

export interface CalendarEventLink {
  operationId: string;
  calendarId: string;
  eventId: string;
}

export async function findCalendarEventLink(operationId: string): Promise<CalendarEventLink | null> {
  const row = await getPrismaClient().calendarEventLink.findUnique({ where: { operationId } });
  if (!row) return null;

  return { operationId: row.operationId, calendarId: row.calendarId, eventId: row.eventId };
}

export async function saveCalendarEventLink(link: CalendarEventLink): Promise<void> {
  await getPrismaClient().calendarEventLink.upsert({
    where: { operationId: link.operationId },
    create: link,
    update: { calendarId: link.calendarId, eventId: link.eventId }
  });
}

export async function deleteCalendarEventLink(operationId: string): Promise<void> {
  await getPrismaClient().calendarEventLink.deleteMany({ where: { operationId } });
}
