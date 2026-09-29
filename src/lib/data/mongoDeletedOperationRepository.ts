import type { ClientSession } from "mongodb";
import type { DeletedOperationRepository, DeletedOperationRow } from "./deletedOperationRepository";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

export const DELETED_OPERATION_MODELS = ["Company", "Course", "OperationSession", "ActivityChange"] as const;
export type MongoDeletedOperationOptions = MongoOperationOptions & { allowShadowWrites: true };
const TRANSACTION_TIMEOUT_MS = 30_000;

/** Explicit shadow setup only. Opening and normal operations never perform DDL. */
export async function prepareMongoDeletedOperationStore(options: MongoDeletedOperationOptions): Promise<void> {
  try { await prepareMongoReadStore(options, DELETED_OPERATION_MODELS); }
  catch (error) {
    if (error instanceof MongoOperationError) throw error;
    throw new MongoOperationError("DELETED_OPERATION_PREPARE_FAILED");
  }
}

/** Explicit context selection only. Row conflicts with ordinary and course-admin
 * writers use driver transaction retry, re-reading each attempt's snapshot.
 */
export class MongoDeletedOperationRepository implements DeletedOperationRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: MongoDeletedOperationOptions): Promise<MongoDeletedOperationRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, DELETED_OPERATION_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoDeletedOperationRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("DELETED_OPERATION_OPEN_FAILED");
    }
  }

  private async transaction<T>(work: (session: ClientSession, checkDeadline: () => void) => Promise<T>): Promise<T> {
    try {
      // Outside the callback, so retries share the same total budget. Each shared
      // scan additionally enforces 15s, 20k rows and 32MiB over its 100-row pages.
      const deadline = performance.now() + TRANSACTION_TIMEOUT_MS;
      const checkDeadline = () => assertMongo(performance.now() < deadline, "DELETED_OPERATION_TIMEOUT");
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
      // Keep labeled driver errors intact until withTransaction finishes its
      // bounded retry. Codec, startSession and endSession errors are sanitized.
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("DELETED_OPERATION_TRANSACTION_FAILED");
    }
  }

  async listDeletedOperations(): Promise<DeletedOperationRow[]> {
    return this.transaction(async (session, checkDeadline) => {
      const rows = await this.store.scan("OperationSession", { deletedAt: { $ne: null } }, session);
      if (!rows.length) return [];
      checkDeadline();
      const courses = await this.store.scan("Course", {
        _id: { $in: [...new Set(rows.map(row => row.courseRecordId as string))] }
      }, session);
      checkDeadline();
      const companies = courses.length ? await this.store.scan("Company", {
        _id: { $in: [...new Set(courses.map(course => course.companyId as string))] }
      }, session) : [];
      const courseById = new Map(courses.map(course => [course.id, course]));
      const companyById = new Map(companies.map(company => [company.id, company]));
      // The original query specifies no tie-break for equal deletion timestamps.
      rows.sort((a, b) => (b.deletedAt as Date).getTime() - (a.deletedAt as Date).getTime());
      return rows.map(row => {
        checkDeadline();
        const course = courseById.get(row.courseRecordId);
        assertMongo(course, "DELETED_OPERATION_MISSING_COURSE");
        const company = companyById.get(course.companyId);
        assertMongo(company, "DELETED_OPERATION_MISSING_COMPANY");
        return {
          operationId: row.operationId as string,
          companyName: company.name as string,
          courseName: course.name as string,
          roundNo: row.roundNo as string | null,
          startDate: (row.startDate as Date).toISOString().slice(0, 10),
          endDate: (row.endDate as Date).toISOString().slice(0, 10),
          deletedAt: (row.deletedAt as Date | null)?.toISOString() ?? null,
          deletedBy: row.deletedBy as string | null
        };
      });
    });
  }

  async restoreOperation(operationId: string): Promise<{ operationId: string }> {
    // Empty/space/case-sensitive IDs are legal exact strings in the existing API.
    assertMongo(typeof operationId === "string", "DELETED_OPERATION_INVALID_ID");
    return this.transaction(async (session, checkDeadline) => {
      const previous = await this.store.one("OperationSession", { operationId }, session);
      assertMongo(previous, "DELETED_OPERATION_NOT_FOUND");
      checkDeadline();
      const next = completeMongoRow("OperationSession", {
        ...previous, deletedAt: null, deletedBy: null, updatedAt: new Date()
      });
      const encoded = encodeMongoRuntimeDocument("OperationSession", next);
      // Live and repeated restores still refresh updatedAt. Partial persistence
      // preserves every unrelated raw field and ciphertext, including relations.
      const result = await this.store.collection("OperationSession").updateOne({
        _id: previous.id as string, operationId
      }, { $set: {
        deletedAt: encoded.deletedAt, deletedBy: encoded.deletedBy,
        deletedByPiiIndex: encoded.deletedByPiiIndex, updatedAt: encoded.updatedAt
      } }, { session });
      assertMongo(result.matchedCount === 1, "DELETED_OPERATION_ROW_DISAPPEARED");
      checkDeadline();
      // Existing helper excludes updatedAt/deletedBy/companions, so replay and
      // deletedBy-only cleanup do not fabricate an audit; deleted->live restores do.
      const audit = operationAuditRow("OperationSession", previous, next);
      if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
      return { operationId: previous.operationId as string };
    });
  }
}
