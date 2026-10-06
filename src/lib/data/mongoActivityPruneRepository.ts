import type { AbstractCursor, ClientSession, Document } from "mongodb";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import type { ActivityPruneBatch, ActivityPruneRepository } from "./activityPruneRepository";
import { MongoOperationStore, operationMongoIndexes, operationMongoValidator, stableMongoValue, type MongoOperationOptions } from "./mongoOperationStore";

export const ACTIVITY_PRUNE_MODELS = ["ActivityRequest", "ActivityChange"] as const;
const BATCH_SIZE = 1000, BATCH_MS = 10_000, CLEANUP_MS = 5000, DAY_MS = 86_400_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Options = MongoOperationOptions & { allowShadowWrites: true };
type BatchOptions = { timeoutMS?: number; operationTimeoutMS?: number };
function check(value: unknown): asserts value { if (!value) throw new Error("ACTIVITY_PRUNE_FAILED"); }
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch { throw new Error("ACTIVITY_PRUNE_FAILED"); }
}
function remaining(deadline: number, cap = BATCH_MS): number {
  const ms = Math.floor(Math.min(cap, deadline - performance.now()));
  check(Number.isFinite(ms) && ms > 0); return ms;
}
function validDate(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }

/** Metadata checks are read-only; inspect both models before creating anything. */
async function ready(store: MongoOperationStore, model: string, deadline: number): Promise<boolean> {
  const collection = store.collection(model);
  const metadata = store.db.listCollections({ name: collection.collectionName }, { nameOnly: false, timeoutMS: remaining(deadline) });
  let info;
  try { info = await metadata.next(); } finally { await metadata.close({ timeoutMS: CLEANUP_MS }); }
  if (!info) return false;
  check(info.type === "collection" && info.options?.validationLevel === "strict" && info.options.validationAction === "error"
    && stableMongoValue(info.options.validator) === stableMongoValue(operationMongoValidator(model)));
  check(!info.options.capped && (!info.options.collation || info.options.collation.locale === "simple"));
  const cursor = collection.listIndexes({ timeoutMS: remaining(deadline) });
  try {
    const actual = await cursor.toArray(), expected = operationMongoIndexes(model);
    for (const index of expected) {
      const found = actual.find(item => item.name === index.name);
      check(found && JSON.stringify(found.key) === JSON.stringify(index.key) && !!found.unique === !!index.unique
        && stableMongoValue(found.partialFilterExpression) === stableMongoValue(index.partialFilterExpression)
        && !found.sparse && !found.hidden && (!found.collation || found.collation.locale === "simple"));
    }
    check(actual.every(index => index.expireAfterSeconds === undefined && (!index.unique || index.name === "_id_"
      || expected.some(item => item.name === index.name && item.unique))));
  } finally { await cursor.close({ timeoutMS: CLEANUP_MS }); }
  remaining(deadline); return true;
}
async function replica(store: MongoOperationStore, deadline: number): Promise<void> {
  const hello = await store.db.command({ hello: 1 }, { timeoutMS: remaining(deadline) });
  check((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number");
}

export function prepareMongoActivityPruneStore(options: Options): Promise<void> {
  return safe(async () => {
    check(options.allowShadowWrites === true); assertPrivacyConfiguration();
    const store = new MongoOperationStore(options, ACTIVITY_PRUNE_MODELS), deadline = performance.now() + BATCH_MS;
    await replica(store, deadline);
    const missing: string[] = [];
    for (const model of ACTIVITY_PRUNE_MODELS) {
      if (!await ready(store, model, deadline)) missing.push(model);
      else {
        const cursor = store.collection(model).find({ $nor: [operationMongoValidator(model)] }, {
          projection: { _id: 1 }, timeoutMS: remaining(deadline)
        }).limit(1);
        try { check(!await cursor.next()); } finally { await cursor.close({ timeoutMS: CLEANUP_MS }); }
      }
    }
    for (const model of missing) {
      await store.db.createCollection(store.collection(model).collectionName, {
        validator: operationMongoValidator(model), validationLevel: "strict", validationAction: "error", collation: { locale: "simple" },
        timeoutMS: remaining(deadline)
      });
      const indexes = operationMongoIndexes(model);
      if (indexes.length) await store.collection(model).createIndexes(indexes, { collation: { locale: "simple" }, timeoutMS: remaining(deadline) });
    }
    for (const model of ACTIVITY_PRUNE_MODELS) check(await ready(store, model, deadline));
  });
}

/** withTransaction owns CSOT. Its driver forbids per-operation timeoutMS overrides.
 * An operation signal bounds actual IO as well as waiting, without racing an unobserved promise.
 * Never translate driver errors here: the transaction must see their transient labels. */
async function operation<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("ACTIVITY_PRUNE_FAILED")), ms);
  timer.unref();
  try { return await work(controller.signal); } finally { clearTimeout(timer); }
}
async function readCursor<T extends Document>(ms: number, create: (signal: AbortSignal) => AbstractCursor<T>): Promise<T[]> {
  let cursor: AbstractCursor<T> | undefined;
  try {
    return await operation(ms, async signal => { cursor = create(signal); return await cursor.toArray(); });
  } finally { if (cursor) await cursor.close({ timeoutMS: CLEANUP_MS }); }
}

