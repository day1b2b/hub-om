import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { assertMongoCoachSchedulingGuardReady, lockMongoCoachScheduling, prepareMongoCoachSchedulingGuard } from "./mongoCoachSchedulingGuard";
import type { CoachExportRepository, CoachExportType, CoachExportRow } from "./coachExportRepository";
import { MongoOperationStore, MongoOperationError, assertMongo, completeMongoRow, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
export const COACH_EXPORT_MODELS = ["Coach", "CoachPrivateProfile", "CoachPrivateAccessLog"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
export async function prepareMongoCoachExportStore(options: Options) {
  await prepareMongoReadStore(options, COACH_EXPORT_MODELS);
  await prepareMongoCoachSchedulingGuard(new MongoOperationStore(options, COACH_EXPORT_MODELS), options.allowShadowWrites);
}
export class MongoCoachExportRepository implements CoachExportRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, COACH_EXPORT_MODELS);
    try {
      await assertMongoReadStoreReady(store);
      await assertMongoCoachSchedulingGuardReady(store);
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      return new MongoCoachExportRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COACH_EXPORT_OPEN_FAILED");
    }
  }
  async exportCoaches(ids: string[], type: CoachExportType, actorEmail: string): Promise<CoachExportRow[]> {
    // A first guard upsert can race to 11000 without a transient label; restart the whole transaction.
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await this.exportOnce(ids, type, actorEmail); }
      catch (error) { if (!(error instanceof MongoServerError && error.code === 11000 && attempt < 4)) throw error; }
    }
    throw new MongoOperationError("COACH_EXPORT_FAILED");
  }
  private async exportOnce(ids: string[], type: CoachExportType, actorEmail: string): Promise<CoachExportRow[]> {
    const session = this.store.client.startSession();
    try {
      return await session.withTransaction(async () => {
        const coaches = await this.store.scan("Coach", { _id: { $in: [...new Set(ids)] }, deletedAt: null }, session);
        // Guard writes conflict with a concurrent delete/permanent delete, so no orphan access log commits.
        for (const id of coaches.map(coach => coach.id as string).sort()) await lockMongoCoachScheduling(this.store, id, session);
        coaches.sort((a,b) => String(a.normalizedName).localeCompare(String(b.normalizedName), "ko"));
        // Commit every access record before returning any export. A later insertion failure
        // aborts earlier records too; private profiles are not read until auditing succeeds.
        for (const coach of coaches) {
          const log = completeMongoRow("CoachPrivateAccessLog", { id: randomUUID(), coachId: coach.id, accessedByEmail: actorEmail, accessedAt: new Date(), context: `coach_export:${type}` });
          await this.store.collection("CoachPrivateAccessLog").insertOne(encodeMongoRuntimeDocument("CoachPrivateAccessLog", log), { session });
        }
        const profiles = await this.store.scan("CoachPrivateProfile", { _id: { $in: coaches.map(coach => coach.id as string) } }, session);
        const byId = new Map(profiles.map(profile => [profile.coachId, profile]));
        return coaches.map(coach => {
          const profile = byId.get(coach.id);
          return { id: coach.id as string, name: coach.name as string, accessToken: coach.accessToken as string | null,
            privateProfile: profile ? { phone: profile.phone as string | null, email: profile.email as string | null } : null };
        });
      }, { readConcern: { level: "snapshot" }, readPreference: "primary", writeConcern: { w: "majority", j: true }, timeoutMS: 30_000 });
    } catch (error) {
      if (error instanceof MongoOperationError || (error instanceof MongoServerError && error.code === 11000)) throw error;
      throw new MongoOperationError("COACH_EXPORT_FAILED");
    } finally { await session.endSession(); }
  }
}
