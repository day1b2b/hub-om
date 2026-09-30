import { getCalendarPersistence } from "./calendarPersistence";

export interface CalendarEventLink {
  operationId: string;
  calendarId: string;
  eventId: string;
  /** 이 이벤트가 담당하는 교육일(YYYY-MM-DD). */
  eventDate: string;
}


export async function listCalendarEventLinks(operationId: string): Promise<CalendarEventLink[]> {
  return getCalendarPersistence().listCalendarEventLinks(operationId);
}
export async function listAllCalendarEventLinks(): Promise<CalendarEventLink[]> {
  return getCalendarPersistence().listAllCalendarEventLinks();
}
export async function saveCalendarEventLink(link: CalendarEventLink): Promise<void> {
  return getCalendarPersistence().saveCalendarEventLink(link);
}
export async function deleteCalendarEventLink(operationId: string, eventDate: string): Promise<void> {
  return getCalendarPersistence().deleteCalendarEventLink(operationId, eventDate);
}
export async function deleteCalendarEventLinks(operationId: string): Promise<void> {
  return getCalendarPersistence().deleteCalendarEventLinks(operationId);
}
export async function moveCalendarEventLinkDate(link: CalendarEventLink, toDate: string): Promise<void> {
  return getCalendarPersistence().moveCalendarEventLinkDate(link, toDate);
}
export async function findCalendarEventLinksByCalendar(calendarId: string): Promise<Map<string, CalendarEventLink>> {
  return getCalendarPersistence().findCalendarEventLinksByCalendar(calendarId);
}
export async function deleteMatchingCalendarEventLink(link: CalendarEventLink): Promise<void> {
  return getCalendarPersistence().deleteMatchingCalendarEventLink(link);
}
