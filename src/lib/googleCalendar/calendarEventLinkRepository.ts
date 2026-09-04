// 회차의 실제 교육일 1일 ↔ 구글 이벤트 1건 매핑 저장소.
//
// OperationSession에 컬럼을 붙이지 않고 별도 테이블로 둔 이유:
//  - 로컬 JSON 저장소(LocalJsonOperationRepository)까지 스키마를 맞출 필요가 없다.
//  - 연동을 껐다 켜도 운영 데이터가 오염되지 않는다.
//
// 교육일마다 이벤트를 따로 만들기 때문에 회차 하나에 여러 행이 생긴다.
// 실제 교육일이 없는 회차는 시작일 하나로 기간 이벤트 1건을 잡는다.

import { getPrismaClient } from "@/lib/data/prisma";

export interface CalendarEventLink {
  operationId: string;
  calendarId: string;
  eventId: string;
  /** 이 이벤트가 담당하는 교육일(YYYY-MM-DD). */
  eventDate: string;
}

function toDateOnly(eventDate: string): Date {
  return new Date(`${eventDate}T00:00:00Z`);
}

function toLink(row: { operationId: string; calendarId: string; eventId: string; eventDate: Date }): CalendarEventLink {
  return {
    operationId: row.operationId,
    calendarId: row.calendarId,
    eventId: row.eventId,
    eventDate: row.eventDate.toISOString().slice(0, 10)
  };
}

/** 회차에 걸린 이벤트 전부. 교육일 순으로 돌려준다. */
export async function listCalendarEventLinks(operationId: string): Promise<CalendarEventLink[]> {
  const rows = await getPrismaClient().calendarEventLink.findMany({
    where: { operationId },
    orderBy: { eventDate: "asc" }
  });

  return rows.map(toLink);
}

/** 매핑 전부(관리자 일괄 도구용). 회차·교육일 순. */
export async function listAllCalendarEventLinks(): Promise<CalendarEventLink[]> {
  const rows = await getPrismaClient().calendarEventLink.findMany({
    orderBy: [{ operationId: "asc" }, { eventDate: "asc" }]
  });

  return rows.map(toLink);
}

export async function saveCalendarEventLink(link: CalendarEventLink): Promise<void> {
  const eventDate = toDateOnly(link.eventDate);

  await getPrismaClient().calendarEventLink.upsert({
    where: { operationId_eventDate: { operationId: link.operationId, eventDate } },
    create: { operationId: link.operationId, calendarId: link.calendarId, eventId: link.eventId, eventDate },
    update: { calendarId: link.calendarId, eventId: link.eventId }
  });
}

/** 교육일 하나에 걸린 매핑만 지운다(교육일이 빠졌을 때). */
export async function deleteCalendarEventLink(operationId: string, eventDate: string): Promise<void> {
  await getPrismaClient().calendarEventLink.deleteMany({
    where: { operationId, eventDate: toDateOnly(eventDate) }
  });
}

/** 회차의 매핑 전부를 지운다(회차 취소·삭제). */
export async function deleteCalendarEventLinks(operationId: string): Promise<void> {
  await getPrismaClient().calendarEventLink.deleteMany({ where: { operationId } });
}

/**
 * 매핑의 교육일을 옮긴다. 담당 매니저가 캘린더에서 날짜를 바꿨을 때,
 * 같은 이벤트가 새 교육일을 담당하도록 키를 맞춘다.
 */
export async function moveCalendarEventLinkDate(
  operationId: string,
  fromDate: string,
  toDate: string
): Promise<void> {
  await getPrismaClient().calendarEventLink.updateMany({
    where: { operationId, eventDate: toDateOnly(fromDate) },
    data: { eventDate: toDateOnly(toDate) }
  });
}

/**
 * 캘린더 하나에 걸린 매핑을 eventId로 찾을 수 있게 돌려준다.
 * 역반영은 구글에서 읽은 이벤트가 어느 회차·교육일인지 거꾸로 찾아야 한다.
 */
export async function findCalendarEventLinksByCalendar(calendarId: string): Promise<Map<string, CalendarEventLink>> {
  const rows = await getPrismaClient().calendarEventLink.findMany({ where: { calendarId } });

  return new Map(rows.map((row) => [row.eventId, toLink(row)]));
}
