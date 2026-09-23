import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import type { CoachStatus } from "@prisma/client";
import type { CoachAdminRepository, CoachMasterKind, CoachMasterTag, DeletedCoach } from "./coachAdminRepository";
import { encodeMongoRuntimeDocument, mongoRuntimeSourceId } from "./mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongoCoachCatalogGuardReady, lockMongoCoachCatalog, prepareMongoCoachCatalogGuard } from "./mongoCoachCatalogGuard";
import { assertMongoCoachSchedulingGuardReady, lockMongoCoachScheduling, prepareMongoCoachSchedulingGuard } from "./mongoCoachSchedulingGuard";

/** Coach and every model that references it (schema Cascade), plus the SetNull reservation link. */
export const COACH_ADMIN_MODELS = [
  "Coach", "CoachPrivateProfile", "CoachField", "CoachFieldMaster", "CoachCurriculum", "CoachCurriculumMaster",
  "CoachContentEntry", "CoachPrivateAccessLog", "CoachSchedule", "CoachScheduleAccessLog", "CoachDayReservation",
  "CoachEngagement", "CoachEngagementSchedule", "ActivityChange"
] as const;
// Children deleted with the coach, in the order PostgreSQL would reach them through coach_id.
const COACH_CHILDREN = ["CoachEngagementSchedule", "CoachEngagement", "CoachDayReservation", "CoachSchedule", "CoachScheduleAccessLog", "CoachContentEntry", "CoachPrivateAccessLog", "CoachField", "CoachCurriculum", "CoachPrivateProfile"] as const;
// Tables without a PostgreSQL activity trigger keep no ActivityChange row on delete either.
const UNAUDITED = new Set(["CoachScheduleAccessLog", "CoachPrivateAccessLog"]);
type Options = MongoOperationOptions & { allowShadowWrites: true };
const masterModel = (kind: CoachMasterKind) => kind === "fields" ? "CoachFieldMaster" : "CoachCurriculumMaster";
const tag = (row: MongoRow): CoachMasterTag => ({ id: row.id as string, name: row.name as string });

export async function prepareMongoCoachAdminStore(options: Options): Promise<void> {
  await prepareMongoReadStore(options, COACH_ADMIN_MODELS);
  const store = new MongoOperationStore(options, COACH_ADMIN_MODELS);
  await prepareMongoCoachCatalogGuard(store, options.allowShadowWrites);
  await prepareMongoCoachSchedulingGuard(store, options.allowShadowWrites);
}

