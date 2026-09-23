/** Synthetic coach graph shared by the PostgreSQL and Mongo permanent-delete parity tests. Test-only data. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const PURGE_IDS = { deleted: id(1), live: id(2), restorable: id(3), field: id(11), curriculum: id(12), deletedEngagement: id(21), liveEngagement: id(22), crossReservation: id(32) } as const;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
export const PURGE_PRIVATE_NAME = "가상영구삭제코치";

/** Insert order respects references. Values are logical (plaintext) rows. */
export const coachAdminPurgeRows: Array<[string, Record<string, unknown>[]]> = [
  ["Coach", [
    { id: PURGE_IDS.deleted, sourceCoachId: "synthetic:purge:deleted", name: PURGE_PRIVATE_NAME, normalizedName: PURGE_PRIVATE_NAME, deletedAt: new Date("2099-01-02T00:00:00.000Z"), deletedBy: "purge-admin@example.invalid" },
    { id: PURGE_IDS.live, sourceCoachId: "synthetic:purge:live", name: "가상유지코치", normalizedName: "가상유지코치", deletedAt: null, deletedBy: null },
    { id: PURGE_IDS.restorable, sourceCoachId: "synthetic:purge:restorable", name: "가상복원코치", normalizedName: "가상복원코치", deletedAt: new Date("2099-01-03T00:00:00.000Z"), deletedBy: "restore-admin@example.invalid" }
  ]],
  ["CoachFieldMaster", [{ id: PURGE_IDS.field, name: "나 분야" }, { id: id(13), name: "가 분야" }]],
  ["CoachCurriculumMaster", [{ id: PURGE_IDS.curriculum, name: "가 커리큘럼" }]],
  ["CoachPrivateProfile", [
    { coachId: PURGE_IDS.deleted, phone: "010-0000-1111", email: "purge-private@example.invalid" },
    { coachId: PURGE_IDS.live, phone: "010-0000-2222", email: "live-private@example.invalid" }
  ]],
  ["CoachField", [{ coachId: PURGE_IDS.deleted, tagId: PURGE_IDS.field }, { coachId: PURGE_IDS.live, tagId: PURGE_IDS.field }]],
  ["CoachCurriculum", [{ coachId: PURGE_IDS.deleted, tagId: PURGE_IDS.curriculum }]],
  ["CoachContentEntry", [{ id: id(41), coachId: PURGE_IDS.deleted, kind: "NOTE", content: "가상 메모" }]],
  ["CoachPrivateAccessLog", [{ id: id(42), coachId: PURGE_IDS.deleted, accessedByEmail: "reader@example.invalid", context: "coach_detail" }]],
  ["CoachSchedule", [
    { id: id(43), sourceScheduleId: "synthetic:purge:schedule:deleted", coachId: PURGE_IDS.deleted, date: day("2099-12-01"), startTime: "09:00", endTime: "18:00" },
    { id: id(44), sourceScheduleId: "synthetic:purge:schedule:live", coachId: PURGE_IDS.live, date: day("2099-12-01"), startTime: "09:00", endTime: "18:00" }
  ]],
  ["CoachScheduleAccessLog", [{ id: id(45), coachId: PURGE_IDS.deleted, yearMonth: "2099-12" }]],
  ["CoachEngagement", [
    { id: PURGE_IDS.deletedEngagement, sourceEngagementId: `synthetic:purge:${PURGE_PRIVATE_NAME}`, coachId: PURGE_IDS.deleted, courseName: "가상 과정", startDate: day("2099-12-10"), endDate: day("2099-12-11") },
    { id: PURGE_IDS.liveEngagement, sourceEngagementId: "synthetic:purge:live", coachId: PURGE_IDS.live, courseName: "가상 유지 과정", startDate: day("2099-12-10"), endDate: day("2099-12-11") }
  ]],
  ["CoachEngagementSchedule", [
    { id: id(51), sourceEngagementScheduleId: `synthetic:purge:${PURGE_PRIVATE_NAME}:0`, engagementId: PURGE_IDS.deletedEngagement, coachId: PURGE_IDS.deleted, date: day("2099-12-10"), startTime: "09:00", endTime: "18:00" },
    { id: id(52), sourceEngagementScheduleId: "synthetic:purge:live:0", engagementId: PURGE_IDS.liveEngagement, coachId: PURGE_IDS.live, date: day("2099-12-10"), startTime: "09:00", endTime: "18:00" }
  ]],
  ["CoachDayReservation", [
    { id: id(31), coachId: PURGE_IDS.deleted, date: day("2099-12-10"), reservedByEmail: "reserver@example.invalid", reservedByName: "가상 예약자", confirmedEngagementId: PURGE_IDS.deletedEngagement },
    { id: PURGE_IDS.crossReservation, coachId: PURGE_IDS.live, date: day("2099-12-10"), reservedByEmail: "reserver@example.invalid", reservedByName: "가상 예약자", confirmedEngagementId: PURGE_IDS.deletedEngagement }
  ]]
];

/** Row counts per model after permanently deleting PURGE_IDS.deleted (schema Cascade/SetNull). */
export const coachAdminPurgeExpected: Record<string, number> = {
  Coach: 2, CoachFieldMaster: 2, CoachCurriculumMaster: 1, CoachPrivateProfile: 1, CoachField: 1, CoachCurriculum: 0,
  CoachContentEntry: 0, CoachPrivateAccessLog: 0, CoachSchedule: 1, CoachScheduleAccessLog: 0, CoachEngagement: 1,
  CoachEngagementSchedule: 1, CoachDayReservation: 1
};
