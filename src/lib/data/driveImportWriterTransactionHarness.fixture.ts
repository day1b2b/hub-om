/** Parent-only native execution; every resource and source value is synthetic. */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { mock } from "node:test";
import { inspect } from "node:util";
import { BSON, ClientSession, Collection, MongoClient, type CommandStartedEvent, type CommandSucceededEvent, type Document, type WithTransactionCallback } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MongoDriveImportWriterRepository, prepareMongoDriveImportWriter, DRIVE_IMPORT_WRITER_MODELS } from "./mongoDriveImportWriterRepository";
import { MongoDriveImportHistoryRepository } from "./mongoDriveImportHistoryRepository";
import { completeMongoRow, MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, mongoRuntimeContracts, type MongoRuntimeDocument } from "./mongoRuntimeCodec";
import type { DriveImportArgs, DriveImportOperation } from "./driveImportWriterRepository";
import type { DriveImportSource } from "./driveImportSource";
import { ARGS, DRIVER_CANARY, ERROR_CODE, INPUT, SOURCE_CANARY, assertRows, expectedOperation, scanPayload } from "./driveImportWriterTransactionLiterals.fixture";

export const EXACT_URI = "mongodb://127.0.0.1:27853/?replicaSet=drivewriter20260930";
export const OPT_IN = "MONGODB_DRIVE_IMPORT_WRITER_TEST_URI";
const businessModels = ["Company", "Course", "OperationSession"] as const;
export function newTrace() {
  return {
    source: 0, search: 0, transactions: 0, callbacks: 0, commits: 0, committed: 0, aborted: 0, ended: 0, activeCallbacks: 0,
    runAttempts: [] as MongoRuntimeDocument[], resultAttempts: [] as MongoRuntimeDocument[], finishes: [] as Date[],
    commands: [] as CommandStartedEvent[], logs: [] as string[], violations: [] as string[],
    received: [] as Array<{ namespace: string; rows: number; bytes: number }>,
    sessions: new Set<ClientSession>(), from: Date.now(), to: 0,
    beforeInsert: undefined as ((model: string, row: MongoRuntimeDocument) => Promise<void>) | undefined,
    afterInsert: undefined as ((model: string, row: MongoRuntimeDocument, session: ClientSession | undefined) => Promise<void>) | undefined,
    commitFault: undefined as ((session: ClientSession, commit: () => Promise<void>) => Promise<void>) | undefined,
    beforeUpdate: undefined as (() => Promise<void>) | undefined,
    afterUpdate: undefined as (() => Promise<void>) | undefined,
    afterEnd: undefined as (() => Promise<void>) | undefined,
    scanFault: undefined as ((payload: ReturnType<typeof scanPayload>) => Promise<ReturnType<typeof scanPayload>>) | undefined,
    sourceInputs: [] as string[], sourceBindings: [] as string[], searchInputs: [] as DriveImportOperation[]
  };
}
export type Trace = ReturnType<typeof newTrace>;
const traces = new AsyncLocalStorage<Trace>();
export function observe(t: Trace, check: () => void) {
  try { check(); } catch (error) { t.violations.push(String(error)); }
}
export function assertTrace(t: Trace) {
  assert.deepEqual(t.violations, [], "observer assertions must survive repository/workflow catches");
  const text = t.logs.join("\n");
  assert.ok(!text.includes(DRIVER_CANARY) && !text.includes(SOURCE_CANARY));
  const writes = t.commands.filter(event => ["insert", "update", "delete", "findAndModify"].includes(event.commandName));
  for (const event of writes) {
    const target = String(event.command[event.commandName]);
    assert.match(target, /_(DriveImportRun|DriveImportResult)$/);
  }
  for (const event of t.commands) assert.ok(!["create", "createIndexes", "collMod", "drop", "dropDatabase"].includes(event.commandName));
}
export async function failure(work: Promise<unknown>) {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof Error); assert.equal(error.message, ERROR_CODE);
    assert.equal(error.cause, undefined); assert.ok(!inspect(error, { depth: null, showHidden: true }).includes(DRIVER_CANARY)); return true;
  });
}
export function seedRow(model: string, fields: MongoRow): MongoRow {
  const row = completeMongoRow(model, fields);
  for (const [name, field] of Object.entries(mongoRuntimeContracts[model].fields)) {
    if (Object.hasOwn(row, name) || name.endsWith("PiiIndex") || name.endsWith("Encrypted")) continue;
    row[name] = field.values ? field.values[0] : field.uuid ? randomUUID() : field.type === "DateTime"
      ? new Date("2032-01-01T00:00:00.000Z") : field.type === "Int" ? 1 : field.type === "Boolean" ? false
      : field.type === "Decimal" ? "0.00" : field.type === "Json" ? {} : `Synthetic-${name}`;
  }
  return row;
}
export function semantic(model: string, raw: MongoRuntimeDocument): MongoRow {
  return Object.fromEntries(Object.entries(decodeMongoRuntimeDocument(model, raw)).filter(([key]) => !key.endsWith("PiiIndex")));
}
export type Fixture = Awaited<ReturnType<Awaited<ReturnType<typeof openHarness>>["fixture"]>>;
export async function openHarness(uri: string) {
  assert.equal(uri, EXACT_URI, "exact opt-in required; no real env fallback");
  const keys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "TZ"];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ drivewriterfixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "drivewriterfixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", TZ: "UTC" });
  const client = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 5000, timeoutMS: 5000, monitorCommands: true });
  const observer = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 5000, timeoutMS: 5000 });
  const databaseName = `hub_om_shadow_drive_writer_tx_${randomBytes(10).toString("hex")}`;
  let owned = false, closed = false, serial = 0, forbidden = 0;
  const restores: Array<() => void> = [];
  const command = (event: CommandStartedEvent) => { if (event.databaseName === databaseName) traces.getStore()?.commands.push(event); };
  const received = (event: CommandSucceededEvent) => {
    const t = traces.getStore(), reply = event.reply as Document;
    if (!t || event.commandName !== "find" || !Array.isArray(reply.cursor?.firstBatch)) return;
    const batch = reply.cursor.firstBatch as Document[];
    t.received.push({ namespace: String(reply.cursor.ns), rows: batch.length,
      bytes: batch.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0) });
  };
  client.on("commandStarted", command);
  client.on("commandSucceeded", received);
  async function close() {
    if (closed) return; closed = true;
    try {
      if (owned) {
        const deadline = performance.now() + 30_000;
        await client.db(databaseName).dropDatabase({ timeoutMS: 25_000 });
        const remaining = Math.floor(deadline - performance.now()); assert.ok(remaining > 0);
        const after = await observer.db("admin").admin().listDatabases({ nameOnly: true, filter: { name: databaseName }, timeoutMS: remaining });
        assert.equal(after.databases.length, 0);
        console.info(`[drive-writer-native] removed and absence observed: ${databaseName}`);
      }
    } finally {
      try {
        const results = await Promise.allSettled([client.close(), observer.close()]);
        for (const result of results) if (result.status === "rejected") throw result.reason;
      } finally {
        client.off("commandStarted", command);
        client.off("commandSucceeded", received);
        for (const restore of restores.reverse()) restore();
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    }
  }
  try {
    await client.connect(); await observer.connect();
    const hello = await client.db("admin").command({ hello: 1 }, { timeoutMS: 5000 });
    assert.equal(hello.setName, "drivewriter20260930"); assert.ok(hello.logicalSessionTimeoutMinutes > 0);
    assert.ok(Array.isArray(hello.hosts) && hello.hosts.length === 1); assert.match(hello.hosts[0], /^(127\.0\.0\.1|localhost):27853$/);
    const serverOptions = await client.db("admin").command({ getCmdLineOpts: 1 }, { timeoutMS: 5000 });
    assert.equal(serverOptions.parsed?.storage?.dbPath, "/private/tmp/hub-om-drive-writer-20260930/mongo");
    const before = await client.db("admin").admin().listDatabases({ nameOnly: true, filter: { name: databaseName }, timeoutMS: 5000 });
    assert.equal(before.databases.length, 0); owned = true;
    console.info(`[drive-writer-native] freshly absent owned database: ${databaseName}`);
    await client.db(databaseName).createCollection("synthetic_ownership_marker", { timeoutMS: 5000 });
    const pg = mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
      constructor() { forbidden++; throw new Error("SYNTHETIC_PG_TRIPWIRE"); }
    } } }); restores.push(() => pg.restore());
    const fetch = mock.method(globalThis, "fetch", async () => { forbidden++; throw new Error("SYNTHETIC_EXTERNAL_TRIPWIRE"); });
    restores.push(() => fetch.mock.restore());
    for (const level of ["error", "warn", "log", "info", "debug"] as const) {
      const original = console[level];
      const hook = mock.method(console, level, (...args: unknown[]) => {
        const t = traces.getStore(); if (t) t.logs.push(inspect(args, { depth: null, showHidden: true })); else original.apply(console, args);
      }); restores.push(() => hook.mock.restore());
    }
    const transaction = ClientSession.prototype.withTransaction;
    const txHook = mock.method(ClientSession.prototype, "withTransaction", function<T>(this: ClientSession,
      callback: WithTransactionCallback<T>, options?: Parameters<ClientSession["withTransaction"]>[1]): Promise<T> {
      const t = traces.getStore(); if (!t) return transaction.call(this, callback, options) as Promise<T>;
      t.transactions++; t.sessions.add(this);
      return transaction.call(this, async session => {
        t.callbacks++; t.activeCallbacks++;
        try { return await callback(session); } finally { t.activeCallbacks--; }
      }, options) as Promise<T>;
    }); restores.push(() => txHook.mock.restore());
    const commit = ClientSession.prototype.commitTransaction;
    const commitHook = mock.method(ClientSession.prototype, "commitTransaction", async function(this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
      const t = traces.getStore(); if (!t || !t.sessions.has(this)) return commit.apply(this, args);
      t.commits++; const delegate = async () => { await commit.apply(this, args); t.committed++; };
      return t.commitFault ? t.commitFault(this, delegate) : delegate();
    }); restores.push(() => commitHook.mock.restore());
    const abort = ClientSession.prototype.abortTransaction;
    const abortHook = mock.method(ClientSession.prototype, "abortTransaction", async function(this: ClientSession, ...args: Parameters<ClientSession["abortTransaction"]>) {
      const result = await abort.apply(this, args), t = traces.getStore();
      if (t?.sessions.has(this)) t.aborted++; return result;
    }); restores.push(() => abortHook.mock.restore());
    const end = ClientSession.prototype.endSession;
    const endHook = mock.method(ClientSession.prototype, "endSession", async function(this: ClientSession, ...args: Parameters<ClientSession["endSession"]>) {
      const result = await end.apply(this, args), t = traces.getStore();
      if (t?.sessions.has(this)) { t.ended++; observe(t, () => assert.equal(this.hasEnded, true)); await t.afterEnd?.(); } return result;
    }); restores.push(() => endHook.mock.restore());
    const insert = Collection.prototype.insertOne;
    const insertHook = mock.method(Collection.prototype, "insertOne", async function(this: Collection, ...args: Parameters<Collection["insertOne"]>) {
      const t = traces.getStore(), model = this.collectionName.endsWith("_DriveImportRun") ? "DriveImportRun"
        : this.collectionName.endsWith("_DriveImportResult") ? "DriveImportResult" : undefined;
      if (!t || !model || this.dbName !== databaseName) return insert.apply(this, args);
      const row = args[0] as unknown as MongoRuntimeDocument;
      (model === "DriveImportRun" ? t.runAttempts : t.resultAttempts).push({ ...row });
      if (model === "DriveImportResult") observe(t, () => assert.ok(args[1]?.session?.inTransaction()));
      await t.beforeInsert?.(model, row);
      const result = await insert.apply(this, args);
      await t.afterInsert?.(model, row, args[1]?.session); return result;
    }); restores.push(() => insertHook.mock.restore());
    const update = Collection.prototype.updateOne;
    const updateHook = mock.method(Collection.prototype, "updateOne", async function(this: Collection, ...args: Parameters<Collection["updateOne"]>) {
      const t = traces.getStore(); if (!t || !this.collectionName.endsWith("_DriveImportRun") || this.dbName !== databaseName) return update.apply(this, args);
      const document = args[1] as { $set?: { finishedAt?: Date } };
      if (document.$set?.finishedAt) t.finishes.push(document.$set.finishedAt);
      await t.beforeUpdate?.(); const result = await update.apply(this, args); await t.afterUpdate?.(); return result;
    }); restores.push(() => updateHook.mock.restore());
    const { runDriveImportDryRun } = await import("../driveImports/driveImportDryRun");
    async function fixture(operationIds = ["SYNTHETIC-OP"], binding?: { inputValue: string; folderTitle: string }) {
      const options = { client, databaseName, namespace: `shadow_drive_writer_${++serial}`, allowShadowWrites: true as const };
      await prepareMongoDriveImportWriter(options);
      const store = new MongoOperationStore(options, DRIVE_IMPORT_WRITER_MODELS);
      const read = new MongoOperationStore({ ...options, client: observer }, DRIVE_IMPORT_WRITER_MODELS);
      const put = async (model: string, fields: MongoRow) => {
        const raw = encodeMongoRuntimeDocument(model, seedRow(model, fields));
        await store.collection(model).insertOne(raw, { timeoutMS: 5000 }); return raw;
      };
      const companyId = randomUUID(), courseId = randomUUID();
      await put("Company", { id: companyId, name: "Synthetic company", normalizedName: "synthetic company" });
      await put("Course", { id: courseId, companyId, processSeq: 1, courseId: "SYNTHETIC-COURSE", name: "Synthetic course" });
      const operations: DriveImportOperation[] = [];
      for (const operationId of operationIds) {
        const operation = expectedOperation(randomUUID(), operationId);
        if (binding) operation.driveLink = `  ${binding.inputValue}  `;
        operations.push(operation);
        await put("OperationSession", { id: operation.id, courseRecordId: courseId, operationId, omName: operation.om,
          ldName: operation.ld, driveLink: operation.driveLink, lectureManagementLink: operation.lectureManagementLink });
      }
      // A nonempty excluded sentinel catches broad mutation/deletion and deletedAt filter regressions.
      await put("OperationSession", { id: randomUUID(), courseRecordId: courseId, operationId: "SYNTHETIC-DELETED-SENTINEL", deletedAt: new Date() });
      const repository = await MongoDriveImportWriterRepository.open(options);
      const history = await MongoDriveImportHistoryRepository.open(options);
      const source: DriveImportSource = {
        async scan(value) {
          const t = traces.getStore(); assert.ok(t); t.source++; t.sourceInputs.push(value);
          t.sourceBindings.push(options.namespace);
          observe(t, () => { assert.equal(t.activeCallbacks, 0); assert.equal(value, binding?.inputValue ?? INPUT.value); });
          const payload = scanPayload();
          if (binding) { payload.folderTitle = binding.folderTitle; payload.folderUrl = binding.inputValue; }
          return t.scanFault ? t.scanFault(payload) : payload;
        },
        async search(operation) {
          const t = traces.getStore(); assert.ok(t); t.search++; t.searchInputs.push(operation);
          observe(t, () => assert.equal(t.activeCallbacks, 0));
          return { candidates: [], issues: [], searchedAt: "2032-01-01T00:00:00.000Z" };
        }
      };
      async function raw(model: string) { return read.collection(model).find({}, { timeoutMS: 5000 }).sort({ _id: 1 }).toArray(); }
      const business = () => Promise.all(businessModels.map(async model => [model, await raw(model)]));
      let beforeBusiness = await business();
      async function traced<T>(t: Trace, work: () => Promise<T>): Promise<T> {
        t.from = Date.now();
        try { return await traces.run(t, work); } finally { t.to = Date.now(); }
      }
      return { options, store, read, put, raw, operations, companyId, courseId, repository, history, traced,
        async rebaselineBusiness() { beforeBusiness = await business(); },
        async assertUnchanged() { assert.deepEqual(await business(), beforeBusiness); assert.equal(forbidden, 0); },
        async assertStored(runs: MongoRow[], results: MongoRow[]) {
          assertRows((await raw("DriveImportRun")).map(row => semantic("DriveImportRun", row)), runs);
          assertRows((await raw("DriveImportResult")).map(row => semantic("DriveImportResult", row)), results);
        },
        invoke(t: Trace, args: DriveImportArgs = ARGS) {
          return traced(t, () => runWithDataRepositories({ driveImportWriter: repository, driveImportSource: source }, () => runDriveImportDryRun(args)));
        }
      };
    }
    return { fixture, close, client, observer, databaseName };
  } catch (error) { await close(); throw error; }
}
