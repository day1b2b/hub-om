import { createHash, randomUUID } from "node:crypto";
import { BSON, MongoServerError, type ClientSession } from "mongodb";
import { CourseNameRestoreConflict, type CourseNameRestoreRepository, type CourseNameRestorePlan, type CourseNameRestoreResult } from "./courseNameRestoreRepository";
import { normalizeCourseId } from "./operationCalculations";
import { operationAuditRow } from "./mongoOperationAudit";
import { applyMongoValidator, assertMongo, completeMongoRow, MONGO_SCAN_BYTES, MONGO_SCAN_ROWS, MongoOperationError, MongoOperationStore, operationMongoValidator, stableMongoValue, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongoCourseNameRestoreGuardReady, lockMongoCourseNameRestore, prepareMongoCourseNameRestoreGuard } from "./mongoCourseNameRestoreGuard";

export const COURSE_NAME_RESTORE_MODELS = ["Company", "Course", "OperationSession", "OperationSourceRecord", "ActivityChange"] as const;
export type MongoCourseNameRestoreOptions = MongoOperationOptions & { allowShadowWrites: true };
type Source = { id: string; createdAt: Date; mappedFields: unknown };
type Session = { id: string; operationId: string; courseRecordId: string; updatedAt: Date; updatedBy: string | null; startDate: Date; endDate: Date; roundNo: string | null; sourceRecords: Source[] };
type Course = MongoRow & { id: string; companyId: string; name: string; updatedAt: Date; company: { name: string }; sessions: Session[] };
type Entry = { course: Course; session: Session; name: string | null; target: Course | undefined; blockedReason: string | null };
const TIMEOUT_MS = 30_000;

async function maxSequence(store: MongoOperationStore): Promise<number> {
  const row = await store.collection("Course").find({}, { projection: { processSeq: 1 }, maxTimeMS: 15_000 }).sort({ processSeq: -1 }).limit(1).next();
  const value = row?.processSeq ?? 0;
  assertMongo(Number.isInteger(value) && value >= 0 && value <= 2147483647, "INVALID_STORED_SEQUENCE");
  return value;
}
async function assertCounterReady(store: MongoOperationStore): Promise<void> {
  const collection = store.collection("__counter");
  const info = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  assertMongo(info && info.options?.validationLevel === "strict" && info.options?.validationAction === "error"
    && stableMongoValue(info.options.validator) === stableMongoValue(operationMongoValidator("__counter"))
    && (!info.options.collation || info.options.collation.locale === "simple") && !info.options.capped, "COUNTER_NOT_READY");
  const indexes = await collection.listIndexes().toArray();
  assertMongo(indexes.some(index => index.name === "_id_" && JSON.stringify(index.key) === JSON.stringify({ _id: 1 }))
    && indexes.every(index => index.expireAfterSeconds === undefined), "COUNTER_NOT_READY");
  const counter = await collection.findOne({ _id: "Course.processSeq" }, { maxTimeMS: 15_000 });
  assertMongo(counter && Number.isInteger(counter.value) && counter.value >= await maxSequence(store) && counter.value <= 2147483647, "COUNTER_NOT_READY");
}
export async function prepareMongoCourseNameRestoreStore(options: MongoCourseNameRestoreOptions & { processSequenceHighWater: number }): Promise<void> {
  try {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    assertMongo(Number.isInteger(options.processSequenceHighWater) && options.processSequenceHighWater >= 0 && options.processSequenceHighWater < 2147483647, "INVALID_SEQUENCE_HIGH_WATER");
    await prepareMongoReadStore(options, COURSE_NAME_RESTORE_MODELS);
    const store = new MongoOperationStore(options, COURSE_NAME_RESTORE_MODELS);
    await applyMongoValidator(store, "__counter", operationMongoValidator("__counter"));
    await store.collection("__counter").updateOne({ _id: "Course.processSeq" }, { $max: { value: Math.max(options.processSequenceHighWater, await maxSequence(store)) } }, { upsert: true });
    await prepareMongoCourseNameRestoreGuard(store, options.allowShadowWrites);
    await assertCounterReady(store);
  } catch (error) {
    if (error instanceof MongoOperationError) throw error;
    throw new MongoOperationError("COURSE_NAME_RESTORE_PREPARE_FAILED");
  }
}
function sourceName(value: unknown): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const name = (value as Record<string, unknown>).courseName;
  return typeof name === "string" ? name.trim() || null : null;
}
function metadata(course: MongoRow): MongoRow {
  // The runtime codec normalizes Decimal128 values to fixed two-place strings.
  return { operationType: course.operationType, courseCategory: course.courseCategory, tools: course.tools, revenue: course.revenue, revenueRaw: course.revenueRaw };
}

