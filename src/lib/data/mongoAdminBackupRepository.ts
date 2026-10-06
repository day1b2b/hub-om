import { BSON, type ClientSession, type Document, type Filter } from "mongodb";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import policies from "../privacy/fields.json" with { type: "json" };
import { ADMIN_BACKUP_MODELS, type AdminBackupData, type AdminBackupRepository, type AdminBackupRow, type AdminBackupSnapshot } from "./adminBackupRepository";
import { MongoOperationStore, operationMongoIndexes, operationMongoValidator, stableMongoValue, type MongoOperationOptions } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull, type MongoRuntimeDocument } from "./mongoRuntimeCodec";

export const ADMIN_BACKUP_READ_MODELS = [...Object.values(ADMIN_BACKUP_MODELS), "CoachdbArchiveSnapshot"] as const;
const ROWS = 20_000, BYTES = 32 * 1024 * 1024, READ_MS = 60_000, SCAN_MS = 15_000, CLEANUP_MS = 5_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Options = MongoOperationOptions & { /** Monotonic clock; explicit synthetic validation only. */ clock?: () => number };
const privacy = policies as Record<string, { fields: Record<string, { index?: string; storage?: string }> }>;
function check(value: unknown): asserts value { if (!value) throw new Error("ADMIN_BACKUP_READ_FAILED"); }
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch { throw new Error("ADMIN_BACKUP_READ_FAILED"); }
}

/** Shared across all eleven full scans AND the selected metadata, including whole received batches. */
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
  timeout(scanStart: number): number {
    const scanRemaining = SCAN_MS - (this.clock() - scanStart);
    check(Number.isFinite(scanRemaining) && scanRemaining > 0 && scanRemaining <= SCAN_MS);
    return Math.max(1, Math.ceil(Math.min(scanRemaining, this.remaining())));
  }
  receive(batch: Document[]): void {
    this.rows += batch.length;
    for (const row of batch) this.bytes += BSON.calculateObjectSize(row);
    check(this.rows <= ROWS && this.bytes <= BYTES);
    this.remaining();
  }
}

/** Bounded read-only readiness, using the existing validator/index definitions. Never repairs. */
async function ready(store: MongoOperationStore, model: string, budget: ReadBudget): Promise<boolean> {
  const collection = store.collection(model);
  const cursor = store.db.listCollections({ name: collection.collectionName }, {
    nameOnly: false, timeoutMS: Math.ceil(Math.min(SCAN_MS, budget.remaining()))
  });
  let info;
  try { info = await cursor.next(); } finally { await cursor.close({ timeoutMS: CLEANUP_MS }); }
  if (!info) return false;
  check(info.type === "collection" && info.options?.validationLevel === "strict" && info.options.validationAction === "error"
    && stableMongoValue(info.options.validator) === stableMongoValue(operationMongoValidator(model)));
  check(!info.options.capped && (!info.options.collation || info.options.collation.locale === "simple"));
  const indexCursor = collection.listIndexes({ timeoutMS: Math.ceil(Math.min(SCAN_MS, budget.remaining())) });
  try {
    const actual = await indexCursor.toArray(), expected = operationMongoIndexes(model);
    for (const index of expected) {
      const found = actual.find(item => item.name === index.name);
      check(found && JSON.stringify(found.key) === JSON.stringify(index.key) && !!found.unique === !!index.unique
        && stableMongoValue(found.partialFilterExpression) === stableMongoValue(index.partialFilterExpression)
        && !found.sparse && !found.hidden && (!found.collation || found.collation.locale === "simple"));
    }
    check(actual.every(index => index.expireAfterSeconds === undefined && (!index.unique || index.name === "_id_"
      || expected.some(item => item.name === index.name && item.unique))));
  } finally { await indexCursor.close({ timeoutMS: CLEANUP_MS }); }
  budget.remaining(); return true;
}

