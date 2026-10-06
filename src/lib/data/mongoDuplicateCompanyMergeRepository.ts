import { MongoServerError, type ClientSession } from "mongodb";
import { DuplicateCompanyMergeError, type DuplicateCompanyMergeRepository, type DuplicateCompanyMergeResult } from "./duplicateCompanyMergeRepository";
import { assertMongoCourseNameRestoreGuardReady, lockMongoCourseNameRestore, prepareMongoCourseNameRestoreGuard } from "./mongoCourseNameRestoreGuard";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

export const DUPLICATE_COMPANY_MERGE_MODELS = ["Company", "Course", "CourseIdLabel", "OperationSession"] as const;
export type MongoDuplicateCompanyMergeOptions = MongoOperationOptions & { allowShadowWrites: true };
const TIMEOUT_MS = 30_000;

export async function prepareMongoDuplicateCompanyMergeStore(options: MongoDuplicateCompanyMergeOptions): Promise<void> {
  try {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    await prepareMongoReadStore(options, DUPLICATE_COMPANY_MERGE_MODELS);
    const store = new MongoOperationStore(options, DUPLICATE_COMPANY_MERGE_MODELS);
    await prepareMongoCourseNameRestoreGuard(store, options.allowShadowWrites);
  } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("DUPLICATE_COMPANY_MERGE_PREPARE_FAILED"); }
}

export class MongoDuplicateCompanyMergeRepository implements DuplicateCompanyMergeRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoDuplicateCompanyMergeOptions) {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, DUPLICATE_COMPANY_MERGE_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store); await assertMongoCourseNameRestoreGuardReady(store);
      return new MongoDuplicateCompanyMergeRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("DUPLICATE_COMPANY_MERGE_OPEN_FAILED"); }
  }
  private async execute(input: { sourceName: string; targetName: string; apply: boolean }, session: ClientSession): Promise<DuplicateCompanyMergeResult> {
    const sources = await this.store.scan("Company", { name: input.sourceName }, session);
    const targets = await this.store.scan("Company", { name: input.targetName }, session);
    if (sources.length !== 1) throw new DuplicateCompanyMergeError("SOURCE_NOT_UNIQUE");
    if (targets.length !== 1) throw new DuplicateCompanyMergeError("TARGET_NOT_UNIQUE");
    const source = sources[0], target = targets[0];
    if (source.id === target.id) throw new DuplicateCompanyMergeError("SAME_COMPANY");
    const sourceCourses = await this.store.scan("Course", { companyId: source.id }, session);
    if (!sourceCourses.length) return { sourceId: source.id as string, targetId: target.id as string, courses: [], labels: [], remainingCourses: 0, reassignedCourses: 0, mergedCourses: 0, updatedSessions: 0, reassignedLabels: 0, discardedLabels: 0 };
    const targetCourses = await this.store.scan("Course", { companyId: target.id }, session);
    const sessions = await this.store.scan("OperationSession", { courseRecordId: { $in: sourceCourses.map(row => row.id as string) } }, session);
    const sessionCounts = new Map<string, number>();
    for (const row of sessions) sessionCounts.set(row.courseRecordId as string, (sessionCounts.get(row.courseRecordId as string) ?? 0) + 1);
    const targetCourse = new Map(targetCourses.map(row => [JSON.stringify([row.courseId, row.name]), row]));
    const courses = sourceCourses.map(row => { const existing = targetCourse.get(JSON.stringify([row.courseId, row.name])); return {
      action: existing ? "merge-into-existing" as const : "reassign" as const, courseId: row.courseId as string, name: row.name as string,
      sessionCount: sessionCounts.get(row.id as string) ?? 0, targetCourseId: existing?.id as string ?? null,
    }; });
    const sourceLabels = await this.store.scan("CourseIdLabel", { companyId: source.id }, session);
    const targetLabels = await this.store.scan("CourseIdLabel", { companyId: target.id }, session);
    const targetLabel = new Map(targetLabels.map(row => [row.courseId as string, row]));
    const labels = sourceLabels.map(row => { const existing = targetLabel.get(row.courseId as string); return {
      action: existing ? "discard-source" as const : "reassign" as const, courseId: row.courseId as string,
      label: row.label as string, targetLabel: existing?.label as string ?? null,
    }; });
    let reassignedCourses = 0, mergedCourses = 0, updatedSessions = 0, reassignedLabels = 0, discardedLabels = 0;
    if (input.apply) {
      for (const [index, row] of sourceCourses.entries()) {
        const plan = courses[index];
        if (plan.action === "merge-into-existing") {
          const moved = await this.store.collection("OperationSession").updateMany({ courseRecordId: row.id as string }, { $set: { courseRecordId: plan.targetCourseId, updatedAt: new Date() } }, { session });
          updatedSessions += moved.modifiedCount;
          const deleted = await this.store.collection("Course").deleteOne({ _id: row.id as string, companyId: source.id }, { session });
          assertMongo(deleted.deletedCount === 1, "DUPLICATE_COMPANY_SOURCE_COURSE_CHANGED"); mergedCourses++;
        } else {
          const next = completeMongoRow("Course", { ...row, companyId: target.id, updatedAt: new Date() });
          const changed = await this.store.collection("Course").replaceOne({ _id: row.id as string, companyId: source.id }, encodeMongoRuntimeDocument("Course", next), { session });
          assertMongo(changed.matchedCount === 1, "DUPLICATE_COMPANY_SOURCE_COURSE_CHANGED"); reassignedCourses++;
        }
      }
      for (const [index, row] of sourceLabels.entries()) {
        if (labels[index].action === "discard-source") {
          const deleted = await this.store.collection("CourseIdLabel").deleteOne({ _id: row.id as string, companyId: source.id }, { session });
          assertMongo(deleted.deletedCount === 1, "DUPLICATE_COMPANY_SOURCE_LABEL_CHANGED"); discardedLabels++;
        } else {
          const next = completeMongoRow("CourseIdLabel", { ...row, companyId: target.id, updatedAt: new Date() });
          const changed = await this.store.collection("CourseIdLabel").replaceOne({ _id: row.id as string, companyId: source.id }, encodeMongoRuntimeDocument("CourseIdLabel", next), { session });
          assertMongo(changed.matchedCount === 1, "DUPLICATE_COMPANY_SOURCE_LABEL_CHANGED"); reassignedLabels++;
        }
      }
    }
    return { sourceId: source.id as string, targetId: target.id as string, courses, labels,
      remainingCourses: input.apply ? await this.store.collection("Course").countDocuments({ companyId: source.id }, { session }) : sourceCourses.length,
      reassignedCourses, mergedCourses, updatedSessions, reassignedLabels, discardedLabels };
  }
  async merge(input: { sourceName: string; targetName: string; apply: boolean }) {
    const deadline = performance.now() + TIMEOUT_MS;
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(async () => {
          assertMongo(performance.now() < deadline, "DUPLICATE_COMPANY_MERGE_TIMEOUT");
          if (input.apply) await lockMongoCourseNameRestore(this.store, session);
          return this.execute(input, session);
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: Math.max(1, Math.ceil(deadline - performance.now())) });
      } catch (error) {
        if (error instanceof DuplicateCompanyMergeError || error instanceof MongoOperationError) throw error;
        if (input.apply && error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
        throw new DuplicateCompanyMergeError("TRANSACTION_FAILED");
      } finally { await session.endSession(); }
    }
    throw new DuplicateCompanyMergeError("CONCURRENT_CHANGE");
  }
}
