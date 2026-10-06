import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import { activityContext } from "../activity/context";
import type { CoachSheetSyncRepository, CoachSheetSyncTransaction, SheetSyncCoach, SheetEngagementMatch } from "./coachSheetSyncRepository";
import { MongoOperationStore, MongoOperationError, assertMongo, completeMongoRow, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongoCoachCatalogGuardReady, prepareMongoCoachCatalogGuard, lockMongoCoachCatalog } from "./mongoCoachCatalogGuard";
import { assertMongoCoachSchedulingGuardReady, prepareMongoCoachSchedulingGuard, lockMongoCoachScheduling } from "./mongoCoachSchedulingGuard";

export const COACH_SHEET_SYNC_MODELS = ["Coach", "CoachPrivateProfile", "CoachEngagement", "CoachEngagementSchedule", "CoachDayReservation", "ActivityChange"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
export async function prepareMongoCoachSheetSyncStore(options: Options) {
  await prepareMongoReadStore(options, COACH_SHEET_SYNC_MODELS);
  const store = new MongoOperationStore(options, COACH_SHEET_SYNC_MODELS);
  await prepareMongoCoachCatalogGuard(store, options.allowShadowWrites);
  await prepareMongoCoachSchedulingGuard(store, options.allowShadowWrites);
}
export class MongoCoachSheetSyncRepository implements CoachSheetSyncRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, COACH_SHEET_SYNC_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo((hello.setName || hello.msg === "isdbgrid") && hello.logicalSessionTimeoutMinutes != null, "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoCoachCatalogGuardReady(store);
      await assertMongoCoachSchedulingGuardReady(store);
      return new MongoCoachSheetSyncRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_SHEET_OPEN_FAILED"); }
  }
  private reader(session?: ClientSession) {
    const store = this.store;
    const coach = async (row: MongoRow, knownProfile?: MongoRow | null): Promise<SheetSyncCoach> => {
      const profile = knownProfile === undefined ? await store.one("CoachPrivateProfile", { _id: row.id as string }, session) : knownProfile;
      return { id: row.id as string, name: row.name as string, workType: row.workType as string | null,
        privateProfile: profile ? { employeeId: profile.employeeId as string | null, email: profile.email as string | null, phone: profile.phone as string | null } : null };
    };
    return {
      listLiveCoaches: async () => {
        const rows = await store.scan("Coach", { deletedAt: null }, session);
        const profiles = new Map((await store.scan("CoachPrivateProfile", { _id: { $in: rows.map(row => row.id as string) } }, session)).map(row => [row.coachId, row]));
        const result = []; for (const row of rows) result.push(await coach(row, profiles.get(row.id) ?? null)); return result;
      },
      findLiveCoachByName: async (name: string) => {
        const rows = (await store.findPrivateEqual("Coach", "name", name, session)).filter(row => row.deletedAt === null);
        const row = rows.at(-1); return row ? coach(row) : null;
      },
      getCoach: async (id: string) => { const row = await store.one("Coach", { _id: id, deletedAt: null }, session); return row ? coach(row) : null; },
      findMatchingEngagement: async (match: SheetEngagementMatch) => {
        // Randomized ciphertext never equals the source ID; look up by HMAC, then confirm the decrypted value.
        const sourceIndex = mongoRuntimeBlindIndex("CoachEngagement", "sourceEngagementId", match.sourceEngagementId);
        const row = await store.one("CoachEngagement", { $or: [{ sourceEngagementIdPiiIndex: sourceIndex }, { coachId: match.coachId, courseName: match.courseName, startDate: { $lte: match.endDate }, endDate: { $gte: match.startDate } }] }, session);
        if (!row) return null;
        const overlaps = row.coachId === match.coachId && row.courseName === match.courseName && (row.startDate as Date) <= match.endDate && (row.endDate as Date) >= match.startDate;
        assertMongo(row.sourceEngagementId === match.sourceEngagementId || overlaps, "PRIVATE_EQUALITY_MISMATCH");
        return { id: row.id as string, coachId: row.coachId as string };
      },
      listReservationCoachIdsForEngagements: async (ids: string[]) => [...new Set((await store.scan("CoachDayReservation", { confirmedEngagementId: { $in: ids } }, session)).map(row => row.coachId as string))],
      listEngagementsByCourseNames: async (names: string[]) => (await store.scan("CoachEngagement", { courseName: { $in: names } }, session)).map(row => ({ id: row.id as string, coachId: row.coachId as string }))
    };
  }
  private async read<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_SHEET_READ_FAILED"); }
  }
  listLiveCoaches() { return this.read(() => this.reader().listLiveCoaches()); }
  findLiveCoachByName(name: string) { return this.read(() => this.reader().findLiveCoachByName(name)); }
  getCoach(id: string) { return this.read(() => this.reader().getCoach(id)); }
  findMatchingEngagement(match: SheetEngagementMatch) { return this.read(() => this.reader().findMatchingEngagement(match)); }
  listReservationCoachIdsForEngagements(ids: string[]) { return this.read(() => this.reader().listReservationCoachIdsForEngagements(ids)); }
  listEngagementsByCourseNames(names: string[]) { return this.read(() => this.reader().listEngagementsByCourseNames(names)); }
  private async audit(model: string, before: MongoRow | null, after: MongoRow | null, session: ClientSession) {
    const row = operationAuditRow(model, before, after);
    if (row) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", row), { session });
  }
  private async write(model: string, fields: MongoRow, before: MongoRow | null, session: ClientSession) {
    const row = completeMongoRow(model, fields), document = encodeMongoRuntimeDocument(model, row);
    if (before) { const result = await this.store.collection(model).replaceOne({ _id: document._id }, document, { session }); assertMongo(result.matchedCount === 1, "COACH_SHEET_ROW_DISAPPEARED"); }
    else await this.store.collection(model).insertOne(document, { session });
    await this.audit(model, before, row, session); return row;
  }
  private port(session: ClientSession): CoachSheetSyncTransaction {
    const store = this.store, reader = this.reader(session), locked = new Set<string>();
    let writesStarted = false, locksTaken = false;
    const requireLock = (id: string) => { assertMongo(locked.has(id), "COACH_SHEET_LOCK_REQUIRED"); writesStarted = true; };
    const previous = async (model: string, id: string) => { const row = await store.one(model, { _id: id }, session); assertMongo(row, "COACH_SHEET_ROW_DISAPPEARED"); return row; };
    const remove = async (model: string, row: MongoRow) => { await store.collection(model).deleteOne({ _id: row.id as string }, { session }); await this.audit(model, row, null, session); };
    return { ...reader,
      lockCoaches: async ids => {
        assertMongo(!writesStarted && !locksTaken, "COACH_SHEET_LATE_LOCK"); locksTaken = true;
        for (const id of [...new Set(ids)].sort()) { await lockMongoCoachScheduling(store, id, session); locked.add(id); }
      },
      createCoach: async input => {
        requireLock(input.id); const now = new Date(), { privateProfile, ...fields } = input;
        await this.write("Coach", { ...fields, status: "ACTIVE", isActive: true, createdAt: now, updatedAt: now }, null, session);
        await this.write("CoachPrivateProfile", { coachId: input.id, ...privateProfile, createdAt: now, updatedAt: now }, null, session);
        return (await reader.getCoach(input.id))!;
      },
      patchCoach: async (id, patch) => { requireLock(id); const row = await previous("Coach", id); await this.write("Coach", { ...row, ...patch, updatedAt: new Date() }, row, session); },
      upsertPrivateProfile: async (id, create, patch) => {
        requireLock(id); const row = await store.one("CoachPrivateProfile", { _id: id }, session), now = new Date();
        await this.write("CoachPrivateProfile", row ? { ...row, ...patch, updatedAt: now } : { coachId: id, ...create, createdAt: now, updatedAt: now }, row, session);
      },
      createEngagement: async input => { requireLock(input.coachId); const id = randomUUID(); await this.write("CoachEngagement", { id, ...input, createdAt: new Date() }, null, session); return { id, coachId: input.coachId }; },
      patchEngagement: async (id, input) => { const row = await previous("CoachEngagement", id); requireLock(row.coachId as string); await this.write("CoachEngagement", { ...row, ...input }, row, session); },
      replaceSchedules: async (id, rows) => {
        const engagement = await previous("CoachEngagement", id); requireLock(engagement.coachId as string);
        for (const row of await store.scan("CoachEngagementSchedule", { engagementId: id }, session)) await remove("CoachEngagementSchedule", row);
        for (const row of rows) { requireLock(row.coachId); await this.write("CoachEngagementSchedule", { id: randomUUID(), ...row }, null, session); }
      },
      deleteEngagements: async ids => {
        for (const id of ids) {
          const engagement = await previous("CoachEngagement", id); requireLock(engagement.coachId as string);
          for (const row of await store.scan("CoachEngagementSchedule", { engagementId: id }, session)) await remove("CoachEngagementSchedule", row);
          for (const row of await store.scan("CoachDayReservation", { confirmedEngagementId: id }, session)) { requireLock(row.coachId as string); await this.write("CoachDayReservation", { ...row, confirmedEngagementId: null }, row, session); }
          await remove("CoachEngagement", engagement);
        }
      },
      cancelReservations: async entries => {
        for (const entry of entries) {
          requireLock(entry.coachId);
          for (const row of await store.scan("CoachDayReservation", { coachId: entry.coachId, date: entry.date, cancelledAt: null }, session))
            await this.write("CoachDayReservation", { ...row, cancelledAt: new Date(), confirmedEngagementId: entry.engagementId }, row, session);
        }
      }
    };
  }
  async transaction<T>(work: (tx: CoachSheetSyncTransaction) => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
    assertMongo(activityContext.getStore(), "ACTIVITY_CONTEXT_REQUIRED");
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try { return await session.withTransaction(async () => { await lockMongoCoachCatalog(this.store, session); return work(this.port(session)); }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: options?.timeoutMs ?? 30_000 }); }
      catch (error) { if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue; if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_SHEET_WRITE_FAILED"); }
      finally { await session.endSession(); }
    }
    throw new MongoOperationError("COACH_SHEET_RETRY_LIMIT");
  }
}
