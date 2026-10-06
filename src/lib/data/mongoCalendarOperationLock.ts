import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Long, MongoServerError, type ClientSession, type Collection } from "mongodb";
import type { CalendarLockHandle, CalendarLockPort } from "../googleCalendar/calendarPersistence";
import { runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { assertMongo, MongoOperationError, MongoOperationStore, stableMongoValue, type MongoOperationOptions } from "./mongoOperationStore";

export const CALENDAR_LEASE_TIMING = Object.freeze({ leaseMs: 60_000, renewMs: 15_000, ioMs: 5_000, callbackMs: 180_000, transactionMs: 10_000, marginMs: 1_000 });
export type MongoCalendarOptions = MongoOperationOptions & { allowShadowWrites: true };
type LeaseRow = { _id: string; owner: string | null; generation: Long; leaseUntil: Date; nonce: string };
const validator = { $jsonSchema: { bsonType: "object", required: ["_id", "owner", "generation", "leaseUntil", "nonce"], additionalProperties: false, properties: {
  _id: { bsonType: "string" }, owner: { bsonType: ["string", "null"] }, generation: { bsonType: "long", minimum: 0 }, leaseUntil: { bsonType: "date" }, nonce: { bsonType: "string" }
} } };
const concern = { w: "majority", j: true } as const;
function collection(store: MongoOperationStore): Collection<LeaseRow> {
  return store.db.collection<LeaseRow>(`${store.namespace}_CalendarOperationLease`, { promoteLongs: false, readPreference: "primary" });
}
async function ready(store: MongoOperationStore): Promise<void> {
  const leases = collection(store);
  const info = await store.db.listCollections({ name: leases.collectionName }, { nameOnly: false }).next();
  assertMongo(info && info.options?.validationLevel === "strict" && info.options.validationAction === "error"
    && stableMongoValue(info.options.validator) === stableMongoValue(validator)
    && !info.options.capped && (!info.options.collation || info.options.collation.locale === "simple"), "CALENDAR_LEASE_NOT_READY");
  const indexes = await leases.listIndexes().toArray();
  assertMongo(indexes.length === 1 && indexes[0].name === "_id_" && stableMongoValue(indexes[0].key) === stableMongoValue({ _id: 1 })
    && indexes[0].expireAfterSeconds === undefined, "CALENDAR_LEASE_INDEX_MISMATCH");
  assertMongo(!await leases.findOne({ $nor: [validator] }, { projection: { _id: 1 }, timeoutMS: CALENDAR_LEASE_TIMING.ioMs }), "CALENDAR_LEASE_DOCUMENT_MISMATCH");
  const hello = await store.db.command({ hello: 1 }, { timeoutMS: CALENDAR_LEASE_TIMING.ioMs });
  assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
}
async function safely<T>(code: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError(code); }
}
/** Explicit shadow preparation only. Existing coordination metadata/data is never repaired or reset. */
export async function prepareMongoCalendarLeaseStore(options: MongoCalendarOptions): Promise<void> {
  return safely("CALENDAR_LEASE_PREPARE_FAILED", async () => {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, ["CalendarEventLink"]);
    const leases = collection(store);
    if (!await store.db.listCollections({ name: leases.collectionName }, { nameOnly: true }).next()) {
      await store.db.createCollection(leases.collectionName, { validator, validationLevel: "strict", validationAction: "error", collation: { locale: "simple" } });
    }
    await ready(store);
  });
}