/** Explicit shadow setup. Every existing model passes metadata/document checks before any creation. */
export function prepareMongoAdminBackupStore(options: MongoOperationOptions & { allowShadowWrites: true }): Promise<void> {
  return safe(async () => {
    check(options.allowShadowWrites === true); assertPrivacyConfiguration();
    const store = new MongoOperationStore(options, ADMIN_BACKUP_READ_MODELS);
    const budget = new ReadBudget(() => performance.now()), missing: string[] = [];
    for (const model of ADMIN_BACKUP_READ_MODELS) {
      if (!await ready(store, model, budget)) missing.push(model);
      else check(!await store.collection(model).findOne({ $nor: [operationMongoValidator(model)] }, {
        projection: { _id: 1 }, timeoutMS: Math.ceil(Math.min(SCAN_MS, budget.remaining()))
      }));
    }
    for (const model of missing) {
      // Direct creation only; never collMod or repair an existing collection.
      await store.db.createCollection(store.collection(model).collectionName, {
        validator: operationMongoValidator(model), validationLevel: "strict", validationAction: "error", collation: { locale: "simple" },
        timeoutMS: Math.ceil(Math.min(SCAN_MS, budget.remaining()))
      });
      const indexes = operationMongoIndexes(model);
      if (indexes.length) await store.collection(model).createIndexes(indexes, {
        collation: { locale: "simple" }, timeoutMS: Math.ceil(Math.min(SCAN_MS, budget.remaining()))
      });
    }
    for (const model of ADMIN_BACKUP_READ_MODELS) check(await ready(store, model, budget));
  });
}

