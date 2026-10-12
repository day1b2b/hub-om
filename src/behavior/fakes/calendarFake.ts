// 기획서 테스트용 Google Calendar 가짜. 실제 Google·DB 대신 메모리에 일정 연결을 두고,
// 실제 reflectOperationToCalendar 로직은 그대로 실행되게 경계 모듈만 바꾼다.
import { mock } from "node:test";

export interface FakeCalendarLink { operationId: string; calendarId: string; eventId: string; eventDate: string }

export const calendar = {
  links: [] as FakeCalendarLink[],
  removedEvents: [] as string[],
  failDelete: false,
  reset() { this.links = []; this.removedEvents = []; this.failDelete = false; },
  addEvent(operationId: string) { this.links.push({ operationId, calendarId: "fake-calendar", eventId: `event-${operationId}`, eventDate: "2026-10-12" }); },
  eventsOf(operationId: string) { return this.links.filter((link) => link.operationId === operationId).map((link) => link.eventId); }
};

// 실제 모듈의 나머지 export는 그대로 두고, 외부와 닿는 함수만 바꾼다(다른 모듈이 import하는 이름이 빠지지 않게).
async function replace(specifier: string, overrides: Record<string, unknown>) {
  const real = await import(specifier) as Record<string, unknown>;
  mock.module(specifier, { namedExports: { ...real, ...overrides } });
}

export async function installCalendarFake() {
  await replace("@/lib/googleCalendar/calendarOperationLock", {
    calendarLockSignal: () => undefined,
    withCalendarOperationLock: async (_id: string, run: () => Promise<unknown>) => run(),
    assertCalendarLockActive: async () => {},
    isCalendarReflectionSuppressed: () => false,
    withoutCalendarReflection: (run: () => Promise<unknown>) => run()
  });
  await replace("@/lib/googleCalendar/calendarWriteConfig", {
    isCalendarWriteEnabled: () => true, resolvePartCalendarId: () => "fake-calendar"
  });
  await replace("@/lib/googleCalendar/calendarWriteClient", {
    insertOperationEvent: async () => "fake-new-event", patchEvent: async () => "updated",
    readEventAttendees: async () => [],
    deleteEvent: async (_calendarId: string, eventId: string) => {
      if (calendar.failDelete) throw new Error("simulated Google Calendar failure");
      calendar.removedEvents.push(eventId);
    }
  });
  await replace("@/lib/googleCalendar/calendarEventLinkRepository", {
    listCalendarEventLinks: async (operationId: string) => calendar.links.filter((link) => link.operationId === operationId),
    listAllCalendarEventLinks: async () => [...calendar.links],
    saveCalendarEventLink: async (link: FakeCalendarLink) => { calendar.links.push(link); },
    deleteMatchingCalendarEventLink: async (link: FakeCalendarLink) => { calendar.links = calendar.links.filter((item) => item.eventId !== link.eventId); }
  });
}
