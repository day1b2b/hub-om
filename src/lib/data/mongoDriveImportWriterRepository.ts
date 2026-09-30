import { randomUUID } from "node:crypto";
import { BSON, type ClientSession, type CollectionInfo, type Filter } from "mongodb";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import { DRIVE_IMPORT_NOTES, DRIVE_IMPORT_WRITER_ERROR, driveImportCounts, driveImportJson, driveImportTake, legacyDriveDate,
  type DriveImportArgs, type DriveImportFinishedStatus, type DriveImportInput, type DriveImportOperation,
  type DriveImportResultInput, type DriveImportSummary, type DriveImportWriterRepository } from "./driveImportWriterRepository";
import { MongoOperationStore, operationMongoIndexes, operationMongoValidator, stableMongoValue,
  type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull,
  type MongoRuntimeDocument } from "./mongoRuntimeCodec";

export const DRIVE_IMPORT_WRITER_MODELS = ["Company", "Course", "OperationSession", "DriveImportRun", "DriveImportResult"] as const;
const CALL_MS = 60_000, SCAN_MS = 15_000, CLEANUP_MS = 5_000, ROWS = 20_000, BYTES = 32 * 1024 * 1024;
function check(value: unknown): asserts value { if (!value) throw new Error(DRIVE_IMPORT_WRITER_ERROR); }
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch { throw new Error(DRIVE_IMPORT_WRITER_ERROR); }
}
function remaining(deadline: number, cap = SCAN_MS): number {
  const value = Math.ceil(deadline - performance.now()); check(value > 0); return Math.min(value, cap);
}
function json(value: unknown): unknown { const result = driveImportJson(value); return result === null ? MongoJsonNull : result; }

/** Same schema/index contracts as MongoOperationStore, with bounded metadata cursors. */
async function ready(store: MongoOperationStore, model: string, deadline: number): Promise<boolean> {
  const collection = store.collection(model);
  const cursor = store.db.listCollections({ name: collection.collectionName }, { timeoutMS: remaining(deadline) });
  let info: CollectionInfo | null;
  try { info = await cursor.next() as CollectionInfo | null; } finally { await cursor.close({ timeoutMS: CLEANUP_MS }); }
  if (!info) return false;
  check(info.type === "collection" && info.options?.validationLevel === "strict" && info.options.validationAction === "error"
    && stableMongoValue(info.options.validator) === stableMongoValue(operationMongoValidator(model)));
  check(!info.options.capped && (!info.options.collation || info.options.collation.locale === "simple"));
  const indexes = collection.listIndexes({ timeoutMS: remaining(deadline) });
  try {
    const actual = await indexes.toArray(), expected = operationMongoIndexes(model);
    for (const item of expected) {
      const found = actual.find(index => index.name === item.name);
      check(found && JSON.stringify(found.key) === JSON.stringify(item.key) && !!found.unique === !!item.unique
        && stableMongoValue(found.partialFilterExpression) === stableMongoValue(item.partialFilterExpression)
        && !found.sparse && !found.hidden && (!found.collation || found.collation.locale === "simple"));
    }
    check(actual.every(index => index.expireAfterSeconds === undefined && (!index.unique || index.name === "_id_"
      || expected.some(item => item.name === index.name && item.unique))));
  } finally { await indexes.close({ timeoutMS: CLEANUP_MS }); }
  return true;
}

/** All existing models pass read-only checks before any missing collection is created. */
export function prepareMongoDriveImportWriter(options: MongoOperationOptions & { allowShadowWrites: true }): Promise<void> {
  return safe(async () => {
    check(options.allowShadowWrites === true); assertPrivacyConfiguration();
    const store = new MongoOperationStore(options, DRIVE_IMPORT_WRITER_MODELS), deadline = performance.now() + CALL_MS;
    const missing: string[] = [];
    for (const model of DRIVE_IMPORT_WRITER_MODELS) {
      if (!await ready(store, model, deadline)) missing.push(model);
      else check(!await store.collection(model).findOne({ $nor: [operationMongoValidator(model)] },
        { projection: { _id: 1 }, timeoutMS: remaining(deadline) }));
    }
    for (const model of missing) {
      await store.db.createCollection(store.collection(model).collectionName, {
        validator: operationMongoValidator(model), validationLevel: "strict", validationAction: "error",
        collation: { locale: "simple" }, timeoutMS: remaining(deadline)
      });
      const indexes = operationMongoIndexes(model);
      if (indexes.length) await store.collection(model).createIndexes(indexes, { collation: { locale: "simple" }, timeoutMS: remaining(deadline) });
    }
    for (const model of DRIVE_IMPORT_WRITER_MODELS) check(await ready(store, model, deadline));
  });
}