/** Explicit shadow backend for the tag-master and deleted-coach admin APIs. */
export class MongoCoachAdminRepository implements CoachAdminRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options): Promise<MongoCoachAdminRepository> {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, COACH_ADMIN_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoCoachCatalogGuardReady(store);
      await assertMongoCoachSchedulingGuardReady(store);
      return new MongoCoachAdminRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COACH_ADMIN_OPEN_FAILED");
    }
  }
  private async read<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.store.client.startSession();
    try { return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: 30_000 }); }
    catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_ADMIN_READ_FAILED"); }
    finally { await session.endSession(); }
  }
  /** Catalog lock first, like every other coach writer; a first-insert tag race retries the whole transaction. */
  private async write<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try { return await session.withTransaction(async () => { await lockMongoCoachCatalog(this.store, session); return work(session); }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 60_000 }); }
      catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
        if (error instanceof MongoOperationError) throw error;
        // Driver and codec failures can carry private values; expose only a fixed code.
        throw new MongoOperationError("COACH_ADMIN_WRITE_FAILED");
      } finally { await session.endSession(); }
    }
    throw new MongoOperationError("COACH_ADMIN_RETRY_LIMIT");
  }
  private async audit(model: string, before: MongoRow | null, after: MongoRow | null, session: ClientSession) {
    if (UNAUDITED.has(model)) return;
    const row = operationAuditRow(model, before, after);
    if (row) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", row), { session });
  }
  private async remove(model: string, row: MongoRow, session: ClientSession) {
    const result = await this.store.collection(model).deleteOne({ _id: mongoRuntimeSourceId(model, row) }, { session });
    assertMongo(result.deletedCount === 1, "COACH_ADMIN_ROW_DISAPPEARED");
    await this.audit(model, row, null, session);
  }
  async listMasters(kind: CoachMasterKind) {
    return this.read(async session => (await this.store.scan(masterModel(kind), {}, session)).map(tag).sort((a, b) => a.name.localeCompare(b.name, "ko")));
  }
  async ensureMaster(kind: CoachMasterKind, name: string) {
    const model = masterModel(kind);
    return this.write(async session => {
      const existing = await this.store.one(model, { name }, session);
      if (existing) return tag(existing);
      const row = completeMongoRow(model, { id: randomUUID(), name });
      await this.store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row), { session });
      await this.audit(model, null, row, session);
      return tag(row);
    });
  }
  async listDeletedCoaches(): Promise<DeletedCoach[]> {
    return this.read(async session => (await this.store.scan("Coach", { deletedAt: { $ne: null } }, session))
      .sort((a, b) => (b.deletedAt as Date).getTime() - (a.deletedAt as Date).getTime())
      .map(row => ({ id: row.id as string, name: row.name as string, workType: row.workType as string | null, status: row.status as CoachStatus, deletedAt: row.deletedAt as Date, deletedBy: row.deletedBy as string | null })));
  }
  async restoreCoach(input: string) {
    const id = input.toLowerCase(); // PostgreSQL UUID equality ignores case.
    return this.write(async session => {
      await lockMongoCoachScheduling(this.store, id, session);
      const previous = await this.store.one("Coach", { _id: id }, session);
      assertMongo(previous, "COACH_NOT_FOUND");
      const row = completeMongoRow("Coach", { ...previous, deletedAt: null, deletedBy: null, updatedAt: new Date() });
      const result = await this.store.collection("Coach").replaceOne({ _id: id }, encodeMongoRuntimeDocument("Coach", row), { session });
      assertMongo(result.matchedCount === 1, "COACH_ADMIN_ROW_DISAPPEARED");
      await this.audit("Coach", previous, row, session);
      return { id, name: row.name as string };
    });
  }
  async purgeDeletedCoach(input: string) {
    const id = input.toLowerCase();
    return this.write(async session => {
      await lockMongoCoachScheduling(this.store, id, session);
      const coach = await this.store.one("Coach", { _id: id }, session);
      if (!coach?.deletedAt) return false;
      const engagements = await this.store.scan("CoachEngagement", { coachId: id }, session);
      const engagementIds = engagements.map(row => row.id as string);
      // SetNull: reservations of other coaches keep their row but lose the confirmed link.
      for (const reservation of await this.store.scan("CoachDayReservation", { confirmedEngagementId: { $in: engagementIds }, coachId: { $ne: id } }, session)) {
        await lockMongoCoachScheduling(this.store, reservation.coachId as string, session);
        const row = completeMongoRow("CoachDayReservation", { ...reservation, confirmedEngagementId: null });
        const result = await this.store.collection("CoachDayReservation").replaceOne({ _id: reservation.id as string }, encodeMongoRuntimeDocument("CoachDayReservation", row), { session });
        assertMongo(result.matchedCount === 1, "COACH_ADMIN_ROW_DISAPPEARED");
        await this.audit("CoachDayReservation", reservation, row, session);
      }
      for (const model of COACH_CHILDREN) {
        // Unaudited access logs need no per-row history; delete them in one statement.
        if (UNAUDITED.has(model)) { await this.store.collection(model).deleteMany({ coachId: id }, { session }); continue; }
        const filter = model === "CoachEngagementSchedule" ? { $or: [{ coachId: id }, { engagementId: { $in: engagementIds } }] } : model === "CoachPrivateProfile" ? { _id: id } : { coachId: id };
        const rows = await this.store.scan(model, filter, session);
        // Another coach's slot on this coach's engagement: take that coach's guard like the SetNull branch.
        for (const other of [...new Set(rows.map(row => row.coachId as string).filter(coachId => coachId && coachId !== id))].sort()) await lockMongoCoachScheduling(this.store, other, session);
        for (const row of rows) await this.remove(model, row, session);
      }
      await this.remove("Coach", coach, session);
      return true;
    });
  }
}