type State = "ACTIVE" | "LOST" | "FINISHING" | "CLOSED";
type HeldLease = { port: MongoCalendarOperationLock; handle: LeaseHandle };
const globalForLease = globalThis as unknown as { hubOmMongoCalendarLease?: AsyncLocalStorage<HeldLease> };
const held = globalForLease.hubOmMongoCalendarLease ??= new AsyncLocalStorage<HeldLease>();
class LeaseHandle implements CalendarLockHandle {
  readonly signal: AbortSignal;
  readonly operationId: string;
  readonly owner: string;
  readonly generation: Long;
  private readonly port: MongoCalendarOperationLock;
  private readonly controller = new AbortController();
  private readonly deadline: number;
  private validUntil: number;
  private state: State = "ACTIVE";
  private lost: MongoOperationError | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private pendingRenew: Promise<void> | undefined;
  private tail: Promise<void> = Promise.resolve();
  constructor(port: MongoCalendarOperationLock, row: LeaseRow, start: number, acquireStart: number) {
    this.port = port; this.operationId = row._id; this.owner = row.owner!; this.generation = row.generation;
    this.deadline = start + CALENDAR_LEASE_TIMING.callbackMs;
    this.validUntil = acquireStart + CALENDAR_LEASE_TIMING.leaseMs - CALENDAR_LEASE_TIMING.marginMs;
    this.signal = this.controller.signal;
  }
  private lose(code: string): MongoOperationError {
    this.lost ??= new MongoOperationError(code);
    if (this.state === "ACTIVE") this.state = "LOST";
    clearTimeout(this.timer); clearTimeout(this.expiry);
    if (!this.signal.aborted) this.controller.abort(this.lost);
    return this.lost;
  }
  private check(finishing = false): void {
    if (this.lost) throw this.lost;
    if (this.state !== "ACTIVE" && !(finishing && this.state === "FINISHING")) throw this.lose("CALENDAR_LEASE_CLOSED");
    if (performance.now() >= Math.min(this.deadline, this.validUntil)) throw this.lose("CALENDAR_LEASE_EXPIRED");
  }
  private ioBudget(): number {
    return Math.max(1, Math.ceil(Math.min(CALENDAR_LEASE_TIMING.ioMs, this.deadline - performance.now(), this.validUntil - performance.now())));
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }
  private filter() {
    return { _id: this.operationId, owner: this.owner, generation: this.generation, $expr: { $gt: ["$leaseUntil", "$$NOW"] } };
  }
  private armExpiry(): void {
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => { this.lose("CALENDAR_LEASE_EXPIRED"); }, Math.max(1, Math.ceil(Math.min(this.deadline, this.validUntil) - performance.now())));
  }
  start(): void { this.check(); this.armExpiry(); this.schedule(); }
  private schedule(): void {
    if (this.state !== "ACTIVE") return;
    this.timer = setTimeout(() => {
      const task = this.exclusive(async () => { if (this.state === "ACTIVE") await this.renewUnsafe(); });
      this.pendingRenew = task;
      void task.catch(() => { this.lose("CALENDAR_LEASE_RENEW_FAILED"); }).finally(() => {
        if (this.pendingRenew === task) this.pendingRenew = undefined;
        this.schedule();
      });
    }, CALENDAR_LEASE_TIMING.renewMs);
  }
  /** Called only while holding the handle mutex. Never recursively acquire it. */
  private async renewUnsafe(): Promise<void> {
    this.check();
    const start = performance.now();
    try {
      const result = await this.port.leases.updateOne(this.filter(), [{ $set: {
        leaseUntil: { $dateAdd: { startDate: "$$NOW", unit: "millisecond", amount: CALENDAR_LEASE_TIMING.leaseMs } }
      } }], { timeoutMS: this.ioBudget(), writeConcern: concern });
      if (result.matchedCount !== 1) throw this.lose("CALENDAR_LEASE_LOST");
      // Late ACK cannot resurrect a lost lease or extend a completed callback.
      if (this.lost || performance.now() >= Math.min(this.deadline, this.validUntil)) throw this.lose("CALENDAR_LEASE_EXPIRED");
      if (this.state === "ACTIVE") {
        this.validUntil = start + CALENDAR_LEASE_TIMING.leaseMs - CALENDAR_LEASE_TIMING.marginMs;
        this.armExpiry();
      }
    } catch { throw this.lose("CALENDAR_LEASE_RENEW_FAILED"); }
  }
  private async verifyUnsafe(finishing = false): Promise<void> {
    this.check(finishing);
    try {
      const row = await this.port.leases.findOne(this.filter(), { projection: { _id: 1 }, timeoutMS: this.ioBudget(), readConcern: { level: "majority" } });
      this.check(finishing);
      if (!row) throw this.lose("CALENDAR_LEASE_LOST");
    } catch { throw this.lose("CALENDAR_LEASE_CHECK_FAILED"); }
  }
  assertActive(): Promise<void> { return this.exclusive(() => this.verifyUnsafe()); }
  async mapping<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.check();
      const reserve = CALENDAR_LEASE_TIMING.transactionMs + CALENDAR_LEASE_TIMING.ioMs + CALENDAR_LEASE_TIMING.marginMs;
      if (this.validUntil - performance.now() <= reserve) await this.renewUnsafe();
      this.check();
      const timeoutMS = Math.max(1, Math.ceil(Math.min(CALENDAR_LEASE_TIMING.transactionMs, this.deadline - performance.now())));
      const session = this.port.client.startSession();
      try {
        // Driver callback retries recheck the same owner; commit-ACK retries must
        // not execute a new guard or replay the outer Google callback.
        return await session.withTransaction(async () => {
          this.check();
          const result = await this.port.leases.updateOne(this.filter(), { $set: { nonce: randomUUID() } }, { session });
          if (result.matchedCount !== 1) throw this.lose("CALENDAR_LEASE_LOST");
          this.check();
          const value = await work(session);
          this.check();
          return value;
        }, { readConcern: { level: "snapshot" }, writeConcern: concern, readPreference: "primary", timeoutMS });
      } finally { await session.endSession(); }
    });
  }
  async finish(callbackFailed: boolean): Promise<void> {
    this.state = "FINISHING";
    clearTimeout(this.timer);
    try {
      try { await this.pendingRenew; } catch { this.lose("CALENDAR_LEASE_RENEW_FAILED"); }
      await this.tail;
      if (!callbackFailed) await this.verifyUnsafe(true);
    } finally {
      clearTimeout(this.expiry);
      try {
        await this.port.leases.updateOne({ _id: this.operationId, owner: this.owner, generation: this.generation },
          [{ $set: { owner: null, leaseUntil: "$$NOW", nonce: { $literal: randomUUID() } } }],
          { timeoutMS: CALENDAR_LEASE_TIMING.ioMs, writeConcern: concern });
      } catch { console.error("[gcal] CALENDAR_LEASE_RELEASE_FAILED"); }
      this.state = "CLOSED";
    }
  }
}

