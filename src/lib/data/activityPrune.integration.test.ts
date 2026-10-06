/** Parent-run only: Node24 --experimental-strip-types --experimental-test-module-mocks
 * --experimental-loader ./scripts/ts-loader.mjs --test THIS_FILE.
 * Actual native storage/transactions/withActivity; labelled clock/ACK faults are synthetic.
 * Actual CLI subprocess/default PG parity are covered by the separate parent/Volta suite.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { mock, test } from "node:test";
import { inspect } from "node:util";
import { AggregationCursor, BSON, ClientSession, Collection, Db, FindCursor, MongoClient, MongoServerError,
  type CommandStartedEvent, type Document } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoActivityPruneRepository, prepareMongoActivityPruneStore, pruneMongoActivityBatch } from "./mongoActivityPruneRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";

const URI = "mongodb://127.0.0.1:27858/?replicaSet=activityprune20260930";
const DBPATH = "/private/tmp/hub-om-activity-prune-20260930/mongo";
const CODE = "ACTIVITY_PRUNE_FAILED", PRIVATE = "synthetic-prune-private-value", CANARY = "synthetic-prune-error-canary";
const MODELS = ["ActivityRequest", "ActivityChange"] as const;
const DAY = 86_400_000, OLD = new Date("2000-01-01T00:00:00.000Z"), FUTURE = new Date("2100-01-01T00:00:00.000Z");
const FIXED = new Date("2026-09-30T12:00:00.000Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Counts = { requests: number; changes: number };
type Raw = { requests: Document[]; changes: Document[] };
function row(model: typeof MODELS[number], n: number, occurredAt = OLD): Document {
  const actor = { id: id(n), occurredAt, actorEmail: `${PRIVATE}@synthetic.invalid`, actorName: PRIVATE,
    actorType: "user", route: "/api/synthetic-prune", method: "POST" };
  return model === "ActivityRequest" ? { ...actor, status: 200, durationMs: 7 }
    : { ...actor, requestId: id(1), targetType: "Synthetic", targetId: "synthetic-target", action: "UPDATE",
      changes: { synthetic: { before: PRIVATE, after: "synthetic-after" }, nested: [null, false, 3] } };
}
function noLeaks(value: unknown) {
  const rendered = inspect(value, { depth: null, showHidden: true, maxArrayLength: null, maxStringLength: null });
  for (const marker of [PRIVATE, CANARY, "mongodb://synthetic-user:synthetic-secret@"]) assert.ok(!rendered.includes(marker), "Synthetic private marker leaked");
}
function fixed(error: unknown) {
  assert.ok(error instanceof Error); assert.equal(error.message, CODE); assert.equal(error.cause, undefined); noLeaks(error); return true;
}
function sameRaw(actual: Raw, expected: Raw) {
  for (const key of ["requests", "changes"] as const) {
    const canonical = (rows: Document[]) => rows.map(value => BSON.EJSON.stringify(value, { relaxed: false })).sort();
    assert.deepEqual(canonical(actual[key]), canonical(expected[key]), `Whole encrypted ${key} multiset`);
  }
}
function remaining(before: Raw, requests: string[], changes: string[]): Raw {
  return { requests: before.requests.filter(value => !requests.includes(String(value._id))),
    changes: before.changes.filter(value => !changes.includes(String(value._id))) };
}
function counts(actual: Counts, requests: number, changes: number) { assert.deepEqual(actual, { requests, changes }); }
function labelled(code: number, label?: string) {
  return new MongoServerError({ message: CANARY, code, ...(label ? { errorLabels: [label] } : {}) });
}
type Cursor = FindCursor | AggregationCursor;
function trace() {
  return {
    wire: [] as CommandStartedEvent[], logs: [] as unknown[][], errors: [] as unknown[],
    sessions: 0, ended: 0, attempts: 0, commits: 0, committed: 0, aborted: 0, closes: 0,
    txOptions: [] as unknown[], endOptions: [] as unknown[],
    operations: [] as Array<{ kind: string; collection: string; attempt: number; options: Document; filter?: Document; cursor?: Cursor;
      started: number; abortedAt?: number }>,
    cursorCloses: [] as Array<{ cursor: Cursor; options: unknown; completed: boolean }>,
    clocks: [] as Array<{ attempt: number; actual: Date; used: Date }>,
    deleted: [] as Array<{ collection: string; attempt: number; count: number }>,
    clockOverride: undefined as Date | undefined,
    afterClock: undefined as undefined | (() => Promise<void>),
    beforeDelete: undefined as undefined | ((collection: string) => Promise<void>),
    afterDelete: undefined as undefined | ((collection: string) => Promise<void>),
    commitFault: undefined as undefined | ((commit: () => Promise<void>) => Promise<void>)
  };
}
type Trace = ReturnType<typeof trace>;
const traces = new AsyncLocalStorage<Trace>();
function operation(t: Trace, input: Omit<Trace["operations"][number], "started">) {
  const call: Trace["operations"][number] = { ...input, started: performance.now() };
  t.operations.push(call);
  const signal = input.options.signal;
  if (signal instanceof AbortSignal) signal.addEventListener("abort", () => { call.abortedAt = performance.now(); }, { once: true });
}
function barrier() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function bounded<T>(promise: Promise<T>, ms = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("PRUNE_FIXTURE_BARRIER_TIMEOUT")), ms);
  })]); } finally { if (timer) clearTimeout(timer); }
}

test("activity prune native server clock, atomic batches, retry/ACK and automatic request retention", {
  skip: process.env.ACTIVITY_PRUNE_DATABASE_TESTS !== "1", timeout: 300_000
}, async root => {
  assert.equal(process.env.ACTIVITY_PRUNE_TEST_MONGO_URI, URI);
  const keys = ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DEV_AUTH_BYPASS"];
  for (const key of keys) assert.equal(process.env[key], undefined, `Sanitized worker required: ${key}`);
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ prunefixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "prunefixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    DEV_AUTH_BYPASS: "false", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/prune-tripwire" });
  let pg = 0, external = 0, authCalls = 0;
  const restores: Array<() => void> = [], owned: string[] = [];
  const pgMock = mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
    constructor() { pg++; throw new Error("PRUNE_PG_TRIPWIRE"); }
  } } }); restores.push(() => pgMock.restore());
  const auth = mock.module("@/auth", { namedExports: { auth: async () => { authCalls++; return null; } } }); restores.push(() => auth.restore());
  const fetchMock = mock.method(globalThis, "fetch", async () => { external++; throw new Error("PRUNE_EXTERNAL_TRIPWIRE"); });
  restores.push(() => fetchMock.mock.restore());
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level], hook = mock.method(console, level, (...args: unknown[]) => {
      const t = traces.getStore(); if (t) t.logs.push(args); else original.apply(console, args);
    }); restores.push(() => hook.mock.restore());
  }
  const aggregate = Db.prototype.aggregate;
  const aggregateHook = mock.method(Db.prototype, "aggregate", function(this: Db, ...args: Parameters<Db["aggregate"]>) {
    const cursor = aggregate.apply(this, args), t = traces.getStore();
    if (t) operation(t, { kind: "clock", collection: "", attempt: t.attempts, options: { ...args[1] }, cursor });
    return cursor;
  }); restores.push(() => aggregateHook.mock.restore());
  const aggregateNext = AggregationCursor.prototype.next;
  const clockHook = mock.method(AggregationCursor.prototype, "next", async function(this: AggregationCursor, ...args: Parameters<AggregationCursor["next"]>) {
    const t = traces.getStore(); let result: Document | null;
    try { result = await aggregateNext.apply(this, args); } catch (error) { t?.errors.push(error); throw error; }
    if (t && result && Object.hasOwn(result, "serverNow")) {
      const actual = result.serverNow, used = t.clockOverride ?? actual;
      t.clocks.push({ attempt: t.attempts, actual, used });
      if (t.afterClock) await t.afterClock();
      return { ...result, serverNow: used };
    }
    return result;
  }); restores.push(() => clockHook.mock.restore());
  const find = Collection.prototype.find;
  const findHook = mock.method(Collection.prototype, "find", function(this: Collection, ...args: Parameters<Collection["find"]>) {
    const cursor = find.apply(this, args), t = traces.getStore();
    if (t) operation(t, { kind: "find", collection: this.collectionName, attempt: t.attempts,
      options: { ...args[1] }, filter: structuredClone(args[0] ?? {}), cursor });
    return cursor;
  }); restores.push(() => findHook.mock.restore());
  const deleteMany = Collection.prototype.deleteMany;
  const deleteHook = mock.method(Collection.prototype, "deleteMany", async function(this: Collection, ...args: Parameters<Collection["deleteMany"]>) {
    const t = traces.getStore();
    if (t) {
      operation(t, { kind: "delete", collection: this.collectionName, attempt: t.attempts, options: { ...args[1] }, filter: structuredClone(args[0] ?? {}) });
      if (t.beforeDelete) await t.beforeDelete(this.collectionName);
    }
    let result;
    try { result = await deleteMany.apply(this, args); } catch (error) { t?.errors.push(error); throw error; }
    if (t) { t.deleted.push({ collection: this.collectionName, attempt: t.attempts, count: result.deletedCount }); if (t.afterDelete) await t.afterDelete(this.collectionName); }
    return result;
  }); restores.push(() => deleteHook.mock.restore());
  for (const prototype of [FindCursor.prototype, AggregationCursor.prototype]) {
    const close = prototype.close;
    const hook = mock.method(prototype, "close", async function(this: Cursor, ...args: Parameters<Cursor["close"]>) {
      const t = traces.getStore(), attempt = { cursor: this, options: args[0], completed: false }; t?.cursorCloses.push(attempt);
      const result = await close.apply(this, args); attempt.completed = true; return result;
    }); restores.push(() => hook.mock.restore());
  }
  const startSession = MongoClient.prototype.startSession;
  const startHook = mock.method(MongoClient.prototype, "startSession", function(this: MongoClient, ...args: Parameters<MongoClient["startSession"]>) {
    const session = startSession.apply(this, args), t = traces.getStore();
    if (t && session.explicit) {
      t.sessions++; const end = session.endSession.bind(session);
      const hook = mock.method(session, "endSession", async (...options: Parameters<typeof end>) => {
        t.endOptions.push(options[0]); const result = await end(...options); t.ended++; return result;
      }); restores.push(() => hook.mock.restore());
    }
    return session;
  }); restores.push(() => startHook.mock.restore());
  const startTransaction = ClientSession.prototype.startTransaction;
  const transactionHook = mock.method(ClientSession.prototype, "startTransaction", function(this: ClientSession, ...args: Parameters<ClientSession["startTransaction"]>) {
    const t = traces.getStore(); if (t) { t.attempts++; t.txOptions.push(args[0]); } return startTransaction.apply(this, args);
  }); restores.push(() => transactionHook.mock.restore());
  const commit = ClientSession.prototype.commitTransaction;
  const commitHook = mock.method(ClientSession.prototype, "commitTransaction", async function(this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
    const t = traces.getStore(); if (t) t.commits++;
    const delegate = async () => { await commit.apply(this, args); if (t) t.committed++; };
    return t?.commitFault ? t.commitFault(delegate) : delegate();
  }); restores.push(() => commitHook.mock.restore());
  const abort = ClientSession.prototype.abortTransaction;
  const abortHook = mock.method(ClientSession.prototype, "abortTransaction", async function(this: ClientSession, ...args: Parameters<ClientSession["abortTransaction"]>) {
    const result = await abort.apply(this, args); const t = traces.getStore(); if (t) t.aborted++; return result;
  }); restores.push(() => abortHook.mock.restore());
  const closeClient = MongoClient.prototype.close;
  const closeHook = mock.method(MongoClient.prototype, "close", function(this: MongoClient, ...args: Parameters<MongoClient["close"]>) {
    const t = traces.getStore(); if (t) t.closes++; return closeClient.apply(this, args);
  }); restores.push(() => closeHook.mock.restore());
  const appName = `synthetic-prune-${randomBytes(6).toString("hex")}`;
  const client = new MongoClient(URI, { appName, directConnection: true, serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const control = new MongoClient(URI, { appName: `${appName}-control`, directConnection: true, serverSelectionTimeoutMS: 5000 });
  client.on("commandStarted", event => traces.getStore()?.wire.push(event));
  let resetNeeded = false;
  async function reset() { await control.db("admin").command({ configureFailPoint: "failCommand", mode: "off" }, { timeoutMS: 20_000 }); resetNeeded = false; }
  try {
    const { withActivity } = await import("../activity/request");
    const { runActivityPruneCommand } = await import("./activityPruneCommand");
    const { getPrismaClient } = await import("./prisma");
    assert.throws(() => getPrismaClient(), /PRUNE_PG_TRIPWIRE/); assert.equal(pg, 1); pg = 0;
    await Promise.all([client.connect(), control.connect()]);
    const hello = await control.db("admin").command({ hello: 1 }); assert.equal(hello.setName, "activityprune20260930");
    assert.deepEqual(hello.hosts, ["127.0.0.1:27858"]);
    assert.equal((await control.db("admin").command({ getCmdLineOpts: 1 })).parsed?.storage?.dbPath, DBPATH);
    const parameters = await control.db("admin").command({ getParameter: 1, enableTestCommands: 1 });
    assert.ok(parameters.enableTestCommands === true || parameters.enableTestCommands === 1);
    async function create(audit = false) {
      const databaseName = `hub_om_shadow_prune_${randomBytes(8).toString("hex")}`; assert.ok(databaseName.length <= 63);
      assert.equal((await client.db(databaseName).listCollections().toArray()).length, 0); owned.push(databaseName);
      const options = { client, databaseName, namespace: "shadow_prune", allowShadowWrites: true as const };
      await prepareMongoActivityPruneStore(options);
      if (audit) await prepareMongoRequestAuditStore(options);
      const store = new MongoOperationStore(options, audit ? REQUEST_AUDIT_MODELS : MODELS);
      const repo = await MongoActivityPruneRepository.open(options);
      return { options, store, repo };
    }
    type Native = Awaited<ReturnType<typeof create>>;
    async function seed(a: Native, requests: Document[], changes: Document[]) {
      for (const [model, rows] of [["ActivityRequest", requests], ["ActivityChange", changes]] as const) {
        if (rows.length) await a.store.collection(model).insertMany(rows.map(value => encodeMongoRuntimeDocument(model, value)));
      }
    }
    async function raw(a: Native): Promise<Raw> {
      const options = { timeoutMS: 5000 };
      return { requests: await a.store.collection("ActivityRequest").find({}, options).sort({ _id: 1 }).toArray(),
        changes: await a.store.collection("ActivityChange").find({}, options).sort({ _id: 1 }).toArray() };
    }
    const invoke = (a: Native, t: Trace) => traces.run(t, () => runWithDataRepositories({ activityPrune: a.repo }, () => a.repo.pruneBatch()));
    function observe(t: Trace, totalMax = 10_000) {
      assert.equal(pg, 0); assert.equal(external, 0); assert.equal(t.closes, 0); assert.equal(t.ended, t.sessions); noLeaks(t.logs);
      for (const option of t.endOptions) assert.deepEqual(option, { timeoutMS: 5000 });
      for (const options of t.txOptions as Document[]) assert.ok(options.timeoutMS > 0 && options.timeoutMS <= totalMax);
      for (const operation of t.operations.filter(item => item.options.session?.explicit)) {
        assert.equal(operation.options.timeoutMS, undefined, "Driver disallows per-operation CSOT inside withTransaction");
        assert.ok(operation.options.signal instanceof AbortSignal, "Actual IO receives the operation abort signal");
        if (operation.cursor) {
          const boundedCloses = t.cursorCloses.filter(call => call.cursor === operation.cursor
            && (call.options as { timeoutMS?: number } | undefined)?.timeoutMS === 5000);
          assert.ok(boundedCloses.length > 0 && boundedCloses.every(call => call.completed), "Bounded cursor close must complete");
        }
      }
      for (const event of t.wire) {
        assert.notEqual(event.commandName, "getMore", "Bounded 1000-row projection must not issue getMore under transaction CSOT");
        assert.ok(!["create", "createIndexes", "collMod", "drop", "dropDatabase", "update"].includes(event.commandName));
        if (["find", "delete", "insert"].includes(event.commandName)) assert.ok(MODELS.some(model => event.command[event.commandName] === `shadow_prune_${model}`));
      }
    }
    function serverClock(t: Trace) {
      assert.equal(t.clocks.length, t.attempts);
      for (let attempt = 1; attempt <= t.attempts; attempt++) {
        const clocks = t.clocks.filter(clock => clock.attempt === attempt); assert.equal(clocks.length, 1);
        const clock = clocks[0]; assert.ok(clock.actual instanceof Date && Number.isFinite(clock.actual.getTime()));
        const ops = t.operations.filter(operation => operation.attempt === attempt && operation.options.session?.explicit);
        assert.equal(ops.filter(operation => operation.kind === "clock").length, 1);
        for (const operation of ops.filter(operation => operation.kind === "find" || operation.kind === "delete")) {
          const days = operation.collection.endsWith("_ActivityRequest") ? 30 : 365;
          assert.deepEqual(operation.filter?.occurredAt, { $lt: new Date(clock.used.getTime() - days * DAY) });
          assert.equal(operation.options.session, ops[0].options.session);
        }
      }
      const wire = t.wire.filter(event => event.commandName === "aggregate"); assert.equal(wire.length, t.attempts);
      for (const [index, event] of wire.entries()) {
        assert.equal(event.command.aggregate, 1);
        assert.deepEqual(event.command.pipeline, [{ $documents: [{}] }, { $project: { _id: 0, serverNow: "$$NOW" } }]);
        assert.equal(event.command.autocommit, false); assert.equal(event.command.startTransaction, true);
        assert.equal(event.command.readConcern?.level, "snapshot");
        const nextClock = wire[index + 1], start = t.wire.indexOf(event), end = nextClock ? t.wire.indexOf(nextClock) : t.wire.length;
        for (const request of t.wire.slice(start + 1, end).filter(value => value.commandName === "find" || value.commandName === "delete")) {
          // Request audit inserts are outside this transaction; no observer reads
          // are allowed to masquerade as the native retention scans.
          assert.deepEqual(request.command.lsid, event.command.lsid);
          assert.deepEqual(request.command.txnNumber, event.command.txnNumber);
          assert.equal(request.command.autocommit, false);
          const model = request.command[request.commandName], days = model.endsWith("_ActivityRequest") ? 30 : 365;
          const filter = request.commandName === "find" ? request.command.filter : request.command.deletes[0].q;
          assert.deepEqual(filter.occurredAt, { $lt: new Date(t.clocks[index].used.getTime() - days * DAY) });
          if (request.commandName === "find") {
            // Driver may send batchSize=1001 when the configured limit is 1000.
            assert.equal(request.command.limit, 1000); assert.equal(request.command.singleBatch, true);
          }
        }
      }
    }
    async function drain(a: Native, t: Trace) {
      let requests = 0, changes = 0, batches = 0;
      while (true) {
        const value = await invoke(a, t); requests += value.requests; changes += value.changes; batches++;
        if (value.requests < 1000 && value.changes < 1000) return { requests, changes, batches };
        assert.ok(batches < 10, "Bounded fixture drain");
      }
    }

    await root.test("oracle negatives reject partial rollback, duplicate counts, missing survivor, and untruncated private errors", async () => {
      const expected: Raw = { requests: [{ _id: id(1), value: "encrypted-synthetic" }], changes: [{ _id: id(2), value: "unchanged" }] };
      assert.throws(() => sameRaw({ ...expected, requests: [] }, expected));
      assert.throws(() => sameRaw({ ...expected, changes: [...expected.changes, ...expected.changes] }, expected));
      assert.throws(() => counts({ requests: 2, changes: 1 }, 1, 1));
      assert.throws(() => noLeaks([...Array(101).fill("safe"), CANARY])); assert.throws(() => noLeaks("x".repeat(20000) + PRIVATE));
    });
    await root.test("actual collectionless server clock on empty and populated collections; local Date.now is not cutoff authority", async () => {
      const a = await create(), empty = trace(); counts(await invoke(a, empty), 0, 0); serverClock(empty); observe(empty);
      await seed(a, [row("ActivityRequest", 1), row("ActivityRequest", 2, FUTURE)], [row("ActivityChange", 3), row("ActivityChange", 4, FUTURE)]);
      const before = await raw(a); noLeaks(before);
      assert.match(String(before.requests[0].actorName), /^pii:v1:prunefixture:/);
      assert.match(String(before.requests[0].actorEmailPiiIndex), /^[a-f0-9]{64}$/);
      const local = mock.method(Date, "now", () => Date.parse("2200-01-01T00:00:00.000Z")), t = trace();
      try { counts(await invoke(a, t), 1, 1); } finally { local.mock.restore(); }
      serverClock(t); observe(t); sameRaw(await raw(a), remaining(before, [id(1)], [id(3)]));
      assert.ok(t.clocks[0].actual.getTime() < FUTURE.getTime());
    });
    await root.test("synthetic clock AFTER native aggregate: exact 30/365-day strict-less boundaries and non-FK change survive", async () => {
      const a = await create(), t = trace(); t.clockOverride = FIXED;
      const requestCutoff = FIXED.getTime() - 30 * DAY, changeCutoff = FIXED.getTime() - 365 * DAY;
      await seed(a, [-1, 0, 1].map((delta, n) => row("ActivityRequest", n + 1, new Date(requestCutoff + delta))),
        [-1, 0, 1].map((delta, n) => row("ActivityChange", n + 11, new Date(changeCutoff + delta))));
      const before = await raw(a); counts(await invoke(a, t), 1, 1); serverClock(t); observe(t);
      sameRaw(await raw(a), remaining(before, [id(1)], [id(11)]));
      assert.equal((await raw(a)).changes[0].requestId, id(1));
    });
    await root.test("101/999/1000/1001, date ties and exact full batches drain once; getMore zero, replay zero, ciphertext unchanged", async () => {
      for (const size of [101, 999, 1000, 1001]) {
        const a = await create();
        await seed(a, Array.from({ length: size }, (_, n) => row("ActivityRequest", n + 1)),
          [row("ActivityChange", 20000, FUTURE)]);
        const before = await raw(a), t = trace(), first = await invoke(a, t);
        counts(first, Math.min(size, 1000), 0); observe(t); serverClock(t);
        const after = await raw(a), deleted = before.requests.filter(value => !after.requests.some(kept => kept._id === value._id));
        assert.equal(deleted.length, Math.min(size, 1000)); assert.equal(after.requests.length, Math.max(0, size - 1000));
        // All candidates tie: accept any subset of the native candidate set, never force a tie ID.
        assert.ok(after.requests.every(value => before.requests.some(candidate => candidate._id === value._id)));
        sameRaw(after, remaining(before, deleted.map(value => String(value._id)), []));
        const finish = trace(); assert.deepEqual(await drain(a, finish), { requests: size > 1000 ? 1 : 0, changes: 0, batches: 1 }); observe(finish);
        const replay = trace(); counts(await invoke(a, replay), 0, 0); observe(replay);
        sameRaw(await raw(a), { requests: [], changes: before.changes });
        for (const event of t.wire.filter(event => event.commandName === "find")) {
          assert.equal(event.command.limit, 1000);
          const sort = event.command.sort; assert.deepEqual(sort instanceof Map ? [...sort] : Object.entries(sort), [["occurredAt", 1]]);
        }
      }
      const a = await create();
      await seed(a, Array.from({ length: 1000 }, (_, n) => row("ActivityRequest", n + 1)),
        Array.from({ length: 1001 }, (_, n) => row("ActivityChange", n + 2001)));
      const t = trace(), summaries: unknown[] = []; let envLoads = 0;
      const summary = await traces.run(t, () => runWithDataRepositories({ activityPrune: a.repo }, () =>
        runActivityPruneCommand(() => { envLoads++; }, value => summaries.push(value))));
      assert.deepEqual(summary, { deletedRequests: 1000, deletedChanges: 1001 }); assert.deepEqual(summaries, [summary]);
      assert.equal(envLoads, 0); assert.equal(t.sessions, 2); observe(t); serverClock(t); sameRaw(await raw(a), { requests: [], changes: [] });
    });
    await root.test("actual second-delete server fault rolls back first deletion; committed earlier command batch survives and emits no summary", async () => {
      const a = await create();
      await seed(a, Array.from({ length: 1001 }, (_, n) => row("ActivityRequest", n + 1, new Date(OLD.getTime() + n))),
        Array.from({ length: 1001 }, (_, n) => row("ActivityChange", n + 2001, new Date(OLD.getTime() + n))));
      const before = await raw(a), t = trace(); let armed = 0;
      // Actual native nontransient error on second delete of the SECOND batch.
      t.beforeDelete = async collection => {
        if (t.attempts !== 2 || !collection.endsWith("_ActivityChange")) return;
        await control.db("admin").command({ configureFailPoint: "failCommand", mode: { times: 1 },
          data: { failCommands: ["delete"], appName, errorCode: 2 } }); resetNeeded = true; armed++;
      };
      const summaries: unknown[] = [];
      try {
        await assert.rejects(traces.run(t, () => runWithDataRepositories({ activityPrune: a.repo }, () =>
          runActivityPruneCommand(() => { throw new Error("ENV_MUST_NOT_LOAD"); }, summary => summaries.push(summary)))), fixed);
      } finally { if (resetNeeded) await reset(); }
      assert.equal(armed, 1); assert.deepEqual(summaries, []); assert.equal(t.committed, 1); assert.equal(t.aborted, 1);
      assert.ok(t.errors.some(error => error instanceof MongoServerError && error.code === 2)); observe(t); serverClock(t);
      assert.ok(t.deleted.some(value => value.attempt === 2 && value.collection.endsWith("_ActivityRequest") && value.count === 1));
      sameRaw(await raw(a), remaining(before, Array.from({ length: 1000 }, (_, n) => id(n + 1)), Array.from({ length: 1000 }, (_, n) => id(n + 2001))));
      const retry = trace(); counts(await invoke(a, retry), 1, 1); observe(retry); sameRaw(await raw(a), { requests: [], changes: [] });
    });
    await root.test("synthetic transient after actual first deletion: failed attempt rolls back, fresh server time, successful counts only once", async () => {
      const a = await create(); await seed(a, [row("ActivityRequest", 1), row("ActivityRequest", 2, FUTURE)], [row("ActivityChange", 3)]);
      const before = await raw(a), t = trace(); let faults = 0;
      t.afterDelete = async collection => { if (!faults && collection.endsWith("_ActivityRequest")) { faults++; throw labelled(112, "TransientTransactionError"); } };
      counts(await invoke(a, t), 1, 1); assert.equal(faults, 1); assert.equal(t.attempts, 2); assert.equal(t.aborted, 1); assert.equal(t.committed, 1);
      assert.deepEqual(t.deleted.map(value => [value.attempt, value.count]), [[1, 1], [2, 1], [2, 1]]);
      serverClock(t); observe(t); sameRaw(await raw(a), remaining(before, [id(1)], [id(3)]));
    });
    await root.test("synthetic commit ACK retry versus terminal unknown-after-real-commit: raw observation distinguishes committed deletion", async () => {
      for (const mode of ["retry-ack", "terminal-unknown"] as const) {
        const a = await create(); await seed(a, [row("ActivityRequest", 1), row("ActivityRequest", 2, FUTURE)], [row("ActivityChange", 3)]);
        const before = await raw(a), t = trace(); let faults = 0;
        t.commitFault = async delegate => {
          await delegate(); if (!faults) { faults++; throw labelled(mode === "retry-ack" ? 91 : 50, "UnknownTransactionCommitResult"); }
        };
        if (mode === "retry-ack") counts(await invoke(a, t), 1, 1); else await assert.rejects(invoke(a, t), fixed);
        assert.equal(faults, 1); assert.equal(t.attempts, 1); assert.equal(t.commits, mode === "retry-ack" ? 2 : 1);
        assert.equal(t.aborted, 0); observe(t); serverClock(t);
        // Deliberate terminal-labelled fault after ACK: observe independently before
        // any repair. This is NOT evidence of rollback, zero deletion, or a real lost packet.
        sameRaw(await raw(a), remaining(before, [id(1)], [id(3)]));
        const replay = trace(); counts(await invoke(a, replay), 0, 0); observe(replay);
      }
    });
    await root.test("A/B overlap and same-namespace concurrent drains conserve deleted counts and exact retained raw sets", async () => {
      const a = await create(), b = await create();
      await seed(a, [row("ActivityRequest", 1), row("ActivityRequest", 2, FUTURE)], [row("ActivityChange", 3)]);
      await seed(b, [row("ActivityRequest", 101)], [row("ActivityChange", 103), row("ActivityChange", 104, FUTURE)]);
      const beforeA = await raw(a), beforeB = await raw(b), entered = barrier(), release = barrier(), ta = trace(), tb = trace();
      ta.afterClock = async () => { entered.release(); await bounded(release.promise); };
      const pending = invoke(a, ta);
      try {
        await bounded(Promise.race([entered.promise, pending.then(() => { throw new Error("PRUNE_BARRIER_MISSED"); })]));
        counts(await invoke(b, tb), 1, 1); release.release(); counts(await pending, 1, 1);
      } finally { release.release(); await pending; }
      observe(ta); observe(tb); serverClock(ta); serverClock(tb);
      assert.ok(ta.wire.every(event => event.databaseName === a.options.databaseName || event.databaseName === "admin"));
      assert.ok(tb.wire.every(event => event.databaseName === b.options.databaseName || event.databaseName === "admin"));
      sameRaw(await raw(a), remaining(beforeA, [id(1)], [id(3)])); sameRaw(await raw(b), remaining(beforeB, [id(101)], [id(103)]));
      const c = await create(); await seed(c, Array.from({ length: 1201 }, (_, n) => row("ActivityRequest", n + 1)),
        [...Array.from({ length: 1001 }, (_, n) => row("ActivityChange", n + 2001)), row("ActivityChange", 9999, FUTURE)]);
      const beforeC = await raw(c), t1 = trace(), t2 = trace(), both = barrier(); let enteredCount = 0;
      const hold = async () => { if (++enteredCount <= 2) { if (enteredCount === 2) both.release(); await bounded(both.promise); } };
      t1.afterClock = hold; t2.afterClock = hold;
      const results = await Promise.all([drain(c, t1), drain(c, t2)]);
      counts({ requests: results[0].requests + results[1].requests, changes: results[0].changes + results[1].changes }, 1201, 1001);
      observe(t1); observe(t2); serverClock(t1); serverClock(t2);
      sameRaw(await raw(c), { requests: [], changes: beforeC.changes.filter(value => value._id === id(9999)) });
    });
    await root.test("actual withActivity one batch/hour and second-delete rollback: request insert and business response survive, fixed failure log", async () => {
      const a = await create(true), audit = await MongoRequestAuditRepository.open(a.options);
      await seed(a, Array.from({ length: 1001 }, (_, n) => row("ActivityRequest", n + 1)),
        Array.from({ length: 1001 }, (_, n) => row("ActivityChange", n + 2001)));
      const handler = withActivity("/api/synthetic-prune", "POST", async (request: Request) => {
        assert.equal(request.method, "POST"); return Response.json({ accepted: true });
      });
      async function request(t: Trace) {
        const response = await traces.run(t, () => runWithDataRepositories({ requestActivity: audit }, () =>
          handler(new Request("http://synthetic.invalid/api/synthetic-prune", { method: "POST", headers: { authorization: "Bearer synthetic" } }))));
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), { accepted: true });
        const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
        const stored = await a.store.one("ActivityRequest", { _id: requestId }); assert.ok(stored);
        assert.equal(stored.status, 200); assert.equal(stored.actorType, "token_request"); assert.equal(stored.route, "/api/synthetic-prune");
        observe(t, 4000); return requestId;
      }
      let localNow = Date.now(); const localClock = mock.method(Date, "now", () => localNow);
      try {
        const before = await raw(a), first = trace(); const requestId = await request(first);
        assert.equal(first.attempts, 1); serverClock(first); assert.deepEqual(first.logs, []);
        const after = await raw(a); assert.equal(after.requests.length, 2); assert.equal(after.changes.length, 1);
        assert.ok(after.requests.some(value => value._id === requestId));
        const keptRequests = after.requests.filter(value => value._id !== requestId);
        sameRaw({ requests: keptRequests, changes: after.changes }, {
          requests: before.requests.filter(value => keptRequests.some(kept => kept._id === value._id)),
          changes: before.changes.filter(value => after.changes.some(kept => kept._id === value._id))
        });
        const second = trace(); await request(second); assert.equal(second.attempts, 0);
        localNow += 3_600_000; const exactHour = trace(); await request(exactHour); assert.equal(exactHour.attempts, 0);
        localNow++; const failed = trace(), beforeFailure = await raw(a); let faults = 0;
        failed.beforeDelete = async collection => { if (collection.endsWith("_ActivityChange")) { faults++; throw new Error(CANARY); } };
        const inserted = await request(failed); assert.equal(faults, 1); assert.equal(failed.aborted, 1);
        assert.deepEqual(failed.logs, [["[activity] retention cleanup failed"]]); serverClock(failed);
        const afterFailure = await raw(a); sameRaw({ requests: afterFailure.requests.filter(value => value._id !== inserted), changes: afterFailure.changes }, beforeFailure);
        const noRetry = trace(); await request(noRetry); assert.equal(noRetry.attempts, 0);
        localNow += 3_600_001; const recovered = trace(); await request(recovered); assert.equal(recovered.attempts, 1);
        assert.deepEqual(recovered.deleted.map(value => value.count), [1, 1]); assert.deepEqual(recovered.logs, []);
        const final = await raw(a); assert.equal(final.changes.length, 0); assert.equal(final.requests.length, 6);
        assert.equal(authCalls, 0);
      } finally { localClock.mock.restore(); }
    });
    await root.test("actual API blocked find aborts at operation 1500ms; retry cannot reset helper's cumulative 4000ms budget", async () => {
      for (const mode of ["actual-api-operation", "helper-retry-total"] as const) {
        const a = await create(true); await seed(a, [row("ActivityRequest", 1)], [row("ActivityChange", 2)]);
        const before = await raw(a), t = trace(); let armed = 0, faultEntries = -1;
        async function arm(command: string) {
          const result = await control.db("admin").command({ configureFailPoint: "failCommand", mode: { times: 1 },
            data: { failCommands: [command], appName, blockConnection: true, blockTimeMS: 7000 } });
          resetNeeded = true; faultEntries = result.count; armed++;
        }
        let response: Response | undefined;
        const delay = () => new Promise<void>(resolve => setTimeout(resolve, 900));
        if (mode === "helper-retry-total") {
          t.afterClock = async () => { if (t.attempts === 1) await delay(); };
          t.afterDelete = async collection => {
            if (t.attempts !== 1) return;
            await delay(); if (collection.endsWith("_ActivityChange")) throw labelled(112, "TransientTransactionError");
          };
          t.beforeDelete = async collection => {
            if (t.attempts === 2 && collection.endsWith("_ActivityRequest")) await arm("delete");
          };
        }
        try {
          const audit = await MongoRequestAuditRepository.open(a.options);
          const handler = withActivity("/api/synthetic-prune-bound", "POST", async (request: Request) => {
            assert.equal(request.method, "POST"); return Response.json({ accepted: true });
          });
          if (mode === "actual-api-operation") await arm("find");
          const started = performance.now();
          if (mode === "actual-api-operation") {
            response = await traces.run(t, () => runWithDataRepositories({ requestActivity: audit }, () => handler(new Request(
              "http://synthetic.invalid/api/synthetic-prune-bound", { method: "POST", headers: { authorization: "Bearer synthetic" } }))));
            assert.equal(response.status, 200); assert.deepEqual(await response.json(), { accepted: true });
            assert.deepEqual(t.logs, [["[activity] retention cleanup failed"]]);
          } else {
            await assert.rejects(traces.run(t, () => pruneMongoActivityBatch(a.store, { timeoutMS: 4000, operationTimeoutMS: 1500 })), fixed);
          }
          const elapsed = performance.now() - started;
          assert.equal(armed, 1); assert.ok(Number.isInteger(faultEntries));
          await control.db("admin").command({ waitForFailPoint: "failCommand", timesEntered: faultEntries + 1, maxTimeMS: 1000 }, { timeoutMS: 2000 });
          const aborted = t.operations.filter(value => value.abortedAt !== undefined);
          assert.equal(aborted.length, 1); const call = aborted[0];
          assert.equal(call.collection, "shadow_prune_ActivityRequest");
          assert.equal(call.kind, mode === "actual-api-operation" ? "find" : "delete");
          assert.ok(call.options.signal.aborted); assert.equal(call.options.signal.reason.message, CODE);
          const operationElapsed = call.abortedAt! - call.started;
          const timing = { mode, attempts: t.attempts, operationElapsedMs: operationElapsed,
            abortSinceStartMs: call.abortedAt! - started, settledElapsedMs: elapsed };
          // Fixed labels and numeric durations only: no driver error or command payload.
          console.info("[activity-prune-native] timing", JSON.stringify(timing));
          if (mode === "actual-api-operation") {
            assert.equal(t.attempts, 1); assert.ok(operationElapsed >= 1200 && operationElapsed < 1900, JSON.stringify(timing));
          } else {
            assert.equal(t.attempts, 2); assert.ok(operationElapsed > 0 && operationElapsed < 1500, JSON.stringify(timing));
            assert.ok(elapsed >= 3500 && elapsed < 6000, JSON.stringify(timing));
            assert.ok(call.abortedAt! - started < 4500, `Retry must not renew the total operation budget: ${JSON.stringify(timing)}`);
          }
          observe(t, 4000); serverClock(t);
          await reset();
          // Eventual server quiescence after failpoint release, not an assertion
          // that client cancellation instantly terminated server-side work.
          const appFilter = { $or: [{ appName }, { "clientMetadata.application.name": appName }] };
          const sessionId = t.wire.find(event => event.commandName === "aggregate")?.command.lsid;
          assert.ok(sessionId);
          const commands = ["hello", "ismaster", "aggregate", "find", "delete", "getMore", "killCursors", "commitTransaction", "abortTransaction"];
          function commandCounts(rows: Document[]) {
            const result: Record<string, number> = Object.fromEntries([...commands, "other"].map(name => [name, 0]));
            for (const entry of rows) result[commands.find(name => Object.hasOwn(entry.command ?? {}, name)) ?? "other"]++;
            return result;
          }
          const initial = await control.db("admin").command({ currentOp: 1, active: true, ...appFilter }, { timeoutMS: 3000 });
          assert.ok(Array.isArray(initial.inprog));
          console.info("[activity-prune-native] active-command-counts", JSON.stringify({ mode, ...commandCounts(initial.inprog) }));
          // The driver's awaitable hello is routinely active for the same appName.
          // Require zero owned retention IO and transaction cleanup, not zero
          // monitoring activity on a healthy borrowed MongoClient.
          const ownedWork = { $or: [
            { "command.$db": a.options.databaseName, $or: [
              { "command.aggregate": 1 }, { "command.find": { $in: ["shadow_prune_ActivityRequest", "shadow_prune_ActivityChange"] } },
              { "command.delete": { $in: ["shadow_prune_ActivityRequest", "shadow_prune_ActivityChange"] } },
              { "command.getMore": { $exists: true } }, { "command.killCursors": { $exists: true } }
            ] },
            { "command.lsid": sessionId, $or: [{ "command.commitTransaction": 1 }, { "command.abortTransaction": 1 }] }
          ] };
          const deadline = performance.now() + 20_000;
          while (true) {
            const current = await control.db("admin").command({ currentOp: 1, active: true,
              $and: [appFilter, ownedWork] }, { timeoutMS: 3000 });
            assert.ok(Array.isArray(current.inprog)); if (!current.inprog.length) break;
            assert.ok(performance.now() < deadline, JSON.stringify({ mode, pending: commandCounts(current.inprog) }));
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          const after = await raw(a), requestId = response?.headers.get("X-Request-Id");
          if (mode === "actual-api-operation") {
            assert.ok(requestId); assert.equal(after.requests.filter(value => value._id === requestId).length, 1);
            sameRaw({ requests: after.requests.filter(value => value._id !== requestId), changes: after.changes }, before);
          } else sameRaw(after, before);
          const recovery = trace(); counts(await invoke(a, recovery), 1, 1); observe(recovery);
          const recovered = await raw(a); assert.equal(recovered.changes.length, 0);
          assert.deepEqual(recovered.requests.map(value => value._id), requestId ? [requestId] : []);
        } finally { if (resetNeeded) await reset(); }
      }
    });
    await root.test("two-model readiness, explicit write gate, immutable mismatch, fixed Error/non-Error and borrowed close", async () => {
      const a = await create();
      assert.deepEqual((await a.store.db.listCollections({}, { nameOnly: true }).toArray()).map(value => value.name).sort(),
        ["shadow_prune_ActivityChange", "shadow_prune_ActivityRequest"]);
      for (const options of [
        { ...a.options, allowShadowWrites: false as true }, { ...a.options, databaseName: "production" }, { ...a.options, namespace: "invalid" }
      ]) { const t = trace(); await assert.rejects(traces.run(t, () => MongoActivityPruneRepository.open(options)), fixed); assert.deepEqual(t.wire, []); observe(t); }
      const indexKey = process.env.PII_INDEX_KEY;
      try {
        process.env.PII_INDEX_KEY = "invalid-synthetic-key"; const invalidKey = trace();
        await assert.rejects(traces.run(invalidKey, () => MongoActivityPruneRepository.open(a.options)), fixed);
        assert.deepEqual(invalidKey.wire, []); observe(invalidKey);
      } finally { process.env.PII_INDEX_KEY = indexKey; }
      await seed(a, [row("ActivityRequest", 1)], [row("ActivityChange", 2)]);
      const before = await raw(a);
      for (const failure of [new Error(CANARY, { cause: new Error(PRIVATE) }), `${CANARY}:${PRIVATE}`]) {
        const t = trace(); let faults = 0;
        t.beforeDelete = async collection => { if (collection.endsWith("_ActivityChange")) { faults++; throw failure; } };
        await assert.rejects(invoke(a, t), fixed); assert.equal(faults, 1); observe(t); sameRaw(await raw(a), before);
      }
      const close = trace(); await traces.run(close, () => a.repo.close()); observe(close); assert.deepEqual(close.wire, []);
      assert.equal((await client.db(a.options.databaseName).command({ ping: 1 })).ok, 1);
      await a.store.collection("ActivityRequest").drop();
      await a.store.db.command({ collMod: "shadow_prune_ActivityChange", validationLevel: "off" });
      const metadata = await a.store.db.listCollections({}, { nameOnly: false }).toArray(), invalid = trace();
      await assert.rejects(traces.run(invalid, () => prepareMongoActivityPruneStore(a.options)), fixed); observe(invalid);
      assert.deepEqual(await a.store.db.listCollections({}, { nameOnly: false }).toArray(), metadata);
      const unready = trace(); await assert.rejects(traces.run(unready, () => MongoActivityPruneRepository.open(a.options)), fixed); observe(unready);
    });
  } finally {
    try { if (resetNeeded) await reset(); }
    finally {
      const cleanup = await Promise.allSettled(owned.map(async databaseName => {
        assert.match(databaseName, /^hub_om_shadow_prune_[a-f0-9]{16}$/);
        const deadline = performance.now() + 30_000;
        const left = () => { const value = Math.floor(deadline - performance.now()); assert.ok(value > 0); return value; };
        await client.db(databaseName).dropDatabase({ timeoutMS: left() });
        const cursor = client.db(databaseName).listCollections({}, { nameOnly: true, timeoutMS: left() });
        try { assert.deepEqual(await cursor.toArray(), []); } finally { await cursor.close({ timeoutMS: left() }); }
      }));
      for (const restore of restores.reverse()) restore(); await Promise.all([client.close(), control.close()]);
      for (const key of keys) delete process.env[key];
      for (const outcome of cleanup) if (outcome.status === "rejected") throw outcome.reason;
    }
  }
});
