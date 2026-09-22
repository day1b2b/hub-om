import { generateCoachAccessToken } from "../coaches/accessToken";
import type { CoachTokenRotationRepository } from "./coachTokenRotationRepository";
import { operationAuditRow } from "./mongoOperationAudit";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";

export const COACH_TOKEN_ROTATION_MODELS = ["Coach", "ActivityChange"] as const;
export type MongoCoachTokenRotationOptions = MongoOperationOptions & { allowShadowWrites: true };
export async function prepareMongoCoachTokenRotationStore(options: MongoCoachTokenRotationOptions): Promise<void> {
  await prepareMongoReadStore(options, COACH_TOKEN_ROTATION_MODELS);
}

/** Explicit shadow repository; no factory/environment automatically selects it. */
export class MongoCoachTokenRotationRepository implements CoachTokenRotationRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoCoachTokenRotationOptions): Promise<MongoCoachTokenRotationRepository> {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    try {
      const store = new MongoOperationStore(options, COACH_TOKEN_ROTATION_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoCoachTokenRotationRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COACH_TOKEN_ROTATION_OPEN_FAILED");
    }
  }
  private generateToken(): string { return generateCoachAccessToken(); }
  async regenerateToken(coachId: string): Promise<{ id: string; accessToken: string } | null> {
    const session = this.store.client.startSession();
    try {
      return await session.withTransaction(async () => {
        const previous = await this.store.one("Coach", { _id: coachId, deletedAt: null }, session);
        if (!previous) return null;
        const token = this.generateToken();
        const next = completeMongoRow("Coach", { ...previous, accessToken: token, updatedAt: new Date() });
        const result = await this.store.collection("Coach").replaceOne({ _id: coachId, deletedAt: null }, encodeMongoRuntimeDocument("Coach", next), { session });
        assertMongo(result.matchedCount === 1, "COACH_TOKEN_ROTATION_ROW_DISAPPEARED");
        const audit = operationAuditRow("Coach", previous, next);
        if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
        return { id: coachId, accessToken: token };
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      // Unique collisions and audit/codec failures must abort the whole transaction, without private details.
      throw new MongoOperationError("COACH_TOKEN_ROTATION_FAILED");
    } finally { await session.endSession(); }
  }
}