/** Authorized coach export only, not a full DB recovery backup. The caller owns the borrowed client. */
export class MongoAdminBackupRepository implements AdminBackupRepository {
  private readonly store: MongoOperationStore;
  private readonly clock: () => number;
  private constructor(store: MongoOperationStore, clock: () => number) { this.store = store; this.clock = clock; }
  static open(options: Options): Promise<MongoAdminBackupRepository> {
    return safe(async () => {
      assertPrivacyConfiguration();
      const store = new MongoOperationStore(options, ADMIN_BACKUP_READ_MODELS), budget = new ReadBudget(() => performance.now());
      const hello = await store.db.command({ hello: 1 }, { timeoutMS: Math.ceil(Math.min(SCAN_MS, budget.remaining())) });
      check((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number");
      for (const model of ADMIN_BACKUP_READ_MODELS) check(await ready(store, model, budget));
      return new MongoAdminBackupRepository(store, options.clock ?? (() => performance.now()));
    });
  }
  private async scan(model: string, session: ClientSession, budget: ReadBudget): Promise<AdminBackupRow[]> {
    const scanStart = this.clock(), output: AdminBackupRow[] = [];
    let lastId: string | undefined;
    while (true) {
      const filter: Filter<MongoRuntimeDocument> = lastId === undefined ? {} : { _id: { $gt: lastId } };
      const cursor = this.store.collection(model).find(filter, {
        session, singleBatch: true, batchSize: 100, timeoutMS: budget.timeout(scanStart), collation: { locale: "simple" }
      }).sort({ _id: 1 }).limit(100);
      let count: number;
      try {
        const batch = await cursor.toArray(); count = batch.length; budget.receive(batch);
        for (const raw of batch) {
          // Compound-PK codecs use compound: IDs; full decoding validates the model-specific identity.
          check(typeof raw._id === "string" && (lastId === undefined || Buffer.compare(Buffer.from(raw._id), Buffer.from(lastId)) > 0));
          lastId = raw._id; output.push(publicRow(model, raw));
        }
      } finally { await cursor.close({ timeoutMS: CLEANUP_MS }); }
      budget.timeout(scanStart);
      // A short single batch can be BSON-size-limited. Only empty proves the complete model was read.
      if (count === 0) return output;
    }
  }
  private async snapshots(session: ClientSession, budget: ReadBudget): Promise<AdminBackupSnapshot[]> {
    const scanStart = this.clock(), output: AdminBackupSnapshot[] = [], ids = new Set<string>();
    const projection = { _id: 1, tableCount: 1, rowCount: 1, status: 1, startedAt: 1, finishedAt: 1 };
    let previous = Infinity;
    while (output.length < 20) {
      const take = 20 - output.length;
      const cursor = this.store.collection("CoachdbArchiveSnapshot").find(ids.size ? { _id: { $nin: [...ids] } } : {}, {
        session, projection, singleBatch: true, batchSize: take, timeoutMS: budget.timeout(scanStart), collation: { locale: "simple" }
      }).sort({ startedAt: -1 }).limit(take);
      let count: number;
      try {
        const batch = await cursor.toArray(); count = batch.length; budget.receive(batch);
        check(count <= take);
        for (const raw of batch) {
          // Deliberately no full codec/decryption: unselected errorMessage must not affect this export.
          const row = snapshotRow(raw);
          check(!ids.has(row.id) && row.started_at.getTime() <= previous);
          ids.add(row.id); previous = row.started_at.getTime(); output.push(row);
        }
      } finally { await cursor.close({ timeoutMS: CLEANUP_MS }); }
      budget.timeout(scanStart);
      if (count === 0) break;
      // Exclude already selected IDs if a BSON-limited batch was short. Ties remain unspecified,
      // as in the original started_at DESC/LIMIT 20; no extra business tie-breaker is introduced.
    }
    return output;
  }
  read(): Promise<AdminBackupData> {
    return safe(async () => {
      const budget = new ReadBudget(this.clock); assertPrivacyConfiguration(); budget.remaining();
      const session = this.store.client.startSession({ defaultTimeoutMS: CLEANUP_MS });
      let result: AdminBackupData;
      try {
        session.startTransaction({ readConcern: { level: "snapshot" }, readPreference: "primary" });
        const data = {} as AdminBackupData;
        for (const [key, model] of Object.entries(ADMIN_BACKUP_MODELS)) {
          data[key as keyof typeof ADMIN_BACKUP_MODELS] = await this.scan(model, session, budget);
        }
        data.archiveSnapshots = await this.snapshots(session, budget);
        budget.remaining(); result = data;
      } finally {
        // Read-only transaction: bounded endSession abort, no commit, retry callback or client.close.
        await session.endSession({ timeoutMS: CLEANUP_MS });
      }
      budget.remaining(); return result;
    });
  }
}

function publicRow(model: string, raw: MongoRuntimeDocument): AdminBackupRow {
  const row = decodeMongoRuntimeDocument(model, raw);
  const hidden = new Set(Object.values(privacy[model]?.fields ?? {}).flatMap(field => [field.index, field.storage]
    .filter((name): name is string => typeof name === "string")));
  // Codec returns logical contract fields, never its synthetic _id. Remove only policy companions
  // at this level; user JSON containing _id/companion-like keys is preserved without recursion.
  return Object.fromEntries(Object.entries(row).filter(([name]) => !hidden.has(name))
    .map(([name, value]) => [name, value === MongoDbNull || value === MongoJsonNull ? null : value]));
}
function snapshotRow(row: MongoRuntimeDocument): AdminBackupSnapshot {
  const fields = ["_id", "tableCount", "rowCount", "status", "startedAt", "finishedAt"];
  check(Object.keys(row).length === fields.length && fields.every(field => Object.hasOwn(row, field)));
  check(typeof row._id === "string" && UUID.test(row._id) && typeof row.status === "string");
  check(int32(row.tableCount) && int32(row.rowCount));
  check(date(row.startedAt) && (row.finishedAt === null || date(row.finishedAt)));
  return { id: row._id, table_count: row.tableCount, row_count: row.rowCount, status: row.status,
    started_at: row.startedAt, finished_at: row.finishedAt };
}
function int32(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647; }
function date(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }
