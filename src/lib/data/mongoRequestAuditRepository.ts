import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import type { ActivityContext } from "../activity/context";
import type { CoachPrivateAccessLogRepository, RequestActivityRepository } from "./dataRepositoryContext";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { assertMongoCoachSchedulingGuardReady, lockMongoCoachScheduling, prepareMongoCoachSchedulingGuard } from "./mongoCoachSchedulingGuard";

export const REQUEST_AUDIT_MODELS = ["ActivityRequest", "ActivityChange", "Coach", "CoachPrivateAccessLog"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
export async function prepareMongoRequestAuditStore(options: Options): Promise<void> {
  await prepareMongoReadStore(options, REQUEST_AUDIT_MODELS);
  await prepareMongoCoachSchedulingGuard(new MongoOperationStore(options, REQUEST_AUDIT_MODELS), options.allowShadowWrites);
}

/** Explicit shadow backend. Request logs are best-effort at withActivity, whereas private access
 * logs must complete successfully before the private service returns data. */
export class MongoRequestAuditRepository implements RequestActivityRepository, CoachPrivateAccessLogRepository {
  private readonly store: MongoOperationStore;
  private lastPruned = 0;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options): Promise<MongoRequestAuditRepository> {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, REQUEST_AUDIT_MODELS);
    try {
      await assertMongoReadStoreReady(store);
      await assertMongoCoachSchedulingGuardReady(store);
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      return new MongoRequestAuditRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("AUDIT_OPEN_FAILED");
    }
  }
  async recordRequest(context: ActivityContext, status: number, durationMs: number): Promise<void> {
    try {
      const { requestId, ...actor } = context;
      const row = completeMongoRow("ActivityRequest", { ...actor, id: requestId, occurredAt: new Date(), status, durationMs });
      await this.store.collection("ActivityRequest").insertOne(encodeMongoRuntimeDocument("ActivityRequest", row));
    } catch { throw new MongoOperationError("REQUEST_AUDIT_FAILED"); }
    if (Date.now() - this.lastPruned > 3_600_000) {
      this.lastPruned = Date.now();
      try { await this.pruneActivityBatch(); }
      catch { console.error("[activity] retention cleanup failed"); }
    }
  }
  async recordAccess(coachId: string, accessedByEmail: string, context: string): Promise<void> {
    // A first guard upsert can race to 11000 without a transient label; restart the whole transaction.
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await this.recordAccessOnce(coachId, accessedByEmail, context); }
      catch (error) { if (!(error instanceof MongoServerError && error.code === 11000 && attempt < 4)) throw error; }
    }
    throw new MongoOperationError("PRIVATE_ACCESS_AUDIT_FAILED");
  }
  private async recordAccessOnce(coachId: string, accessedByEmail: string, context: string): Promise<void> {
    const session = this.store.client.startSession();
    try {
      await session.withTransaction(async () => {
        // Match the PG foreign key; deleted coaches still exist and are valid audit targets.
        assertMongo(await this.store.one("Coach", { _id: coachId }, session), "AUDIT_COACH_NOT_FOUND");
        // Writing the coach guard conflicts with a concurrent permanent delete, so no orphan log commits.
        await lockMongoCoachScheduling(this.store, coachId, session);
        const row = completeMongoRow("CoachPrivateAccessLog", { id: randomUUID(), coachId, accessedByEmail, accessedAt: new Date(), context });
        await this.store.collection("CoachPrivateAccessLog").insertOne(encodeMongoRuntimeDocument("CoachPrivateAccessLog", row), { session });
        // Coach writers (sheet/Notion sync) can hold this guard for up to 30s.
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
    } catch (error) {
      if (error instanceof MongoOperationError || (error instanceof MongoServerError && error.code === 11000)) throw error;
      throw new MongoOperationError("PRIVATE_ACCESS_AUDIT_FAILED");
    } finally { await session.endSession(); }
  }

  /** Same 30/365-day retention and <=1000 rows per model as the current PG implementation. */
  async pruneActivityBatch(): Promise<{ requests: number; changes: number }> {
    try {
      const prune = async (model: "ActivityRequest" | "ActivityChange", days: number) => {
        const collection = this.store.collection(model);
        const cutoff = new Date(Date.now() - days * 86_400_000);
        const rows = await collection.find({ occurredAt: { $lt: cutoff } }, { projection: { _id: 1 }, maxTimeMS: 1500 })
          .sort({ occurredAt: 1, _id: 1 }).limit(1000).toArray();
        if (!rows.length) return 0;
        return (await collection.deleteMany({ _id: { $in: rows.map(row => row._id) }, occurredAt: { $lt: cutoff } }, { maxTimeMS: 1500 })).deletedCount;
      };
      return { requests: await prune("ActivityRequest", 30), changes: await prune("ActivityChange", 365) };
    } catch { throw new MongoOperationError("AUDIT_RETENTION_FAILED"); }
  }
}
