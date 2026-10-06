import type { ClientSession, Filter } from "mongodb";
import type { OperationBackfillRepository } from "./operationBackfillRepository";
import { ASSIGNMENT_NEEDED_VALUES } from "./operationCalculations";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex, type MongoRuntimeDocument } from "./mongoRuntimeCodec";

export const OPERATION_BACKFILL_MODELS = ["OperationSession", "ActivityChange"] as const;
export type MongoOperationBackfillOptions = MongoOperationOptions & { allowShadowWrites: true };
const TRANSACTION_TIMEOUT_MS = 30_000;
const PLACEHOLDER_OM_VALUES = new Set(["", ...ASSIGNMENT_NEEDED_VALUES]);
type BackfillKind = "onsite" | "om";

/** Explicit shadow setup only; open and count/apply never perform DDL. */
export async function prepareMongoOperationBackfillStore(options: MongoOperationBackfillOptions): Promise<void> {
  try { await prepareMongoReadStore(options, OPERATION_BACKFILL_MODELS); }
  catch (error) {
    if (error instanceof MongoOperationError) throw error;
    throw new MongoOperationError("OPERATION_BACKFILL_PREPARE_FAILED");
  }
}

/** Narrow administrator repairs, deliberately independent of updateOperation's
 * derived status/onsiteText changes. Each call observes its own snapshot.
 */
export class MongoOperationBackfillRepository implements OperationBackfillRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: MongoOperationBackfillOptions): Promise<MongoOperationBackfillRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, OPERATION_BACKFILL_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoOperationBackfillRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("OPERATION_BACKFILL_OPEN_FAILED");
    }
  }

  private async transaction<T>(work: (session: ClientSession, checkDeadline: () => void) => Promise<T>): Promise<T> {
    try {
      // Keep one deadline across every driver retry; scan also independently
      // enforces 15s/20k rows/32MiB with 100-row single-batch keyset pages.
      const deadline = performance.now() + TRANSACTION_TIMEOUT_MS;
      const checkDeadline = () => assertMongo(performance.now() < deadline, "OPERATION_BACKFILL_TIMEOUT");
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(async () => {
          checkDeadline();
          const result = await work(session, checkDeadline);
          checkDeadline();
          return result;
        }, {
          readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true },
          readPreference: "primary", timeoutMS: TRANSACTION_TIMEOUT_MS
        });
      } finally { await session.endSession(); }
    } catch (error) {
      // Sanitize only after driver retry handling; include codec and session
      // creation/cleanup failures without leaking their original messages.
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("OPERATION_BACKFILL_TRANSACTION_FAILED");
    }
  }

  private targetFilter(kind: BackfillKind): Filter<MongoRuntimeDocument> {
    if (kind === "onsite") return { deletedAt: null, onsiteRequired: { $ne: "Y" } };
    return {
      deletedAt: null,
      operationStatus: "ASSIGNMENT_NEEDED",
      omNamePiiIndex: {
        $ne: null,
        $nin: [...PLACEHOLDER_OM_VALUES].map(value => mongoRuntimeBlindIndex("OperationSession", "omName", value))
      }
    };
  }

  private assertTarget(kind: BackfillKind, row: MongoRow): void {
    assertMongo(row.deletedAt === null, "OPERATION_BACKFILL_TARGET_MISMATCH");
    if (kind === "onsite") {
      assertMongo(row.onsiteRequired === "N" || row.onsiteRequired === "PARTIAL" || row.onsiteRequired === "UNKNOWN", "OPERATION_BACKFILL_TARGET_MISMATCH");
    } else {
      // Shared scan authenticates ciphertext and its HMAC before this exact
      // plaintext predicate. Whitespace/padded placeholders remain eligible.
      // Documents excluded by the index are not an exhaustive corruption audit.
      assertMongo(row.operationStatus === "ASSIGNMENT_NEEDED" && typeof row.omName === "string" && !PLACEHOLDER_OM_VALUES.has(row.omName), "OPERATION_BACKFILL_TARGET_MISMATCH");
    }
  }

  private async run(kind: BackfillKind, apply: boolean): Promise<number> {
    return this.transaction(async (session, checkDeadline) => {
      const filter = this.targetFilter(kind);
      const rows = await this.store.scan("OperationSession", filter, session);
      for (const row of rows) {
        checkDeadline();
        this.assertTarget(kind, row);
      }
      if (!apply || rows.length === 0) return rows.length;
      const field = kind === "onsite" ? "onsiteRequired" : "operationStatus";
      const value = kind === "onsite" ? "Y" : "ASSIGNMENT_PLANNED";
      const now = new Date();
      let updatedCount = 0;
      for (const previous of rows) {
        checkDeadline();
        const next = completeMongoRow("OperationSession", { ...previous, [field]: value, updatedAt: now });
        const encoded = encodeMongoRuntimeDocument("OperationSession", next);
        // Validate a complete logical row, but persist only the repaired field
        // and timestamp. Preserve unrelated ciphertext, onsiteText and updatedBy.
        const result = await this.store.collection("OperationSession").updateOne({
          ...filter, _id: previous.id as string
        }, { $set: { [field]: encoded[field], updatedAt: encoded.updatedAt } }, { session });
        assertMongo(result.matchedCount === 1, "OPERATION_BACKFILL_ROW_DISAPPEARED");
        checkDeadline();
        const audit = operationAuditRow("OperationSession", previous, next);
        if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
        updatedCount++;
      }
      return updatedCount;
    });
  }

  countOnsiteRequiredTargets(): Promise<number> { return this.run("onsite", false); }
  applyOnsiteRequiredBackfill(): Promise<number> { return this.run("onsite", true); }
  countOmAssignmentStatusTargets(): Promise<number> { return this.run("om", false); }
  applyOmAssignmentStatusBackfill(): Promise<number> { return this.run("om", true); }
}
