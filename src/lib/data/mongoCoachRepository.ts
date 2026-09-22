import type { Coach, CoachEngagement, CoachEngagementSchedule, CoachSchedule, CoachDayReservation, CoachdbArchiveSnapshot } from "@prisma/client";
import type { CoachRepository } from "./coachRepository";
import type { DateRange, CoachScheduleDashboard, CoachScheduleDashboardCoach } from "./coachTypes";
import { MongoOperationStore, assertMongo, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { COACH_READ_MODELS, assertMongoReadStoreReady } from "./mongoReadStore";
import { engagementStatus, coachDate, coachRangeDate, coachMonthRange, compareCoaches, compareEngagements, coachSummary, coachRead } from "./mongoCoachMapping";
import { buildSkillfloCoachUrl } from "../coaches/skillfloCoachUrl";
import { clearOverlappingPeriods, hasAvailability, subtractBitmap, toBitmap, toIntervals, type TimeInterval } from "./scheduleBitmap";

/** Parallel shadow reads only. Like the existing PG adapter, separate relation reads are not a single snapshot. */
export class MongoCoachRepository implements CoachRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoOperationOptions) {
    return coachRead(async () => {
    const store = new MongoOperationStore(options, COACH_READ_MODELS);
    await assertMongoReadStoreReady(store);
    return new MongoCoachRepository(store);
    });
  }
  private async tags(coachIds: string[], curriculum = false): Promise<Map<string, string[]>> {
    const links = await this.store.scan(curriculum ? "CoachCurriculum" : "CoachField", { coachId: { $in: coachIds } });
    const ids = [...new Set(links.map(row => row.tagId as string))];
    const masters = await this.store.scan(curriculum ? "CoachCurriculumMaster" : "CoachFieldMaster", { _id: { $in: ids } });
    const names = new Map(masters.map(row => [row.id, row.name as string]));
    const result = new Map<string, string[]>();
    for (const link of links) {
      assertMongo(names.has(link.tagId), "COACH_RELATION_MISSING");
      const owner = link.coachId as string;
      result.set(owner, [...(result.get(owner) ?? []), names.get(link.tagId)!]);
    }
    return result;
  }
  async listCoaches() {
    return coachRead(async () => {
      const coaches = (await this.store.scan("Coach", { deletedAt: null }) as unknown as Coach[]).sort(compareCoaches);
      const ids = coaches.map(row => row.id);
      const [fields, engagements, schedules] = await Promise.all([this.tags(ids), this.store.scan("CoachEngagement", { coachId: { $in: ids } }), this.store.scan("CoachEngagementSchedule", { coachId: { $in: ids }, cancelledAt: null })]);
      return coaches.map(coach => coachSummary(coach, fields.get(coach.id) ?? [], engagements.filter(row => row.coachId === coach.id) as unknown as CoachEngagement[], schedules.filter(row => row.coachId === coach.id) as unknown as CoachEngagementSchedule[]));
    });
  }
  async getCoachById(id: string) {
    return coachRead(async () => {
      const coach = await this.store.one("Coach", { _id: id }) as unknown as Coach | null;
      if (!coach) return null;
      const [fields, curriculums, engagements, schedules, archive] = await Promise.all([
        this.tags([id]), this.tags([id], true), this.store.scan("CoachEngagement", { coachId: id }),
        this.store.scan("CoachEngagementSchedule", { coachId: id, cancelledAt: null }), this.archive(coach.sourceCoachId)
      ]);
      return { ...coachSummary(coach, fields.get(id) ?? [], engagements as unknown as CoachEngagement[], schedules as unknown as CoachEngagementSchedule[]),
        curriculums: curriculums.get(id) ?? [], coachInputUrl: buildSkillfloCoachUrl(coach.accessToken),
        statusNote: coach.statusNote ?? stringOrNull(archive?.status_note),
        returnDate: coach.returnDate ? coachDate(coach.returnDate) : archiveDate(archive?.return_date),
        availabilityDetail: coach.availabilityDetail ?? stringOrNull(archive?.availability_detail),
        dxTag: coach.dxTag ?? stringOrNull(archive?.dx_tag) };
    });
  }
  private async archive(sourceCoachId: string): Promise<Record<string, unknown> | null> {
    const rows = (await this.store.findPrivateEqual("CoachdbArchiveRow", "rowKey", sourceCoachId)).filter(row => row.tableSchema === "public" && row.tableName === "coaches");
    if (!rows.length) return null;
    const snapshots = await this.store.scan("CoachdbArchiveSnapshot", { _id: { $in: rows.map(row => row.snapshotId as string) } }) as unknown as CoachdbArchiveSnapshot[];
    const byId = new Map(snapshots.map(row => [row.id, row]));
    for (const row of rows) assertMongo(byId.has(row.snapshotId as string), "COACH_RELATION_MISSING");
    const completed = rows.filter(row => byId.get(row.snapshotId as string)!.status === "completed")
      .sort((a, b) => byId.get(b.snapshotId as string)!.startedAt.getTime() - byId.get(a.snapshotId as string)!.startedAt.getTime());
    const data = completed[0]?.rowData;
    return data !== null && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  }
  async listEngagements(coachId: string) {
    return coachRead(async () => {
      const rows = await this.store.scan("CoachEngagement", { coachId }) as unknown as CoachEngagement[];
      return rows.sort(compareEngagements).map(row => ({ id: row.id, courseName: row.courseName, operationSessionId: row.operationSessionId,
        status: engagementStatus[row.status], source: row.source.toLowerCase(), startDate: coachDate(row.startDate), endDate: coachDate(row.endDate),
        startTime: row.startTime, endTime: row.endTime, rating: row.rating, rehire: row.rehire, feedback: row.feedback }));
    });
  }
  async listSchedules(coachId: string, range: DateRange) {
    return coachRead(async () => {
      const rows = await this.store.scan("CoachSchedule", { coachId, date: { $gte: coachRangeDate(range.from), $lte: coachRangeDate(range.to) } }) as unknown as CoachSchedule[];
      return rows.sort(compareSchedule).map(row => ({ id: row.id, date: coachDate(row.date), startTime: row.startTime, endTime: row.endTime }));
    });
  }
  async listEngagementSchedules(coachId: string, range: DateRange) {
    return coachRead(async () => {
      const rows = await this.store.scan("CoachEngagementSchedule", { coachId, cancelledAt: null, date: { $gte: coachRangeDate(range.from), $lte: coachRangeDate(range.to) } }) as unknown as CoachEngagementSchedule[];
      const engagements = await this.store.scan("CoachEngagement", { _id: { $in: [...new Set(rows.map(row => row.engagementId))] } });
      const byId = new Map(engagements.map(row => [row.id, row]));
      return rows.sort(compareSchedule).map(row => {
        assertMongo(byId.has(row.engagementId), "COACH_RELATION_MISSING");
        return { id: row.id, engagementId: row.engagementId, courseName: byId.get(row.engagementId)!.courseName as string, date: coachDate(row.date), startTime: row.startTime, endTime: row.endTime };
      });
    });
  }
  async getScheduleDashboard(yearMonth: string): Promise<CoachScheduleDashboard> {
    return coachRead(async () => {
      const [start, end] = coachMonthRange(yearMonth);
      const coaches = (await this.store.scan("Coach", { deletedAt: null, isActive: true, status: "ACTIVE" }) as unknown as Coach[]).sort(compareCoaches);
      const ids = coaches.map(row => row.id), filter = { coachId: { $in: ids }, date: { $gte: start, $lte: end } };
      const [fields, engagements, availability, schedules, reservations] = await Promise.all([
        this.tags(ids), this.store.scan("CoachEngagement", { coachId: { $in: ids } }), this.store.scan("CoachSchedule", filter),
        this.store.scan("CoachEngagementSchedule", { ...filter, cancelledAt: null }), this.store.scan("CoachDayReservation", { ...filter, cancelledAt: null })
      ]);
      const info = new Map(coaches.map(coach => {
        const all = (engagements.filter(row => row.coachId === coach.id) as unknown as CoachEngagement[]).sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
        return [coach.id, { id: coach.id, name: coach.name, workType: coach.workType, fields: fields.get(coach.id) ?? [], avgRating: null,
          recentEngagements: all.slice(0, 2).map(row => ({ courseName: row.courseName, endDate: coachDate(row.endDate) })), engagementCount: all.length }];
      }));
      // Busy status belongs to each schedule's actual engagement, even if it references another coach.
      const busyEngagements = await this.store.scan("CoachEngagement", { _id: { $in: [...new Set(schedules.map(row => row.engagementId as string))] } });
      const busyById = new Map(busyEngagements.map(row => [row.id, row]));
      const busyRows = schedules.filter(row => {
        assertMongo(busyById.has(row.engagementId), "COACH_RELATION_MISSING");
        return ["SCHEDULED", "IN_PROGRESS", "COMPLETED"].includes(busyById.get(row.engagementId)!.status as string);
      });
      const availabilityMap = intervalGroups(availability), busyMap = intervalGroups(busyRows);
      const reservationMap = new Map((reservations as unknown as CoachDayReservation[]).map(row => [`${row.coachId}|${coachDate(row.date)}`, { reservedByName: row.reservedByName, reservedByEmail: row.reservedByEmail }]));
      const days: CoachScheduleDashboard["days"] = {};
      for (const [date, byCoach] of availabilityMap) {
        const daily: CoachScheduleDashboardCoach[] = [];
        for (const [id, intervals] of byCoach) {
          const coach = info.get(id); if (!coach) continue;
          const busy = toBitmap(busyMap.get(date)?.get(id) ?? []);
          const remaining = clearOverlappingPeriods(subtractBitmap(toBitmap(intervals), busy), busy);
          if (hasAvailability(remaining)) daily.push({ ...coach, schedules: toIntervals(remaining), reservation: reservationMap.get(`${id}|${date}`) ?? null });
        }
        days[date] = { date, coaches: daily.sort((a,b) => b.engagementCount - a.engagementCount || a.name.localeCompare(b.name, "ko")) };
      }
      return { yearMonth, totalActiveCoaches: coaches.length, days };
    });
  }
}
function compareSchedule(a: { date: Date; startTime: string }, b: { date: Date; startTime: string }) { return a.date.getTime() - b.date.getTime() || a.startTime.localeCompare(b.startTime); }
function stringOrNull(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function archiveDate(value: unknown): string | null { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0,10) : null; }
function intervalGroups(rows: MongoRow[]) {
  const result = new Map<string, Map<string, TimeInterval[]>>();
  for (const row of [...rows].sort((a,b) => compareSchedule(a as unknown as CoachSchedule,b as unknown as CoachSchedule))) {
    const date = coachDate(row.date as Date), id = row.coachId as string;
    if (!result.has(date)) result.set(date,new Map());
    const byCoach = result.get(date)!;
    byCoach.set(id,[...(byCoach.get(id) ?? []),{startTime:row.startTime as string,endTime:row.endTime as string}]);
  }
  return result;
}