export class MongoCalendarOperationLock implements CalendarLockPort {
  readonly leases: Collection<LeaseRow>;
  readonly client: MongoOperationOptions["client"];
  private readonly options: MongoCalendarOptions;
  private constructor(options: MongoCalendarOptions, store: MongoOperationStore) {
    this.options = { ...options }; this.leases = collection(store); this.client = options.client;
  }
  static async open(options: MongoCalendarOptions): Promise<MongoCalendarOperationLock> {
    return safely("CALENDAR_LEASE_OPEN_FAILED", async () => {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, ["CalendarEventLink"]);
      await ready(store);
      return new MongoCalendarOperationLock(options, store);
    });
  }
  matches(options: MongoOperationOptions): boolean {
    return this.client === options.client && this.options.databaseName === options.databaseName && this.options.namespace === options.namespace;
  }
  async withLock<T>(operationId: string, work: (handle: CalendarLockHandle) => Promise<T>): Promise<T> {
    const current = held.getStore();
    if (current) {
      assertMongo(current.port === this && current.handle.operationId === operationId, "CALENDAR_SCOPE_MISMATCH");
      await current.handle.assertActive();
      return work(current.handle);
    }
    const start = performance.now(), owner = randomUUID();
    const handle = await safely("CALENDAR_LEASE_ACQUIRE_FAILED", async () => {
      try {
        await this.leases.insertOne({ _id: operationId, owner: null, generation: Long.ZERO, leaseUntil: new Date(0), nonce: randomUUID() },
          { timeoutMS: CALENDAR_LEASE_TIMING.ioMs, writeConcern: concern });
      } catch (error) {
        if (!(error instanceof MongoServerError && error.code === 11000
          && stableMongoValue(error.keyPattern) === stableMongoValue({ _id: 1 })
          && stableMongoValue(error.keyValue) === stableMongoValue({ _id: operationId }))) throw error;
      }
      const acquireStart = performance.now();
      const row = await this.leases.findOneAndUpdate({ _id: operationId, generation: { $lt: Long.MAX_VALUE },
        $expr: { $or: [{ $eq: ["$owner", null] }, { $lte: ["$leaseUntil", "$$NOW"] }] }
      }, [{ $set: { owner: { $literal: owner }, generation: { $add: ["$generation", Long.ONE] },
        leaseUntil: { $dateAdd: { startDate: "$$NOW", unit: "millisecond", amount: CALENDAR_LEASE_TIMING.leaseMs } }, nonce: { $literal: randomUUID() }
      } }], { returnDocument: "after", timeoutMS: CALENDAR_LEASE_TIMING.ioMs, writeConcern: concern });
      assertMongo(row && Long.isLong(row.generation) && row.owner === owner, "CALENDAR_LEASE_BUSY_OR_EXHAUSTED");
      return new LeaseHandle(this, row, start, acquireStart);
    });
    let failed = true;
    try {
      handle.start();
      const result = await held.run({ port: this, handle }, () => runWithLockedRepositoryScope(() => work(handle)));
      failed = false;
      return result;
    } finally { await handle.finish(failed); }
  }
  /** Mapping writes alone are fenced. This does not fence unrelated operation writers. */
  mapping<T>(operationId: string, work: (session: ClientSession) => Promise<T>): Promise<T> {
    const current = held.getStore();
    assertMongo(current?.port === this && current.handle.operationId === operationId, "CALENDAR_LEASE_REQUIRED");
    return current.handle.mapping(work);
  }
}
