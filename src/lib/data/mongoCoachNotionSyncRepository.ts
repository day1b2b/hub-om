import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import { activityContext } from "../activity/context";
import type { CoachNotionSyncRepository, CoachNotionSyncTransaction, NotionSyncCoach, NotionSyncPrivateProfile } from "./coachNotionSyncRepository";
import { MongoOperationStore, MongoOperationError, assertMongo, completeMongoRow, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { prepareMongoReadStore, assertMongoReadStoreReady } from "./mongoReadStore";
import { operationAuditRow } from "./mongoOperationAudit";
import { prepareMongoCoachCatalogGuard, assertMongoCoachCatalogGuardReady, lockMongoCoachCatalog } from "./mongoCoachCatalogGuard";
import { prepareMongoCoachSchedulingGuard, assertMongoCoachSchedulingGuardReady, lockMongoCoachScheduling } from "./mongoCoachSchedulingGuard";

export const COACH_NOTION_SYNC_MODELS = ["Coach", "CoachPrivateProfile", "CoachField", "CoachFieldMaster", "CoachCurriculum", "CoachCurriculumMaster", "ActivityChange"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
export async function prepareMongoCoachNotionSyncStore(options: Options) {
  await prepareMongoReadStore(options, COACH_NOTION_SYNC_MODELS);
  const store = new MongoOperationStore(options, COACH_NOTION_SYNC_MODELS);
  await prepareMongoCoachCatalogGuard(store, options.allowShadowWrites);
  await prepareMongoCoachSchedulingGuard(store, options.allowShadowWrites);
}
/** Uses existing identity semantics, including archived coaches; no source read runs in a transaction. */
export class MongoCoachNotionSyncRepository implements CoachNotionSyncRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, COACH_NOTION_SYNC_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo((hello.setName || hello.msg === "isdbgrid") && hello.logicalSessionTimeoutMinutes != null, "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoCoachCatalogGuardReady(store);
      await assertMongoCoachSchedulingGuardReady(store);
      return new MongoCoachNotionSyncRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_NOTION_OPEN_FAILED"); }
  }
  private async hydrate(rows: MongoRow[], session?: ClientSession): Promise<NotionSyncCoach[]> {
    if (!rows.length) return [];
    const ids = rows.map(row => row.id as string);
    const profiles = new Map((await this.store.scan("CoachPrivateProfile", { _id: { $in: ids } }, session)).map(row => [row.coachId, row]));
    const tags = async (model: "CoachField" | "CoachCurriculum") => {
      const links = await this.store.scan(model, { coachId: { $in: ids } }, session);
      const masters = new Map((await this.store.scan(`${model}Master`, { _id: { $in: [...new Set(links.map(row => row.tagId as string))] } }, session)).map(row => [row.id, row.name as string]));
      const byCoach = new Map<string, string[]>();
      for (const link of links) {
        const name = masters.get(link.tagId); assertMongo(name !== undefined, "COACH_NOTION_TAG_MISSING");
        const id = link.coachId as string; byCoach.set(id, [...(byCoach.get(id) ?? []), name]);
      }
      return byCoach;
    };
    const fields = await tags("CoachField"), curriculums = await tags("CoachCurriculum");
    return rows.map(row => {
      const id = row.id as string, profile = profiles.get(id);
      const privateProfile: NotionSyncPrivateProfile | null = profile ? { employeeId: profile.employeeId as string | null, phone: profile.phone as string | null,
        email: profile.email as string | null, birthDate: profile.birthDate as Date | null, affiliation: profile.affiliation as string | null } : null;
      return { id, name: row.name as string, normalizedName: row.normalizedName as string, createdAt: row.createdAt as Date,
        employeeNo: row.employeeNo as string | null, notionNo: row.notionNo as number | null, notionPageId: row.notionPageId as string | null,
        workType: row.workType as string | null, portfolioUrl: row.portfolioUrl as string | null, selfNote: row.selfNote as string | null,
        availabilityDetail: row.availabilityDetail as string | null, privateProfile, fields: fields.get(id) ?? [], curriculums: curriculums.get(id) ?? [] };
    });
  }
  private reader(session?: ClientSession) {
    return {
      findByNotionNo: async (notionNo: number) => {
        const row = await this.store.one("Coach", { notionNo }, session);
        return row ? (await this.hydrate([row], session))[0] : null;
      },
      listByNormalizedName: async (normalizedName: string) => {
        const rows = await this.store.findPrivateEqual("Coach", "normalizedName", normalizedName, session);
        // No new tie-breaker: the legacy query orders only by createdAt.
        rows.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
        return this.hydrate(rows, session);
      }
    };
  }
  private async read<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_NOTION_READ_FAILED"); }
  }
  findByNotionNo(notionNo: number) { return this.read(() => this.reader().findByNotionNo(notionNo)); }
  listByNormalizedName(name: string) { return this.read(() => this.reader().listByNormalizedName(name)); }
  private async audit(model: string, before: MongoRow | null, after: MongoRow | null, session: ClientSession) {
    const row = operationAuditRow(model, before, after);
    if (row) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", row), { session });
  }
  private async write(model: string, fields: MongoRow, before: MongoRow | null, session: ClientSession) {
    const row = completeMongoRow(model, fields), document = encodeMongoRuntimeDocument(model, row);
    if (before) {
      const result = await this.store.collection(model).replaceOne({ _id: document._id }, document, { session });
      assertMongo(result.matchedCount === 1, "COACH_NOTION_ROW_DISAPPEARED");
    } else await this.store.collection(model).insertOne(document, { session });
    await this.audit(model, before, row, session); return row;
  }
  private port(session: ClientSession): CoachNotionSyncTransaction {
    const store = this.store, locked = new Set<string>(); let writesStarted = false, locksTaken = false;
    const requireLock = (id: string) => { assertMongo(locked.has(id), "COACH_NOTION_LOCK_REQUIRED"); writesStarted = true; };
    return { ...this.reader(session),
      lockCoaches: async ids => {
        assertMongo(!writesStarted && !locksTaken, "COACH_NOTION_LATE_LOCK"); locksTaken = true;
        for (const id of [...new Set(ids)].sort()) { await lockMongoCoachScheduling(store, id, session); locked.add(id); }
      },
      createCoach: async input => { requireLock(input.id); const now = new Date(); await this.write("Coach", { ...input, status: "ACTIVE", isActive: true, createdAt: now, updatedAt: now }, null, session); },
      patchCoach: async (id, patch) => {
        requireLock(id); const before = await store.one("Coach", { _id: id }, session); assertMongo(before, "COACH_NOTION_ROW_DISAPPEARED");
        if (Object.keys(patch).length) await this.write("Coach", { ...before, ...patch, updatedAt: new Date() }, before, session);
      },
      upsertPrivateProfile: async (id, create, patch) => {
        requireLock(id); const before = await store.one("CoachPrivateProfile", { _id: id }, session), now = new Date();
        if (!before || Object.keys(patch).length) await this.write("CoachPrivateProfile", before ? { ...before, ...patch, updatedAt: now } : { coachId: id, ...create, createdAt: now, updatedAt: now }, before, session);
      },
      replaceTags: async (id, kind, names) => {
        requireLock(id); const model = kind === "fields" ? "CoachField" : "CoachCurriculum", master = `${model}Master`;
        const previous = await store.scan(model, { coachId: id }, session);
        await store.collection(model).deleteMany({ coachId: id }, { session });
        for (const row of previous) await this.audit(model, row, null, session);
        for (const name of names) {
          let tag = await store.one(master, { name }, session);
          if (!tag) tag = await this.write(master, { id: randomUUID(), name }, null, session);
          await this.write(model, { coachId: id, tagId: tag.id }, null, session);
        }
      }
    };
  }
  async transaction<T>(work: (tx: CoachNotionSyncTransaction) => Promise<T>): Promise<T> {
    assertMongo(activityContext.getStore(), "ACTIVITY_CONTEXT_REQUIRED");
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try { return await session.withTransaction(async () => { await lockMongoCoachCatalog(this.store, session); return work(this.port(session)); }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 }); }
      catch (error) { if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue; if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_NOTION_WRITE_FAILED"); }
      finally { await session.endSession(); }
    }
    throw new MongoOperationError("COACH_NOTION_RETRY_LIMIT");
  }
}
