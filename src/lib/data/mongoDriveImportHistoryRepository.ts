import { BSON, type ClientSession, type Document, type Filter } from "mongodb";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import type { DriveImportHistoryRepository, StoredDriveImportCandidate, StoredDriveImportResult, StoredDriveImportRunResult, StoredDriveImportRunView } from "./driveImportHistoryRepository";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { MongoOperationStore, operationMongoValidator, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, type MongoRuntimeDocument } from "./mongoRuntimeCodec";

export const DRIVE_IMPORT_HISTORY_MODELS = ["DriveImportRun", "DriveImportResult", "OperationSession"] as const;
const ROWS = 20_000, BYTES = 32 * 1024 * 1024, READ_MS = 60_000, SCAN_MS = 15_000, CLEANUP_MS = 5_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Options = MongoOperationOptions & { /** Monotonic clock; explicit synthetic validation only. */ clock?: () => number };
function check(value: unknown): asserts value { if (!value) throw new Error("DRIVE_IMPORT_HISTORY_READ_FAILED"); }
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch { throw new Error("DRIVE_IMPORT_HISTORY_READ_FAILED"); }
}
class ReadBudget {
  readonly start: number;
  readonly clock: () => number;
  rows = 0;
  bytes = 0;
  constructor(clock: () => number) { this.clock = clock; this.start = clock(); }
  remaining(): number {
    const remaining = READ_MS - (this.clock() - this.start);
    check(Number.isFinite(remaining) && remaining > 0 && remaining <= READ_MS);
    return remaining;
  }
  receive(batch: Document[]): void {
    this.rows += batch.length;
    for (const row of batch) this.bytes += BSON.calculateObjectSize(row);
    check(this.rows <= ROWS && this.bytes <= BYTES);
    this.remaining();
  }
}
/** Existing collections are verified, never repaired; missing shadow collections are explicit setup only. */
export async function prepareMongoDriveImportHistory(options: MongoOperationOptions & { allowShadowWrites: true }): Promise<void> {
  return safe(async () => {
    check(options.allowShadowWrites === true); assertPrivacyConfiguration();
    const store = new MongoOperationStore(options, DRIVE_IMPORT_HISTORY_MODELS);
    const missing: string[] = [];
    for (const model of DRIVE_IMPORT_HISTORY_MODELS) {
      const info = await store.db.listCollections({ name: store.collection(model).collectionName }, { nameOnly: true, timeoutMS: SCAN_MS }).next();
      if (!info) missing.push(model);
      else {
        await assertMongoReadStoreReady(new MongoOperationStore(options, [model]));
        check(!await store.collection(model).findOne({ $nor: [operationMongoValidator(model)] }, { projection: { _id: 1 }, timeoutMS: READ_MS }));
      }
    }
    if (missing.length) await prepareMongoReadStore(options, missing);
  });
}
/** C-collation synthetic baseline only; no production selector or guessed localeCompare parity.
 * Readiness is checked once at open, so no metadata documents are received during a public read.
 * Each read has one snapshot and one cumulative raw-BSON budget, including projection re-fetches.
 */
