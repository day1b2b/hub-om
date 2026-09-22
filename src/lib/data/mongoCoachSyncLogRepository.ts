import { randomUUID } from "node:crypto";
import type { CoachSyncLogRepository, CoachSyncLogUpdate } from "./coachSyncLogRepository";
import { MongoOperationStore, MongoOperationError, assertMongo, completeMongoRow, type MongoOperationOptions } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
type Options = MongoOperationOptions & { allowShadowWrites: true };
const MODELS = ["CoachSyncLog"] as const;
export async function prepareMongoCoachSyncLogStore(options: Options) { await prepareMongoReadStore(options, MODELS); }
/** Sync run lifecycle is independent of individual business transactions, as in PostgreSQL. */
export class MongoCoachSyncLogRepository implements CoachSyncLogRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, MODELS);
    try { await assertMongoReadStoreReady(store); return new MongoCoachSyncLogRepository(store); }
    catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_SYNC_LOG_OPEN_FAILED"); }
  }
  async start(type: string, triggeredBy: string) {
    try {
      const id = randomUUID();
      const row = completeMongoRow("CoachSyncLog", { id, type, triggeredBy, status: "running", totalRows: 0, created: 0, updated: 0, skipped: 0, errors: 0, startedAt: new Date() });
      await this.store.collection("CoachSyncLog").insertOne(encodeMongoRuntimeDocument("CoachSyncLog", row), { writeConcern: { w: "majority", j: true } }); return { id };
    } catch { throw new MongoOperationError("COACH_SYNC_LOG_START_FAILED"); }
  }
  async finish(id: string, update: CoachSyncLogUpdate) {
    try {
      const before = await this.store.one("CoachSyncLog", { _id: id }); assertMongo(before, "COACH_SYNC_LOG_MISSING");
      const row = completeMongoRow("CoachSyncLog", { ...before, ...update });
      const result = await this.store.collection("CoachSyncLog").replaceOne({ _id: id }, encodeMongoRuntimeDocument("CoachSyncLog", row), { writeConcern: { w: "majority", j: true } });
      assertMongo(result.matchedCount === 1, "COACH_SYNC_LOG_MISSING");
    } catch { throw new MongoOperationError("COACH_SYNC_LOG_FINISH_FAILED"); }
  }
}
