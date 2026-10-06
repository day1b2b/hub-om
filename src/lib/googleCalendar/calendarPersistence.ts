import type { CalendarEventLink } from "./calendarEventLinkRepository";
import { getDataRepositoryOverride } from "../data/dataRepositoryContext";
import * as prisma from "./prismaCalendarPersistence";

export interface CalendarPersistence {
  listCalendarEventLinks(operationId: string): Promise<CalendarEventLink[]>;
  listAllCalendarEventLinks(): Promise<CalendarEventLink[]>;
  saveCalendarEventLink(link: CalendarEventLink): Promise<void>;
  deleteCalendarEventLink(operationId: string, eventDate: string): Promise<void>;
  deleteCalendarEventLinks(operationId: string): Promise<void>;
  moveCalendarEventLinkDate(link: CalendarEventLink, toDate: string): Promise<void>;
  findCalendarEventLinksByCalendar(calendarId: string): Promise<Map<string, CalendarEventLink>>;
  deleteMatchingCalendarEventLink(link: CalendarEventLink): Promise<void>;
  findOperationUpdatedAt(operationIds: string[]): Promise<Map<string, Date>>;
}
export interface CalendarLockHandle {
  readonly signal: AbortSignal;
  assertActive(): Promise<void>;
}
export interface CalendarLockPort {
  withLock<T>(operationId: string, work: (handle: CalendarLockHandle) => Promise<T>): Promise<T>;
}
export function getCalendarPersistence(): CalendarPersistence {
  return getDataRepositoryOverride("calendarPersistence") ?? prisma;
}