export class MongoCourseNameRestoreRepository implements CourseNameRestoreRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoCourseNameRestoreOptions): Promise<MongoCourseNameRestoreRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, COURSE_NAME_RESTORE_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertCounterReady(store);
      await assertMongoCourseNameRestoreGuardReady(store);
      return new MongoCourseNameRestoreRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COURSE_NAME_RESTORE_OPEN_FAILED");
    }
  }
  private async transaction<T>(apply: boolean, work: (session: ClientSession, check: () => void) => Promise<T>): Promise<T> {
    const deadline = performance.now() + TIMEOUT_MS;
    const check = () => assertMongo(performance.now() < deadline, "COURSE_NAME_RESTORE_TIMEOUT");
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        check();
        const session = this.store.client.startSession();
        try {
          return await session.withTransaction(async () => {
            check();
            if (apply) await lockMongoCourseNameRestore(this.store, session);
            check();
            const result = await work(session, check);
            check();
            return result;
          }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: Math.max(1, Math.ceil(deadline - performance.now())) });
        } catch (error) {
          if (apply && error instanceof MongoServerError && error.code === 11000) {
            if (attempt < 4) continue;
            throw new CourseNameRestoreConflict();
          }
          throw error;
        } finally { await session.endSession(); }
      }
      throw new CourseNameRestoreConflict();
    } catch (error) {
      if (error instanceof CourseNameRestoreConflict || error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COURSE_NAME_RESTORE_TRANSACTION_FAILED");
    }
  }

  /** Course identifiers are public scalar fields. Do not decrypt unrelated courses. */
  private async courseIds(courseId: string, session: ClientSession, check: () => void): Promise<string[]> {
    const deadline = performance.now() + 15_000;
    let lastId: string | undefined, count = 0, bytes = 0;
    const ids: string[] = [];
    for (;;) {
      check();
      assertMongo(performance.now() < deadline, "SCAN_TIMEOUT");
      const cursor = this.store.collection("Course").find(lastId === undefined ? {} : { _id: { $gt: lastId } }, {
        projection: { _id: 1, courseId: 1 }, session, singleBatch: true, batchSize: 100,
        maxTimeMS: Math.max(1, Math.ceil(deadline - performance.now())), collation: { locale: "simple" }
      }).sort({ _id: 1 }).limit(100);
      let page = 0;
      try { for await (const row of cursor) {
        bytes += BSON.calculateObjectSize(row); count++; page++;
        assertMongo(count <= MONGO_SCAN_ROWS && bytes <= MONGO_SCAN_BYTES, "SCAN_LIMIT_EXCEEDED");
        assertMongo(typeof row._id === "string" && typeof row.courseId === "string", "COURSE_NAME_RESTORE_INVALID_IDENTIFIER");
        lastId = row._id;
        if (normalizeCourseId(row.courseId) === courseId) ids.push(row._id);
      } } finally { await cursor.close(); }
      assertMongo(performance.now() < deadline, "SCAN_TIMEOUT");
      if (!page) return ids;
    }
  }

  /** Only the latest two records per target session are decoded. Short BSON
   * batches resume at the actual (createdAt,id) key, without driver getMore.
   */
  private async sources(sessions: MongoRow[], session: ClientSession, check: () => void): Promise<Map<unknown, Source[]>> {
    const deadline = performance.now() + 15_000;
    let count = 0, bytes = 0;
    const result = new Map<unknown, Source[]>();
    for (const target of sessions) {
      const selected: Source[] = [];
      while (selected.length < 2) {
        check();
        assertMongo(performance.now() < deadline, "SCAN_TIMEOUT");
        const last = selected.at(-1);
        const cursor = this.store.collection("OperationSourceRecord").find({
          operationSessionId: target.id,
          ...(last ? { $or: [{ createdAt: { $lt: last.createdAt } }, { createdAt: last.createdAt, _id: { $lt: last.id } }] } : {})
        }, { session, singleBatch: true, batchSize: 2 - selected.length, collation: { locale: "simple" }, maxTimeMS: Math.max(1, Math.ceil(deadline - performance.now())) })
          .sort({ createdAt: -1, _id: -1 }).limit(2 - selected.length);
        let page = 0;
        try { for await (const document of cursor) {
          page++; count++; bytes += BSON.calculateObjectSize(document);
          assertMongo(count <= MONGO_SCAN_ROWS && bytes <= MONGO_SCAN_BYTES, "SCAN_LIMIT_EXCEEDED");
          const row = decodeMongoRuntimeDocument("OperationSourceRecord", document);
          selected.push({ id: row.id as string, createdAt: row.createdAt as Date, mappedFields: row.mappedFields });
        } } finally { await cursor.close(); }
        assertMongo(performance.now() < deadline, "SCAN_TIMEOUT");
        if (!page) break;
      }
      result.set(target.id, selected);
    }
    return result;
  }

  private async readPlan(courseId: string, session: ClientSession, check: () => void) {
    const ids = await this.courseIds(courseId, session, check);
    const courseRows = ids.length ? await this.store.scan("Course", { _id: { $in: ids } }, session) : [];
    const sessionRows = ids.length ? await this.store.scan("OperationSession", { courseRecordId: { $in: ids }, deletedAt: null }, session) : [];
    const companies = courseRows.length ? await this.store.scan("Company", { _id: { $in: [...new Set(courseRows.map(row => row.companyId as string))] } }, session) : [];
    check();
    const companyById = new Map(companies.map(row => [row.id, row]));
    const sources = await this.sources(sessionRows, session, check);
    const sessionsByCourse = new Map<unknown, Session[]>();
    for (const row of sessionRows) {
      const projected: Session = {
        id: row.id as string, operationId: row.operationId as string, courseRecordId: row.courseRecordId as string,
        updatedAt: row.updatedAt as Date, updatedBy: row.updatedBy as string | null,
        startDate: row.startDate as Date, endDate: row.endDate as Date, roundNo: row.roundNo as string | null,
        sourceRecords: sources.get(row.id) ?? []
      };
      const list = sessionsByCourse.get(row.courseRecordId) ?? [];
      list.push(projected); sessionsByCourse.set(row.courseRecordId, list);
    }
    // scan's _id order reproduces PG course/session id asc. Strip codec companions
    // from the full Course projection; only company.name enters the fingerprint.
    const courses: Course[] = courseRows.map(row => {
      const company = companyById.get(row.companyId);
      assertMongo(company, "COURSE_NAME_RESTORE_MISSING_COMPANY");
      return { ...completeMongoRow("Course", row), company: { name: company.name as string }, sessions: sessionsByCourse.get(row.id) ?? [] } as Course;
    });
    const entries: Entry[] = courses.flatMap(course => course.sessions.map(item => {
      const [latest, previous] = item.sourceRecords;
      const name = sourceName(latest?.mappedFields ?? null);
      const candidates = courses.filter(target => target.companyId === course.companyId && target.name === name);
      const blockedReason = !name ? "원천 과정명이 없습니다."
        : previous && latest.createdAt.getTime() === previous.createdAt.getTime() ? "최신 원천 기록의 시각이 같아 복원 근거를 확정할 수 없습니다."
        : name === course.name ? "원천 과정명과 현재 과정명이 같습니다."
        : candidates.length > 1 ? "같은 기업·코스ID·과정명의 대상이 여러 개입니다." : null;
      return { course, session: item, name, target: candidates[0], blockedReason };
    }));
    const metadataByDestination = new Map<string, Set<string>>();
    for (const entry of entries) {
      if (entry.blockedReason || entry.target) continue;
      const key = JSON.stringify([entry.course.companyId, entry.name]);
      const values = metadataByDestination.get(key) ?? new Set<string>();
      values.add(stableMongoValue(metadata(entry.course))); metadataByDestination.set(key, values);
    }
    for (const entry of entries) {
      if (!entry.target && (metadataByDestination.get(JSON.stringify([entry.course.companyId, entry.name]))?.size ?? 0) > 1) {
        entry.blockedReason = "새 과정에 복사할 유형·도구·매출 정보가 서로 다릅니다.";
      }
    }
    const plan: CourseNameRestorePlan = {
      snapshot: createHash("sha256").update(stableMongoValue({ courseId, courses })).digest("hex"), courseId,
      companyNames: [...new Set(courses.map(course => course.company.name))].sort(),
      courses: courses.map(course => ({ id: course.id, companyName: course.company.name, courseName: course.name, sessionCount: course.sessions.length, updatedAt: course.updatedAt.toISOString() })),
      rows: entries.map(({ course, session: item, name, blockedReason }) => ({
        companyName: course.company.name, blockedReason, currentCourseName: course.name, sourceCourseName: name, restorable: blockedReason === null,
        operationId: item.operationId, roundNo: item.roundNo ?? "", updatedBy: item.updatedBy,
        updatedAt: item.updatedAt.toISOString(), startDate: item.startDate?.toISOString().slice(0, 10) ?? "", endDate: item.endDate?.toISOString().slice(0, 10) ?? ""
      })).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.operationId.localeCompare(b.operationId))
    };
    check();
    return { plan, entries, sessionRows };
  }
  planCourseNameRestore(rawCourseId: string): Promise<CourseNameRestorePlan> {
    return this.transaction(false, async (session, check) => (await this.readPlan(normalizeCourseId(rawCourseId), session, check)).plan);
  }
  async applyCourseNameRestore(rawCourseId: string, operationIds: string[], snapshot: string, actorEmail: string | null): Promise<CourseNameRestoreResult> {
    if (!operationIds.length || operationIds.length > 100 || new Set(operationIds).size !== operationIds.length) {
      throw new CourseNameRestoreConflict("중복 없이 1~100개 회차를 선택해 주세요.");
    }
    return this.transaction(true, async (session, check) => {
      const courseId = normalizeCourseId(rawCourseId);
      const { plan, entries, sessionRows } = await this.readPlan(courseId, session, check);
      if (snapshot !== plan.snapshot) throw new CourseNameRestoreConflict();
      const selected = operationIds.map(id => entries.find(entry => entry.session.operationId === id));
      if (selected.some(entry => !entry || entry.blockedReason || !entry.name)) throw new CourseNameRestoreConflict("선택한 회차 중 복원할 수 없는 항목이 있습니다. 다시 조회해 주세요.");
      const created = new Map<string, string>();
      const original = new Map(sessionRows.map(row => [row.id, row]));
      const moved: CourseNameRestoreResult["moved"] = [];
      for (const entry of selected) {
        check();
        if (!entry || !entry.name) throw new CourseNameRestoreConflict();
        const { course, session: item, name } = entry;
        const key = JSON.stringify([course.companyId, name]);
        let targetId = entry.target?.id ?? created.get(key);
        if (!targetId) {
          const counter = await this.store.collection("__counter").findOneAndUpdate({ _id: "Course.processSeq", value: { $lt: 2147483647 } }, { $inc: { value: 1 } }, { session, returnDocument: "after" });
          check();
          assertMongo(counter && Number.isInteger(counter.value) && counter.value > 0, "SEQUENCE_EXHAUSTED_OR_MISSING");
          const now = new Date();
          const target = completeMongoRow("Course", { id: randomUUID(), processSeq: counter.value, companyId: course.companyId, courseId, name, ...metadata(course), createdAt: now, updatedAt: now });
          await this.store.collection("Course").insertOne(encodeMongoRuntimeDocument("Course", target), { session });
          check();
          await this.audit("Course", null, target, session);
          check();
          targetId = target.id as string; created.set(key, targetId);
        }
        const before = original.get(item.id);
        assertMongo(before, "COURSE_NAME_RESTORE_SESSION_MISSING");
        const next = completeMongoRow("OperationSession", { ...before, courseRecordId: targetId, updatedBy: actorEmail, updatedAt: new Date() });
        const encoded = encodeMongoRuntimeDocument("OperationSession", next);
        const result = await this.store.collection("OperationSession").updateOne({ _id: item.id, courseRecordId: course.id, updatedAt: item.updatedAt, deletedAt: null }, { $set: {
          courseRecordId: encoded.courseRecordId, updatedBy: encoded.updatedBy, updatedByPiiIndex: encoded.updatedByPiiIndex, updatedAt: encoded.updatedAt
        } }, { session });
        if (result.matchedCount !== 1) throw new CourseNameRestoreConflict();
        check();
        await this.audit("OperationSession", before, next, session);
        moved.push({ operationId: item.operationId, from: course.name, to: name });
      }
      return { moved, skipped: [] };
    });
  }
  private async audit(model: string, before: MongoRow | null, after: MongoRow, session: ClientSession): Promise<void> {
    const audit = operationAuditRow(model, before, after);
    if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
  }
}