export class MongoDriveImportHistoryRepository implements DriveImportHistoryRepository {
  private readonly store: MongoOperationStore;
  private readonly clock: () => number;
  private constructor(store: MongoOperationStore, clock: () => number) { this.store = store; this.clock = clock; }
  static async open(options: Options): Promise<MongoDriveImportHistoryRepository> {
    return safe(async () => {
      assertPrivacyConfiguration();
      const store = new MongoOperationStore(options, DRIVE_IMPORT_HISTORY_MODELS);
      const hello = await store.db.command({ hello: 1 }, { timeoutMS: SCAN_MS });
      check((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number");
      await assertMongoReadStoreReady(store);
      return new MongoDriveImportHistoryRepository(store, options.clock ?? (() => performance.now()));
    });
  }
  private async scan(model: string, filter: Filter<MongoRuntimeDocument>, session: ClientSession, budget: ReadBudget, projection?: Document): Promise<MongoRuntimeDocument[]> {
    const output: MongoRuntimeDocument[] = [];
    const scanStart = this.clock(); let bytes = 0, lastId: string | undefined;
    while (true) {
      const scanRemaining = SCAN_MS - (this.clock() - scanStart);
      check(scanRemaining > 0 && scanRemaining <= SCAN_MS);
      const timeoutMS = Math.max(1, Math.ceil(Math.min(scanRemaining, budget.remaining())));
      const cursor = this.store.collection(model).find(lastId === undefined ? filter : { $and: [filter, { _id: { $gt: lastId } }] }, {
        session, projection, singleBatch: true, batchSize: 100, timeoutMS, collation: { locale: "simple" }
      }).sort({ _id: 1 }).limit(100);
      let received = 0;
      try {
        // Account the whole received batch, including buffered rows after the first overflow.
        const batch = await cursor.toArray();
        received = batch.length; budget.receive(batch);
        for (const row of batch) {
          bytes += BSON.calculateObjectSize(row);
          check(output.length < ROWS && bytes <= BYTES && typeof row._id === "string" && UUID.test(row._id));
          check(lastId === undefined || Buffer.compare(Buffer.from(row._id), Buffer.from(lastId)) > 0);
          lastId = row._id; output.push(row);
        }
      } finally { await cursor.close({ timeoutMS: CLEANUP_MS }); }
      check(this.clock() - scanStart < SCAN_MS); budget.remaining();
      // A short single batch can be BSON-size-limited, so only empty proves EOF.
      if (received === 0) return output;
    }
  }
  private async snapshot<T>(budget: ReadBudget, work: (session: ClientSession) => Promise<T>): Promise<T> {
    budget.remaining();
    const session = this.store.client.startSession({ defaultTimeoutMS: CLEANUP_MS });
    let result: T;
    try {
      session.startTransaction({ readConcern: { level: "snapshot" }, readPreference: "primary" });
      result = await work(session); budget.remaining();
    } finally {
      // No writes to commit. endSession bounds abort and marks the local session ended even on timeout.
      await session.endSession({ timeoutMS: CLEANUP_MS });
    }
    budget.remaining();
    return result;
  }
  private async parents(model: string, ids: string[], session: ClientSession, budget: ReadBudget, projection?: Document): Promise<MongoRuntimeDocument[]> {
    const unique = [...new Set(ids)], result: MongoRuntimeDocument[] = [];
    for (let i = 0; i < unique.length; i += 500) result.push(...await this.scan(model, { _id: { $in: unique.slice(i, i + 500) } }, session, budget, projection));
    check(result.length === unique.length);
    const found = new Set(result.map(row => row._id)); check(unique.every(id => found.has(id)));
    return result;
  }
  private async sessions(rows: MongoRow[], session: ClientSession, budget: ReadBudget): Promise<void> {
    const ids = rows.flatMap(row => row.operationSessionId === null ? [] : [row.operationSessionId as string]);
    // Snapshot strings need not match today's session.operationId; private payload is irrelevant to existence.
    await this.parents("OperationSession", ids, session, budget, { _id: 1 });
  }
  readLatestDriveImportResult(operationId: string): Promise<StoredDriveImportResult | null> {
    return safe(async () => {
      const budget = new ReadBudget(this.clock);
      return this.snapshot(budget, async session => {
        const results = (await this.scan("DriveImportResult", { operationId }, session, budget)).map(row => decodeMongoRuntimeDocument("DriveImportResult", row));
        if (!results.length) return null;
        const parents = (await this.parents("DriveImportRun", results.map(row => row.runId as string), session, budget)).map(row => decodeMongoRuntimeDocument("DriveImportRun", row));
        const runs = new Map(parents.map(row => [row.id as string, row]));
        await this.sessions(results, session, budget);
        results.sort((a, b) => time(runs.get(b.runId as string)!.startedAt) - time(runs.get(a.runId as string)!.startedAt) || time(b.createdAt) - time(a.createdAt));
        budget.remaining();
        const result = results[0], run = runs.get(result.runId as string)!;
        return {
          candidateCount: result.candidateCount as number, createdAt: iso(result.createdAt), fileCount: result.fileCount as number,
          folderCandidates: candidates(result.folderCandidates), folderTitle: text(result.folderTitle), folderUrl: text(result.folderUrl),
          inputKind: result.inputKind as string, inputValue: text(result.inputValue), issues: strings(result.issues), keyCandidates: candidates(result.keyCandidates),
          resultKind: result.resultKind as string, runId: result.runId as string, runStartedAt: iso(run.startedAt), runStatus: run.status as string
        };
      });
    });
  }
  readLatestDriveImportRun(resultLimit = 250): Promise<StoredDriveImportRunView | null> {
    return safe(async () => {
      const budget = new ReadBudget(this.clock);
      // Frozen Prisma 7.10 observations: finite safe-range fractions truncate; unsupported numbers return null.
      if (typeof resultLimit !== "number" || !Number.isFinite(resultLimit) || Math.abs(resultLimit) > Number.MAX_SAFE_INTEGER) return null;
      const take = Math.trunc(resultLimit);
      return this.snapshot(budget, async session => {
        const selectors = await this.scan("DriveImportRun", {}, session, budget, { _id: 1, startedAt: 1 });
        for (const row of selectors) time(row.startedAt);
        if (!selectors.length) return null;
        selectors.sort((a, b) => time(b.startedAt) - time(a.startedAt));
        const raw = await this.parents("DriveImportRun", [selectors[0]._id], session, budget);
        const run = decodeMongoRuntimeDocument("DriveImportRun", raw[0]);
        const results = (await this.scan("DriveImportResult", { runId: run.id as string }, session, budget)).map(row => decodeMongoRuntimeDocument("DriveImportResult", row));
        check(results.every(row => row.runId === run.id));
        await this.sessions(results, session, budget);
        results.sort((a, b) => (b.candidateCount as number) - (a.candidateCount as number) || compareText(a.companyName, b.companyName) || compareText(a.courseName, b.courseName));
        budget.remaining();
        const selected = take < 0 ? results.slice(Math.max(0, results.length + take)) : results.slice(0, take);
        return {
          avgSatisfactionCandidateCount: run.avgSatisfactionCandidateCount as number, errorCount: run.errorCount as number,
          finishedAt: run.finishedAt === null ? "" : iso(run.finishedAt), folderSearchCount: run.folderSearchCount as number,
          folderSearchWithCandidatesCount: run.folderSearchWithCandidatesCount as number, id: run.id as string,
          instructorCandidateCount: run.instructorCandidateCount as number, instructorSatisfactionCandidateCount: run.instructorSatisfactionCandidateCount as number,
          mode: run.mode as string, operationCount: run.operationCount as number, results: selected.map(runResult),
          scanFoundFolderCount: run.scanFoundFolderCount as number, scanIssueCount: run.scanIssueCount as number,
          scannedRefCount: run.scannedRefCount as number, startedAt: iso(run.startedAt), status: run.status as string,
          suspiciousCandidateCount: run.suspiciousCandidateCount as number
        };
      });
    });
  }
}
function time(value: unknown): number { check(value instanceof Date && Number.isFinite(value.getTime())); return value.getTime(); }
function iso(value: unknown): string { time(value); return (value as Date).toISOString(); }
function text(value: unknown): string { return (value ?? "") as string; }
function dateOnly(value: unknown): string { return value === null ? "" : iso(value).slice(0, 10); }
function candidates(value: unknown): StoredDriveImportCandidate[] { return Array.isArray(value) ? value.filter((entry): entry is StoredDriveImportCandidate => Boolean(entry) && typeof entry === "object") : []; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
const compareText = (a: unknown, b: unknown) => Buffer.compare(Buffer.from(a as string), Buffer.from(b as string));
function runResult(result: MongoRow): StoredDriveImportRunResult {
  return {
    candidateCount: result.candidateCount as number, companyName: result.companyName as string, courseName: result.courseName as string,
    createdAt: iso(result.createdAt), endDate: dateOnly(result.endDate), error: text(result.error), fileCount: result.fileCount as number,
    folderCandidates: candidates(result.folderCandidates), folderTitle: text(result.folderTitle), folderUrl: text(result.folderUrl),
    inputKind: result.inputKind as string, inputValue: text(result.inputValue), issues: strings(result.issues), keyCandidates: candidates(result.keyCandidates),
    operationId: result.operationId as string, resultKind: result.resultKind as string, startDate: dateOnly(result.startDate)
  };
}
