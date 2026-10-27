import type { ClientSession, Filter } from "mongodb";
import type { OperationBackfillRepository } from "./operationBackfillRepository";
import { ASSIGNMENT_NEEDED_VALUES } from "./operationCalculations";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex, type MongoRuntimeDocument } from "./mongoRuntimeCodec";
import { countOmStatusBackfill, omStatusBackfillValue, type OmStatusBackfillCounts, type OmStatusBackfillValue } from "./omAssignmentStatusBackfillPlan";

// Course is read only: the archive judgement for an ended round needs its courseId.
export const OPERATION_BACKFILL_MODELS = ["OperationSession", "ActivityChange", "Course"] as const;
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

  /** Status each OM target gets; see omStatusBackfillValue. Onsite targets always get "Y". */
  private async omValues(rows: MongoRow[], session: ClientSession): Promise<OmStatusBackfillValue[]> {
    const courseRecordIds = [...new Set(rows.map(row => row.courseRecordId as string))];
    const courses = courseRecordIds.length ? await this.store.scan("Course", { _id: { $in: courseRecordIds } }, session) : [];
    const courseIds = new Map(courses.map(course => [course.id as string, course.courseId as string | null]));
    return rows.map(row => omStatusBackfillValue({
      endDate: row.endDate as Date, courseId: courseIds.get(row.courseRecordId as string),
      lectureManagementNote: row.lectureManagementNote as string | null, avgSatisfaction: row.avgSatisfaction as string | null,
      hasSatisfactionSurvey: row.hasSatisfactionSurvey as string, hasResultReport: row.hasResultReport as string,
      resultReportLink: row.resultReportLink as string | null
    }));
  }

  private async targets(kind: BackfillKind, session: ClientSession, checkDeadline: () => void): Promise<MongoRow[]> {
    const rows = await this.store.scan("OperationSession", this.targetFilter(kind), session);
    for (const row of rows) {
      checkDeadline();
      this.assertTarget(kind, row);
    }
    return rows;
  }

  private async run(kind: BackfillKind, apply: boolean): Promise<number> {
    return this.transaction(async (session, checkDeadline) => {
      const filter = this.targetFilter(kind);
      const rows = await this.targets(kind, session, checkDeadline);
      if (!apply || rows.length === 0) return rows.length;
      const field = kind === "onsite" ? "onsiteRequired" : "operationStatus";
      const values = kind === "onsite" ? rows.map(() => "Y") : await this.omValues(rows, session);
      const now = new Date();
      let updatedCount = 0;
      for (const [index, previous] of rows.entries()) {
        checkDeadline();
        const next = completeMongoRow("OperationSession", { ...previous, [field]: values[index], updatedAt: now });
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
  previewOmAssignmentStatusBackfill(): Promise<OmStatusBackfillCounts> {
    return this.transaction(async (session, checkDeadline) => countOmStatusBackfill(await this.omValues(await this.targets("om", session, checkDeadline), session)));
  }
  applyOmAssignmentStatusBackfill(): Promise<number> { return this.run("om", true); }
}
