import type { ClientSession } from "mongodb";
import type { CourseAdminLookup, CourseAdminRepository } from "./courseAdminRepository";
import { formatProcessId } from "./operationCalculations";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

export const COURSE_ADMIN_MODELS = ["Company", "Course", "OperationSession", "ActivityChange"] as const;
export type MongoCourseAdminOptions = MongoOperationOptions & { allowShadowWrites: true };

/** Explicit setup only. Normal open/read/write paths never create schema or guards. */
export async function prepareMongoCourseAdminStore(options: MongoCourseAdminOptions): Promise<void> {
  try { await prepareMongoReadStore(options, COURSE_ADMIN_MODELS); }
  catch (error) {
    if (error instanceof MongoOperationError) throw error;
    throw new MongoOperationError("COURSE_ADMIN_PREPARE_FAILED");
  }
}

// PostgreSQL UUID input permits optional braces and optional hyphens after each
// four hexadecimal digits; persisted Mongo IDs use canonical lower-case UUIDs.
function canonicalCourseId(value: string): string {
  assertMongo(typeof value === "string", "COURSE_ADMIN_INVALID_UUID");
  const text = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  assertMongo(/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(text), "COURSE_ADMIN_INVALID_UUID");
  const hex = text.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Explicit shadow implementation. Existing operation writers conflict on the
 * same session rows; driver retries re-read the entire snapshot. This does not
 * serialize future inserts or sessions moved into the course after the snapshot.
 */
export class MongoCourseAdminRepository implements CourseAdminRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: MongoCourseAdminOptions): Promise<MongoCourseAdminRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, COURSE_ADMIN_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoCourseAdminRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COURSE_ADMIN_OPEN_FAILED");
    }
  }

  private async transaction<T>(timeoutMS: number, work: (session: ClientSession, checkDeadline: () => void) => Promise<T>): Promise<T> {
    try {
      // Outside the callback: retries cannot reset the total 30s read/60s write
      // budget. Shared scan independently enforces its 15s/20k-row/32MiB limit.
      const deadline = performance.now() + timeoutMS;
      const checkDeadline = () => assertMongo(performance.now() < deadline, "COURSE_ADMIN_TIMEOUT");
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(async () => {
          checkDeadline();
          const result = await work(session, checkDeadline);
          checkDeadline();
          return result;
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS });
      } finally { await session.endSession(); }
    } catch (error) {
      // Sanitize after withTransaction so labeled conflicts retain driver retry
      // semantics. Session creation/cleanup and codec failures are covered too.
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COURSE_ADMIN_TRANSACTION_FAILED");
    }
  }

  async findCourse(processSeq: number): Promise<CourseAdminLookup | null> {
    assertMongo(Number.isInteger(processSeq) && processSeq >= -2147483648 && processSeq <= 2147483647, "COURSE_ADMIN_INVALID_PROCESS_SEQ");
    return this.transaction(30_000, async session => {
      const course = await this.store.one("Course", { processSeq }, session);
      if (!course) return null;
      const company = await this.store.one("Company", { _id: course.companyId as string }, session);
      assertMongo(company, "COURSE_ADMIN_MISSING_COMPANY");
      const sessions = await this.store.scan("OperationSession", { courseRecordId: course.id, deletedAt: null }, session);
      return {
        courseRecordId: course.id as string,
        processId: formatProcessId(course.processSeq as number),
        companyName: company.name as string,
        courseName: course.name as string,
        activeSessionCount: sessions.length
      };
    });
  }

  async softDeleteCourseSessions(courseId: string, deletedBy: string | null): Promise<number | null> {
    const id = canonicalCourseId(courseId);
    assertMongo(deletedBy === null || typeof deletedBy === "string", "COURSE_ADMIN_INVALID_ACTOR");
    return this.transaction(60_000, async (session, checkDeadline) => {
      const course = await this.store.one("Course", { _id: id }, session);
      if (!course) return null;
      const rows = await this.store.scan("OperationSession", { courseRecordId: id, deletedAt: null }, session);
      const now = new Date();
      let count = 0;
      for (const previous of rows) {
        checkDeadline();
        const next = completeMongoRow("OperationSession", { ...previous, deletedAt: now, deletedBy, updatedAt: now });
        const encoded = encodeMongoRuntimeDocument("OperationSession", next);
        // Full authenticated logical input for codec validation, but only these
        // four fields are persisted. Unrelated ciphertext stays byte-identical.
        const result = await this.store.collection("OperationSession").updateOne({
          _id: previous.id as string, courseRecordId: id, deletedAt: null
        }, { $set: {
          deletedAt: encoded.deletedAt, deletedBy: encoded.deletedBy,
          deletedByPiiIndex: encoded.deletedByPiiIndex, updatedAt: encoded.updatedAt
        } }, { session });
        assertMongo(result.matchedCount === 1, "COURSE_ADMIN_SESSION_DISAPPEARED");
        const audit = operationAuditRow("OperationSession", previous, next);
        if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
        count++;
      }
      return count;
    });
  }
}