export class MongoDriveImportWriterRepository implements DriveImportWriterRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static open(options: MongoOperationOptions): Promise<MongoDriveImportWriterRepository> {
    return safe(async () => {
      assertPrivacyConfiguration();
      const store = new MongoOperationStore(options, DRIVE_IMPORT_WRITER_MODELS), deadline = performance.now() + CALL_MS;
      const hello = await store.db.command({ hello: 1 }, { timeoutMS: remaining(deadline) });
      check((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number");
      for (const model of DRIVE_IMPORT_WRITER_MODELS) check(await ready(store, model, deadline));
      return new MongoDriveImportWriterRepository(store);
    });
  }
  private async scan(model: string, filter: Filter<MongoRuntimeDocument>, session: ClientSession,
    budget: { deadline: number; rows: number; bytes: number }): Promise<MongoRow[]> {
    const rows: MongoRow[] = [], deadline = Math.min(budget.deadline, performance.now() + SCAN_MS);
    let last: string | undefined;
    while (true) {
      const cursor = this.store.collection(model).find(last === undefined ? filter : { $and: [filter, { _id: { $gt: last } }] }, {
        session, timeoutMS: remaining(deadline), singleBatch: true, batchSize: 100, collation: { locale: "simple" }
      }).sort({ _id: 1 }).limit(100);
      let batch: MongoRuntimeDocument[];
      try { batch = await cursor.toArray(); } finally { await cursor.close({ timeoutMS: CLEANUP_MS }); }
      budget.rows += batch.length;
      for (const row of batch) budget.bytes += BSON.calculateObjectSize(row);
      check(budget.rows <= ROWS && budget.bytes <= BYTES); remaining(deadline);
      for (const row of batch) {
        check(typeof row._id === "string" && (last === undefined || Buffer.compare(Buffer.from(row._id), Buffer.from(last)) > 0));
        last = row._id; rows.push(decodeMongoRuntimeDocument(model, row));
      }
      // Single batches can end early because of BSON size. Only empty proves EOF.
      if (!batch.length) return rows;
    }
  }
  loadOperations(limit: number): Promise<DriveImportOperation[]> {
    return safe(async () => {
      const take = driveImportTake(limit);
      const budget = { deadline: performance.now() + CALL_MS, rows: 0, bytes: 0 };
      const session = this.store.client.startSession({ defaultTimeoutMS: CLEANUP_MS });
      try {
        session.startTransaction({ readConcern: { level: "snapshot" }, readPreference: "primary" });
        const sessions = await this.scan("OperationSession", { deletedAt: null }, session, budget);
        const parents = async (model: string, ids: string[]) => {
          const unique = [...new Set(ids)], found: MongoRow[] = [];
          for (let i = 0; i < unique.length; i += 500) found.push(...await this.scan(model, { _id: { $in: unique.slice(i, i + 500) } }, session, budget));
          return found;
        };
        const courses = new Map((await parents("Course", sessions.map(row => row.courseRecordId as string))).map(row => [row.id, row]));
        const companies = new Map((await parents("Company", [...courses.values()].map(row => row.companyId as string))).map(row => [row.id, row]));
        const joined = sessions.filter(row => { const course = courses.get(row.courseRecordId); return course && companies.has(course.companyId); });
        joined.sort((a, b) => (a.startDate as Date).getTime() - (b.startDate as Date).getTime()
          || Buffer.compare(Buffer.from(a.operationId as string), Buffer.from(b.operationId as string)));
        const result = (take === undefined ? joined : joined.slice(0, take)).map(row => {
          const course = courses.get(row.courseRecordId)!, company = companies.get(course.companyId)!;
          return { id: row.id as string, operationId: row.operationId as string,
            companyName: company.name as string, courseName: course.name as string,
            startDate: legacyDriveDate(row.startDate as Date), endDate: legacyDriveDate(row.endDate as Date),
            om: (row.omName ?? "") as string, ld: (row.ldName ?? "") as string,
            driveLink: (row.driveLink ?? "") as string, lectureManagementLink: (row.lectureManagementLink ?? "") as string };
        });
        remaining(budget.deadline); return result;
      } finally { await session.endSession({ timeoutMS: CLEANUP_MS }); }
    });
  }
  createRun(args: DriveImportArgs, operationCount: number): Promise<string> {
    return safe(async () => {
      const id = randomUUID();
      const row = encodeMongoRuntimeDocument("DriveImportRun", {
        id, mode: args.mode, status: "PENDING", operationCount,
        scannedRefCount: 0, scanFoundFolderCount: 0, scanIssueCount: 0, folderSearchCount: 0,
        folderSearchWithCandidatesCount: 0, avgSatisfactionCandidateCount: 0,
        instructorSatisfactionCandidateCount: 0, instructorCandidateCount: 0, suspiciousCandidateCount: 0, errorCount: 0,
        summary: MongoDbNull, notes: DRIVE_IMPORT_NOTES, startedAt: new Date(), finishedAt: null
      });
      await this.store.collection("DriveImportRun").insertOne(row, { timeoutMS: SCAN_MS }); return id;
    });
  }
  appendResult(runId: string, operation: DriveImportOperation, input: DriveImportInput, result: DriveImportResultInput): Promise<void> {
    return safe(async () => {
      // Identity, JSON conversion and encryption happen once, outside callback retries.
      const row = encodeMongoRuntimeDocument("DriveImportResult", {
        id: randomUUID(), runId, operationSessionId: operation.id, operationId: operation.operationId,
        companyName: operation.companyName, courseName: operation.courseName,
        startDate: operation.startDate ? new Date(`${operation.startDate}T00:00:00.000Z`) : null,
        endDate: operation.endDate ? new Date(`${operation.endDate}T00:00:00.000Z`) : null,
        inputKind: input.kind, inputValue: input.value, resultKind: result.resultKind,
        folderId: result.folderId ?? null, folderTitle: result.folderTitle ?? null, folderUrl: result.folderUrl ?? null,
        fileCount: result.fileCount ?? 0, candidateCount: result.candidateCount ?? 0,
        keyCandidates: json(result.keyCandidates ?? []), folderCandidates: json(result.folderCandidates ?? []),
        issues: json(result.issues ?? []), error: result.error ?? null, createdAt: new Date()
      });
      const session = this.store.client.startSession({ defaultTimeoutMS: CLEANUP_MS });
      try {
        await session.withTransaction(async () => {
          check(await this.store.collection("DriveImportRun").findOne({ _id: runId }, { session, projection: { _id: 1 } }));
          if (row.operationSessionId !== null) check(await this.store.collection("OperationSession").findOne(
            { _id: row.operationSessionId as string }, { session, projection: { _id: 1 } }));
          // Existence, including soft-deleted sessions. Physical concurrent deletion/FK cascade is out of scope.
          await this.store.collection("DriveImportResult").insertOne(row, { session });
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: CALL_MS });
      } finally { await session.endSession({ timeoutMS: CLEANUP_MS }); }
    });
  }
  finishRun(runId: string, summary: DriveImportSummary, status: DriveImportFinishedStatus): Promise<void> {
    return safe(async () => {
      // SQL parameter serialization also happens for UPDATE matching zero rows.
      const serialized = json(summary), counts = driveImportCounts(summary), deadline = performance.now() + CALL_MS;
      const raw = await this.store.collection("DriveImportRun").findOne({ _id: runId }, { timeoutMS: remaining(deadline) });
      if (!raw) return;
      // Intentional stricter fail-closed difference from PG updateMany: damaged notes are authenticated too.
      const full = decodeMongoRuntimeDocument("DriveImportRun", raw);
      const encoded = encodeMongoRuntimeDocument("DriveImportRun", { ...full, ...counts, summary: serialized,
        status: status === "completed" ? "COMPLETED" : "COMPLETED_WITH_ERRORS", finishedAt: new Date() });
      const fields = [...Object.keys(counts), "summary", "status", "finishedAt"];
      const $set = Object.fromEntries(fields.map(field => [field, encoded[field]]));
      await this.store.collection("DriveImportRun").updateOne({ _id: runId }, { $set }, { upsert: false, timeoutMS: remaining(deadline) });
    });
  }
  async close(): Promise<void> { /* The caller owns the borrowed MongoClient. */ }
}