/** One atomic batch. Callers enforce their explicit write gate before lending a prepared store. */
export function pruneMongoActivityBatch(store: MongoOperationStore, options: BatchOptions = {}): Promise<ActivityPruneBatch> {
  return safe(async () => {
    const timeoutMS = options.timeoutMS ?? BATCH_MS, operationTimeoutMS = options.operationTimeoutMS ?? BATCH_MS;
    check(Number.isSafeInteger(timeoutMS) && timeoutMS > 0 && timeoutMS <= BATCH_MS);
    check(Number.isSafeInteger(operationTimeoutMS) && operationTimeoutMS > 0 && operationTimeoutMS <= BATCH_MS);
    assertPrivacyConfiguration();
    check(ACTIVITY_PRUNE_MODELS.every(model => store.models.includes(model)));
    const deadline = performance.now() + timeoutMS;
    const session = store.client.startSession({ defaultTimeoutMS: CLEANUP_MS });
    const ioRemaining = () => remaining(deadline, operationTimeoutMS);
    try {
      return await session.withTransaction(async () => {
        // Fresh transaction attempts sample once; both cutoffs share that server Date.
        const clock = await readCursor(ioRemaining(), signal => {
          const clockOptions = { session, signal };
          return store.db.aggregate([{ $documents: [{}] }, { $project: { _id: 0, serverNow: "$$NOW" } }], clockOptions);
        });
        check(clock.length === 1 && Object.keys(clock[0]).length === 1 && validDate(clock[0].serverNow));
        const serverNow = clock[0].serverNow.getTime();
        const requests = await prune("ActivityRequest", new Date(serverNow - 30 * DAY_MS), session);
        const changes = await prune("ActivityChange", new Date(serverNow - 365 * DAY_MS), session);
        remaining(deadline);
        return { requests, changes };
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: remaining(deadline, timeoutMS) });
    } finally { await session.endSession({ timeoutMS: CLEANUP_MS }); }

    async function prune(model: typeof ACTIVITY_PRUNE_MODELS[number], cutoff: Date, activeSession: ClientSession): Promise<number> {
      check(validDate(cutoff));
      const collection = store.collection(model);
      const rows = await readCursor(ioRemaining(), signal => collection.find({ occurredAt: { $lt: cutoff } }, {
        session: activeSession, signal, projection: { _id: 1, occurredAt: 1 }, collation: { locale: "simple" },
        // UUID/date projection stays well below the wire limit for 1000 rows.
        // Avoid getMore inheriting transaction CSOT as an unsupported maxTimeMS.
        batchSize: BATCH_SIZE, singleBatch: true
      }).sort({ occurredAt: 1 }).limit(BATCH_SIZE));
      check(rows.length <= BATCH_SIZE);
      const ids: string[] = [], unique = new Set<string>();
      let previous = -Infinity;
      for (const row of rows) {
        check(Object.keys(row).length === 2 && typeof row._id === "string" && UUID.test(row._id)
          && validDate(row.occurredAt) && row.occurredAt.getTime() < cutoff.getTime()
          && row.occurredAt.getTime() >= previous && !unique.has(row._id));
        previous = row.occurredAt.getTime(); unique.add(row._id); ids.push(row._id);
      }
      if (!ids.length) { remaining(deadline); return 0; }
      const result = await operation(ioRemaining(), signal => {
        const deleteOptions = { session: activeSession, signal, collation: { locale: "simple" } };
        return collection.deleteMany({ _id: { $in: ids }, occurredAt: { $lt: cutoff } }, deleteOptions);
      });
      check(result.acknowledged && Number.isInteger(result.deletedCount) && result.deletedCount >= 0 && result.deletedCount <= ids.length);
      return result.deletedCount;
    }
  });
}

export class MongoActivityPruneRepository implements ActivityPruneRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static open(options: Options): Promise<MongoActivityPruneRepository> {
    return safe(async () => {
      check(options.allowShadowWrites === true); assertPrivacyConfiguration();
      const store = new MongoOperationStore(options, ACTIVITY_PRUNE_MODELS), deadline = performance.now() + BATCH_MS;
      await replica(store, deadline);
      for (const model of ACTIVITY_PRUNE_MODELS) check(await ready(store, model, deadline));
      return new MongoActivityPruneRepository(store);
    });
  }
  pruneBatch(): Promise<ActivityPruneBatch> { return pruneMongoActivityBatch(this.store); }
  async close(): Promise<void> { /* Borrowed client: lifecycle belongs to the caller. */ }
}
