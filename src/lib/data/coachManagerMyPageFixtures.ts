import type { MyActiveReservation, MyConfirmedCourse } from "./coachManagerMyPageRepository";
import { coachFixtureRow } from "./mongoCoachFixtures";
import type { MongoRow } from "./mongoOperationStore";

/** Synthetic PG/Mongo shared inputs; expected DTOs are fixed from bc77a12 coachMyPage.ts. */
export const MANAGER_EMAIL = "synthetic-manager@example.invalid";
export const OTHER_MANAGER_EMAIL = "synthetic-other@example.invalid";
export const MANAGER_NAME = "Alex Owner";
export const managerFixtureId = (n: number) => `bbbbbbbb-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const MY_PAGE_IDS = {
  a: managerFixtureId(1), b: managerFixtureId(2), deleted: managerFixtureId(3), other: managerFixtureId(4),
  oldRoster: managerFixtureId(11), roster: managerFixtureId(12), otherRoster: managerFixtureId(13),
  cross: managerFixtureId(21), named: managerFixtureId(22), completed: managerFixtureId(23), cancelled: managerFixtureId(24),
  substring: managerFixtureId(25), caseOnly: managerFixtureId(26), whitespaceOnly: managerFixtureId(27), oldName: managerFixtureId(28), otherEngagement: managerFixtureId(29), nullName: managerFixtureId(30),
  active: managerFixtureId(41), cancelledReservation: managerFixtureId(42), deletedCoachReservation: managerFixtureId(43), linked: managerFixtureId(44), duplicate: managerFixtureId(45), cancelledLink: managerFixtureId(46), upper: managerFixtureId(47), padded: managerFixtureId(48), otherReservation: managerFixtureId(49),
  firstSlot: managerFixtureId(61), lastSlot: managerFixtureId(62), cancelledSlot: managerFixtureId(63), namedSlot: managerFixtureId(64)
};
export const managerDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
export function coachManagerMyPageFixtures(): Map<string, MongoRow[]> {
  const data = new Map<string, MongoRow[]>();
  const add = (model: string, values: MongoRow) => {
    const row = coachFixtureRow(model, values);
    data.set(model, [...(data.get(model) ?? []), row]);
  };
  const i = MY_PAGE_IDS;
  for (const [id, name] of [[i.a, "가상 예약 코치"], [i.b, "가상 투입 코치"], [i.deleted, "가상 삭제 코치"], [i.other, "가상 다른 코치"]]) {
    add("Coach", { id, sourceCoachId: `manager-fixture-${id}`, name, normalizedName: name, status: "ACTIVE", deletedAt: id === i.deleted ? managerDay("2098-01-01") : null });
  }
  add("TeamUser", { id: i.oldRoster, name: "Old Owner", email: MANAGER_EMAIL, role: "OM", createdAt: managerDay("2098-01-01") });
  add("TeamUser", { id: i.roster, name: MANAGER_NAME, email: ` ${MANAGER_EMAIL.toUpperCase()} `, role: "LD", createdAt: managerDay("2098-02-01") });
  add("TeamUser", { id: i.otherRoster, name: "Other Manager", email: OTHER_MANAGER_EMAIL, role: null, createdAt: managerDay("2098-03-01") });
  const engagement = (id: string, coachId: string, courseName: string, start: string, end: string, status: string, extra: MongoRow = {}) => add("CoachEngagement", {
    id, sourceEngagementId: `manager-engagement-${id}`, coachId, courseName, startDate: managerDay(start), endDate: managerDay(end), status, hiredByText: MANAGER_NAME, ...extra
  });
  engagement(i.cross, i.b, "Shared synthetic course", "2099-01-10", "2099-01-20", "SCHEDULED", { rating: 0, feedback: "", rehire: false });
  engagement(i.named, i.b, "Shared synthetic course", "2099-01-05", "2099-01-25", "IN_PROGRESS", { rating: 5, feedback: "Synthetic private review", rehire: true, hiredByText: "Other / Alex Owner (lead)" });
  engagement(i.completed, i.deleted, "Later synthetic course", "2099-02-01", "2099-02-28", "COMPLETED", { hiredByText: "Alex Owner，Another [team]" });
  engagement(i.cancelled, i.a, "Earlier synthetic course", "2098-12-01", "2098-12-31", "CANCELLED");
  for (const [id, hiredByText] of [[i.substring, "Alex Owner Jr"], [i.caseOnly, "alex owner"], [i.whitespaceOnly, "Alex  Owner"], [i.oldName, "Old Owner"], [i.nullName, null]] as const) {
    engagement(id, i.a, `Excluded synthetic ${id}`, "2099-03-01", "2099-03-30", "SCHEDULED", { hiredByText });
  }
  engagement(i.otherEngagement, i.other, "Other manager only", "2099-04-01", "2099-04-30", "COMPLETED", { hiredByText: "Other Manager", feedback: "Other private review" });
  const reservation = (id: string, coachId: string, day: string, extra: MongoRow = {}) => add("CoachDayReservation", {
    id, coachId, date: managerDay(day), reservedByEmail: MANAGER_EMAIL, reservedByName: MANAGER_NAME, ...extra
  });
  reservation(i.active, i.a, "2099-01-03");
  reservation(i.cancelledReservation, i.a, "2099-01-02", { cancelledAt: managerDay("2098-12-01") });
  reservation(i.deletedCoachReservation, i.deleted, "2099-01-01");
  reservation(i.linked, i.a, "2099-01-10", { confirmedEngagementId: i.cross });
  reservation(i.duplicate, i.a, "2099-01-11", { confirmedEngagementId: i.cross, cancelledAt: managerDay("2098-12-01") });
  reservation(i.cancelledLink, i.a, "2099-01-12", { confirmedEngagementId: i.cancelled, cancelledAt: managerDay("2098-12-01") });
  reservation(i.upper, i.b, "2099-01-04", { reservedByEmail: MANAGER_EMAIL.toUpperCase() });
  reservation(i.padded, i.b, "2099-01-05", { reservedByEmail: ` ${MANAGER_EMAIL} ` });
  reservation(i.otherReservation, i.other, "2099-01-06", { reservedByEmail: OTHER_MANAGER_EMAIL, confirmedEngagementId: i.otherEngagement });
  for (const [id, engagementId, coachId, date, startTime, endTime, cancelledAt] of [
    [i.lastSlot, i.cross, i.b, "2099-01-18", "13:00", "15:00", null],
    [i.firstSlot, i.cross, i.other, "2099-01-12", "09:00", "10:00", null],
    [i.cancelledSlot, i.cross, i.b, "2099-01-11", "08:00", "18:00", managerDay("2098-01-01")],
    [i.namedSlot, i.named, i.b, "2099-01-30", "10:00", "12:00", null]
  ] as const) add("CoachEngagementSchedule", { id, sourceEngagementScheduleId: `manager-slot-${id}`, engagementId, coachId, date: managerDay(date), startTime, endTime, cancelledAt });
  return data;
}
export const expectedManagerReservations: MyActiveReservation[] = [
  { coachId: MY_PAGE_IDS.deleted, coachName: "가상 삭제 코치", date: "2099-01-01" },
  { coachId: MY_PAGE_IDS.a, coachName: "가상 예약 코치", date: "2099-01-03" },
  { coachId: MY_PAGE_IDS.a, coachName: "가상 예약 코치", date: "2099-01-10" }
];
export const expectedManagerCourses: MyConfirmedCourse[] = [
  { courseName: "Later synthetic course", startDate: "2099-02-01", endDate: "2099-02-28", coaches: [
    { coachId: MY_PAGE_IDS.deleted, coachName: "가상 삭제 코치", engagementId: MY_PAGE_IDS.completed, startDate: "2099-02-01", endDate: "2099-02-28", statusLabel: "완료", rating: null, feedback: null, rehire: null, rounds: [] }
  ] },
  { courseName: "Shared synthetic course", startDate: "2099-01-05", endDate: "2099-01-25", coaches: [
    { coachId: MY_PAGE_IDS.a, coachName: "가상 예약 코치", engagementId: MY_PAGE_IDS.cross, startDate: "2099-01-10", endDate: "2099-01-20", statusLabel: "예정", rating: 0, feedback: "", rehire: false, rounds: [
      { date: "2099-01-12", startTime: "09:00", endTime: "10:00" }, { date: "2099-01-18", startTime: "13:00", endTime: "15:00" }
    ] },
    { coachId: MY_PAGE_IDS.b, coachName: "가상 투입 코치", engagementId: MY_PAGE_IDS.named, startDate: "2099-01-05", endDate: "2099-01-25", statusLabel: "진행", rating: 5, feedback: "Synthetic private review", rehire: true, rounds: [{ date: "2099-01-30", startTime: "10:00", endTime: "12:00" }] }
  ] },
  { courseName: "Earlier synthetic course", startDate: "2098-12-01", endDate: "2098-12-31", coaches: [
    { coachId: MY_PAGE_IDS.a, coachName: "가상 예약 코치", engagementId: MY_PAGE_IDS.cancelled, startDate: "2098-12-01", endDate: "2098-12-31", statusLabel: "취소", rating: null, feedback: null, rehire: null, rounds: [] }
  ] }
];
/** Only unspecified coach ordering is normalized; all dates, labels and outer ordering are preserved. */
export const canonicalManagerCourses = (courses: MyConfirmedCourse[]) => courses.map(course => ({ ...course, coaches: [...course.coaches].sort((a, b) => a.engagementId.localeCompare(b.engagementId)) }));
