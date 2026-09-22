import { prepareMongoCoachSchedulingGuard, assertMongoCoachSchedulingGuardReady, lockMongoCoachScheduling } from "./mongoCoachSchedulingGuard";
import { randomUUID } from "node:crypto";
import { activityContext } from "../activity/context";
import { MongoServerError, type ClientSession, type IndexDescription } from "mongodb";
import type { CoachScheduleRepository, CoachScheduleEntry, CoachMonthSchedules, CoachManagerMonthSchedules, CoachDateReservation } from "./coachScheduleRepository";
import { parseMonthRange, parseDates, parseSchedules } from "../coaches/coachScheduleValidation";
import { MongoOperationStore, assertMongo, completeMongoRow, MongoOperationError, stableMongoValue, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore, assertMongoReadStoreReady } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { operationAuditRow } from "./mongoOperationAudit";

export const COACH_SCHEDULE_MODELS = ["Coach", "CoachSchedule", "CoachScheduleAccessLog", "CoachDayReservation", "CoachEngagement", "CoachEngagementSchedule", "ActivityChange"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
const activeIndex: IndexDescription = { name: "runtime_active_reservation", key: { coachId: 1, date: 1 }, unique: true, partialFilterExpression: { cancelledAt: null } };
const day = (value: unknown) => (value as Date).toISOString().slice(0, 10);
const instant = (value: unknown) => value instanceof Date ? value.toISOString() : null;
const scheduleDto = (row: MongoRow) => ({ id: row.id as string, date: day(row.date), startTime: row.startTime as string, endTime: row.endTime as string });
const bySchedule = (a: MongoRow, b: MongoRow) => (a.date as Date).getTime() - (b.date as Date).getTime() || String(a.startTime).localeCompare(String(b.startTime));
const nextTime = (previous: unknown) => new Date(Math.max(Date.now(), previous instanceof Date ? previous.getTime() + 1 : 0));

/** Explicit shadow setup. Existing duplicate active reservations fail index creation; never delete them. */
export async function prepareMongoCoachScheduleStore(options: Options): Promise<void> {
  await prepareMongoReadStore(options, COACH_SCHEDULE_MODELS);
  const store = new MongoOperationStore(options, COACH_SCHEDULE_MODELS);
  await store.collection("CoachDayReservation").createIndexes([activeIndex], { collation: { locale: "simple" } });
  await prepareMongoCoachSchedulingGuard(store, options.allowShadowWrites);
}

/** Internal shadow implementation. No environment variable selects this repository in production. */
export class MongoCoachScheduleRepository implements CoachScheduleRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options): Promise<MongoCoachScheduleRepository> {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, COACH_SCHEDULE_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo((hello.setName || hello.msg === "isdbgrid") && hello.logicalSessionTimeoutMinutes != null, "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoCoachSchedulingGuardReady(store);
      const index = (await store.collection("CoachDayReservation").listIndexes().toArray()).find(item => item.name === activeIndex.name);
      assertMongo(index && JSON.stringify(index.key) === JSON.stringify(activeIndex.key) && index.unique && !index.sparse && !index.hidden && (!index.collation || index.collation.locale === "simple") && stableMongoValue(index.partialFilterExpression) === stableMongoValue(activeIndex.partialFilterExpression), "ACTIVE_RESERVATION_INDEX_NOT_READY");
      return new MongoCoachScheduleRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_SCHEDULE_OPEN_FAILED"); }
  }
  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try { return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 }); }
      catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
        if (error instanceof MongoOperationError) throw error;
        throw new MongoOperationError("COACH_SCHEDULE_WRITE_FAILED");
      } finally { await session.endSession(); }
    }
    throw new MongoOperationError("COACH_SCHEDULE_RETRY_LIMIT");
  }
  private async audit(model: string, before: MongoRow | null, after: MongoRow | null, session: ClientSession) {
    if (model === "CoachScheduleAccessLog") return; // Excluded by activity/table-exclusions.json.
    const audit = operationAuditRow(model, before, after);
    if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
  }
  private async write(model: string, fields: MongoRow, before: MongoRow | null, session: ClientSession): Promise<MongoRow> {
    const row = completeMongoRow(model, fields), document = encodeMongoRuntimeDocument(model, row);
    if (before) {
      const result = await this.store.collection(model).replaceOne({ _id: document._id }, document, { session });
      assertMongo(result.matchedCount === 1, "COACH_SCHEDULE_ROW_DISAPPEARED");
    } else await this.store.collection(model).insertOne(document, { session });
    await this.audit(model, before, row, session);
    return row;
  }
  private range(yearMonth: string) {
    const range = parseMonthRange(yearMonth); assertMongo(range, "INVALID_COACH_MONTH"); return range;
  }
  private async coach(coachId: string, session: ClientSession) { return this.store.one("Coach", { _id: coachId, deletedAt: null }, session); }
  private async month(coachId: string, yearMonth: string, session: ClientSession) {
    const { start, end } = this.range(yearMonth), filter = { coachId, date: { $gte: start, $lte: end } };
    // A single session must not run operations concurrently.
    const schedules = (await this.store.scan("CoachSchedule", filter, session)).sort(bySchedule);
    const links = (await this.store.scan("CoachEngagementSchedule", { ...filter, cancelledAt: null }, session)).sort(bySchedule);
    const engagementRows = await this.store.scan("CoachEngagement", { _id: { $in: [...new Set(links.map(row => row.engagementId as string))] } }, session);
    const byId = new Map(engagementRows.map(row => [row.id, row]));
    const engagementSchedules = links.flatMap(row => {
      const engagement = byId.get(row.engagementId);
      assertMongo(engagement && engagement.coachId === coachId, "COACH_ENGAGEMENT_RELATION_MISSING");
      if (!["SCHEDULED", "IN_PROGRESS", "COMPLETED"].includes(engagement.status as string)) return [];
      const { date, startTime, endTime } = scheduleDto(row);
      return [{ date, startTime, endTime, courseName: engagement.courseName as string, status: String(engagement.status).toLowerCase() }];
    });
    const log = await this.store.one("CoachScheduleAccessLog", { coachId, yearMonth }, session);
    return { schedules, engagementSchedules, log };
  }
  async getCoachMonth(coachId: string, yearMonth: string): Promise<CoachMonthSchedules> {
    coachId = coachId.toLowerCase();
    const { start, end } = this.range(yearMonth);
    return this.transaction(async session => {
      await lockMongoCoachScheduling(this.store, coachId, session);
      assertMongo(await this.coach(coachId, session), "COACH_NOT_FOUND");
      const { schedules, engagementSchedules, log } = await this.month(coachId, yearMonth, session);
      const engagements = (await this.store.scan("CoachEngagement", { coachId, endDate: { $gte: start }, startDate: { $lte: end } }, session))
        .sort((a, b) => (a.startDate as Date).getTime() - (b.startDate as Date).getTime() || String(a.courseName).localeCompare(String(b.courseName)));
      const maximum = schedules.reduce<Date | null>((max, row) => !max || (row.updatedAt as Date) > max ? row.updatedAt as Date : max, null);
      await this.write("CoachScheduleAccessLog", { id: randomUUID(), coachId, yearMonth, ...log, accessedAt: nextTime(log?.accessedAt) }, log, session);
      return { schedules: schedules.map(scheduleDto), engagementSchedules,
        engagements: engagements.map(row => ({ id: row.id as string, courseName: row.courseName as string, startDate: day(row.startDate), endDate: day(row.endDate), startTime: row.startTime as string | null, endTime: row.endTime as string | null, status: String(row.status).toLowerCase() })),
        lastSavedAt: instant(log?.lastEditedAt) ?? instant(maximum) };
    });
  }
  async getManagerMonth(coachId: string, yearMonth: string): Promise<CoachManagerMonthSchedules | null> {
    coachId = coachId.toLowerCase(); this.range(yearMonth);
    return this.transaction(async session => {
      if (!await this.coach(coachId, session)) return null;
      const { schedules, engagementSchedules, log } = await this.month(coachId, yearMonth, session);
      return { schedules: schedules.map(scheduleDto), engagementSchedules,
        accessLog: log ? { yearMonth: log.yearMonth as string, accessedAt: (log.accessedAt as Date).toISOString(), lastEditedAt: instant(log.lastEditedAt) } : null };
    });
  }
  async replaceCoachMonth(coachId: string, yearMonth: string, entries: CoachScheduleEntry[]): Promise<void> {
    assertMongo(activityContext.getStore(), "ACTIVITY_CONTEXT_REQUIRED");
    coachId = coachId.toLowerCase(); const { start, end } = this.range(yearMonth);
    const parsed = parseSchedules(entries, yearMonth); assertMongo(parsed.ok, "INVALID_COACH_SCHEDULES");
    await this.transaction(async session => {
      await lockMongoCoachScheduling(this.store, coachId, session);
      assertMongo(await this.coach(coachId, session), "COACH_NOT_FOUND");
      const previous = await this.store.scan("CoachSchedule", { coachId, date: { $gte: start, $lte: end } }, session);
      const log = await this.store.one("CoachScheduleAccessLog", { coachId, yearMonth }, session);
      // Each successful PUT changes lastEditedAt even within the same millisecond. This
      // guarantees a write conflict for competing replacements of an already-empty month.
      const now = nextTime(log?.lastEditedAt);
      await this.store.collection("CoachSchedule").deleteMany({ coachId, date: { $gte: start, $lte: end } }, { session });
      for (const row of previous) await this.audit("CoachSchedule", row, null, session);
      for (const [index, entry] of parsed.value.entries()) {
        await this.write("CoachSchedule", { id: randomUUID(), sourceScheduleId: `hub:${coachId}:${yearMonth}:${index}:${entry.date}:${entry.startTime}:${entry.endTime}`, coachId, date: new Date(`${entry.date}T00:00:00.000Z`), startTime: entry.startTime, endTime: entry.endTime, updatedAt: now }, null, session);
      }
      await this.write("CoachScheduleAccessLog", { id: randomUUID(), coachId, yearMonth, accessedAt: now, ...log, lastEditedAt: now }, log, session);
    });
  }
  async reserveDates(coachId: string, dates: string[], author: { name: string; email: string }): Promise<CoachDateReservation[] | null> {
    assertMongo(activityContext.getStore(), "ACTIVITY_CONTEXT_REQUIRED");
    coachId = coachId.toLowerCase(); const parsed = parseDates(dates); assertMongo(parsed, "INVALID_COACH_DATES");
    return this.transaction(async session => {
      await lockMongoCoachScheduling(this.store, coachId, session);
      if (!await this.coach(coachId, session)) return null;
      const rows = await this.store.scan("CoachDayReservation", { coachId, date: { $in: parsed.map(value => new Date(`${value}T00:00:00.000Z`)) }, cancelledAt: null }, session);
      const byDate = new Map(rows.map(row => [day(row.date), row]));
      for (const value of parsed) {
        if (!byDate.has(value)) byDate.set(value, await this.write("CoachDayReservation", { id: randomUUID(), coachId, date: new Date(`${value}T00:00:00.000Z`), reservedByName: author.name, reservedByEmail: author.email, createdAt: new Date() }, null, session));
      }
      return parsed.map(value => { const row = byDate.get(value)!; return { date: value, reservedByName: row.reservedByName as string, reservedByEmail: row.reservedByEmail as string }; });
    });
  }
  async cancelDates(coachId: string, dates: string[], email: string): Promise<string[]> {
    assertMongo(activityContext.getStore(), "ACTIVITY_CONTEXT_REQUIRED");
    coachId = coachId.toLowerCase(); const parsed = parseDates(dates); assertMongo(parsed, "INVALID_COACH_DATES");
    return this.transaction(async session => {
      await lockMongoCoachScheduling(this.store, coachId, session);
      // Read full authenticated rows: a blind index alone cannot authorize cancellation.
      const rows = await this.store.scan("CoachDayReservation", { coachId, date: { $in: parsed.map(value => new Date(`${value}T00:00:00.000Z`)) }, cancelledAt: null }, session);
      const owned = rows.filter(row => row.reservedByEmail === email), now = new Date();
      for (const row of owned) await this.write("CoachDayReservation", { ...row, cancelledAt: now }, row, session);
      return owned.map(row => day(row.date));
    });
  }
}
