/** Parent-run V7 harness. Only fresh owned loopback Mongo resources; no env files. */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import { inspect } from "node:util";
import { ClientSession, Collection, MongoClient, type WithTransactionCallback } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { IMPORT_MODELS, MongoImportRepository, prepareMongoImportStore } from "./mongoImportRepository";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { MongoRequestAuditRepository, REQUEST_AUDIT_MODELS, prepareMongoRequestAuditStore } from "./mongoRequestAuditRepository";
import { MongoOperationStore, completeMongoRow, type MongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, mongoRuntimeContracts } from "./mongoRuntimeCodec";
import { ACTOR_NAME, BODY, EMAIL, ERROR_CANARY, INSTRUCTOR, LD, OM, PARSED, ROUTE, SHEET_ID, TAB, TABLE, TOKEN,
  assertRun, assertSourceRow, observedDate, semantic, uuid } from "./sheetsImportTransactionLiterals.fixture";

export const EXACT_URI = "mongodb://127.0.0.1:27851/?replicaSet=sheetsimport20260930";
export const OPT_IN = "MONGODB_SHEETS_IMPORT_TEST_URI";
const models = [...new Set([...IMPORT_MODELS, ...TEAM_READ_MODELS, ...INSTRUCTOR_NOTE_MODELS, ...REQUEST_AUDIT_MODELS])];
const businessModels = ["Company", "Course", "OperationSession"] as const;
type InsertHook = (model: string, id: string, session: ClientSession) => Promise<void>;
export type Trace = ReturnType<typeof newTrace>;
export function newTrace(label: string) {
  return {
    label, handler: 0, auth: 0, source: 0, parser: 0, roster: 0, instructors: 0, store: 0, audit: 0,
    transactions: 0, callbacks: 0, commits: 0, committed: 0, aborted: 0, ended: 0,
    runIds: [] as string[], rowIds: [] as string[], events: [] as string[], parsed: undefined as unknown,
    from: 0, to: 0, session: undefined as ClientSession | undefined,
    table: undefined as string[][] | undefined, sourceFault: undefined as Error | undefined,
    rosterFault: undefined as Error | undefined, instructorFault: undefined as Error | undefined,
    auditInsertFault: undefined as Error | undefined, auditInserts: 0,
    beforeInsert: undefined as InsertHook | undefined, afterInsert: undefined as InsertHook | undefined,
    beforeScan: undefined as ((model: string, session?: ClientSession) => Promise<void>) | undefined,
    commitFault: undefined as ((session: ClientSession, commit: () => Promise<void>) => Promise<void>) | undefined,
    beforeAudit: undefined as (() => Promise<void>) | undefined,
    afterAudit: undefined as (() => Promise<void>) | undefined
  };
}
const traces = new AsyncLocalStorage<Trace>();
const trace = () => { const value = traces.getStore(); assert.ok(value, "request trace is required"); return value; };
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
export async function bounded<T>(promise: Promise<T>, ms = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SHEETS_TRANSACTION_FIXTURE_BARRIER_TIMEOUT")), ms);
  })]); } finally { clearTimeout(timer); }
}

/** Called after exact opt-in is checked; real guards and withActivity remain imported unchanged. */
export async function installHandler() {
  const handles: Array<{ restore(): void }> = [];
  let externalCalls = 0, pgCalls = 0, forbiddenCalls = 0;
  handles.push(mock.module("@/auth", { namedExports: { auth: async () => {
    const t = trace(); t.auth++; t.events.push("auth");
    return { user: { email: EMAIL, name: ACTOR_NAME }, googleAccessToken: TOKEN, expires: "" };
  } } }));
  handles.push(mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
    constructor() { pgCalls++; throw new Error("SYNTHETIC_PG_TRIPWIRE"); }
  } } }));
  handles.push(mock.module("./localJsonTeamMemberRepository", { namedExports: { LocalJsonTeamMemberRepository: class {
    constructor() { forbiddenCalls++; throw new Error("SYNTHETIC_LOCAL_TRIPWIRE"); }
  } } }));
  handles.push(mock.module("./localJsonInstructorNoteRepository", { namedExports: { LocalJsonInstructorNoteRepository: class {
    constructor() { forbiddenCalls++; throw new Error("SYNTHETIC_LOCAL_TRIPWIRE"); }
  } } }));
  handles.push(mock.module("./notionTeamMemberRepository", { namedExports: { getNotionTeamMemberRepository: () => {
    forbiddenCalls++; throw new Error("SYNTHETIC_NOTION_TRIPWIRE");
  } } }));
  handles.push(mock.module("@/lib/googleCalendar/backfillCalendarEvents", { namedExports: { backfillMissingCalendarEvents: () => {
    forbiddenCalls++; throw new Error("SYNTHETIC_CALENDAR_TRIPWIRE");
  } } }));
  const parser = await import("./importUploadParser");
  handles.push(mock.module("./importUploadParser", { namedExports: { ...parser,
    parseImportTable: (...args: Parameters<typeof parser.parseImportTable>) => {
      const t = trace(); t.parser++; t.events.push("parser");
      const value = parser.parseImportTable(...args); t.parsed = value; return value;
    }
  } }));
  const fetchHook = mock.method(globalThis, "fetch", async () => {
    externalCalls++; throw new Error("SYNTHETIC_EXTERNAL_FETCH_TRIPWIRE");
  });
  handles.push({ restore: () => fetchHook.mock.restore() });
  const resolver = registerHooks({ resolve(specifier, context, next) {
    return next(["next/server", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, context);
  } });
  let POST: (request: Request) => Promise<Response>;
  try { ({ POST } = await import("../../app/api/admin/imports/google-sheets/import/route")); }
  catch (error) { for (const handle of handles.reverse()) handle.restore(); throw error; }
  finally { resolver.deregister(); }

  // These wrappers delegate the installed native driver, including its callback/commit retry loops.
  const transaction = ClientSession.prototype.withTransaction;
  const transactionHook = mock.method(ClientSession.prototype, "withTransaction", function<T>(this: ClientSession,
    callback: WithTransactionCallback<T>, options?: Parameters<ClientSession["withTransaction"]>[1]): Promise<T> {
    const t = traces.getStore();
    if (!t) return transaction.call(this, callback, options) as Promise<T>;
    t.transactions++; t.session = this;
    return transaction.call(this, async session => {
      t.callbacks++; t.events.push(`callback:${t.callbacks}`);
      return callback(session);
    }, options) as Promise<T>;
  });
  const commit = ClientSession.prototype.commitTransaction;
  const commitHook = mock.method(ClientSession.prototype, "commitTransaction", async function(this: ClientSession,
    ...args: Parameters<ClientSession["commitTransaction"]>) {
    const t = traces.getStore();
    if (!t) return commit.apply(this, args);
    t.commits++; t.events.push("commit-call");
    const delegate = async () => { await commit.apply(this, args); t.committed++; t.events.push("commit-ack"); };
    if (t.commitFault) return t.commitFault(this, delegate);
    return delegate();
  });
  const abort = ClientSession.prototype.abortTransaction;
  const abortHook = mock.method(ClientSession.prototype, "abortTransaction", async function(this: ClientSession,
    ...args: Parameters<ClientSession["abortTransaction"]>) {
    const result = await abort.apply(this, args);
    const t = traces.getStore(); if (t) { t.aborted++; t.events.push("abort-returned"); }
    return result;
  });
  const end = ClientSession.prototype.endSession;
  const endHook = mock.method(ClientSession.prototype, "endSession", async function(this: ClientSession,
    ...args: Parameters<ClientSession["endSession"]>) {
    const result = await end.apply(this, args);
    const t = traces.getStore(); if (t && t.session === this) { t.ended++; assert.equal(this.hasEnded, true); }
    return result;
  });
  const insert = Collection.prototype.insertOne;
  const insertHook = mock.method(Collection.prototype, "insertOne", async function(this: Collection,
    ...args: Parameters<Collection["insertOne"]>) {
    const t = traces.getStore();
    const model = this.collectionName.endsWith("_DataImportRun") ? "DataImportRun"
      : this.collectionName.endsWith("_OperationSourceRecord") ? "OperationSourceRecord" : undefined;
    const session = args[1]?.session;
    if (t && this.collectionName.endsWith("_ActivityRequest")) {
      t.auditInserts++;
      assert.equal(session, undefined, "request audit must not join the import transaction");
      if (t.auditInsertFault) throw t.auditInsertFault;
    }
    if (t && model) {
      assert.ok(session instanceof ClientSession && session.inTransaction());
      assert.equal(session, t.session, "all staged documents belong to the actual callback session");
      await t.beforeInsert?.(model, String(args[0]._id), session);
    }
    const result = await insert.apply(this, args);
    if (t && model) {
      assert.ok(session instanceof ClientSession); assert.equal(result.acknowledged, true);
      const id = String(args[0]._id); (model === "DataImportRun" ? t.runIds : t.rowIds).push(id);
      t.events.push(`insert-ack:${model}`);
      await t.afterInsert?.(model, id, session);
    }
    return result;
  });
  const scan = MongoOperationStore.prototype.scan;
  const scanHook = mock.method(MongoOperationStore.prototype, "scan", async function(this: MongoOperationStore,
    ...args: Parameters<MongoOperationStore["scan"]>) {
    await traces.getStore()?.beforeScan?.(args[0], args[2]);
    return scan.apply(this, args);
  });
  for (const hook of [transactionHook, commitHook, abortHook, endHook, insertHook, scanHook]) {
    handles.push({ restore: () => hook.mock.restore() });
  }
  return { POST, assertNoFallback() { assert.equal(externalCalls, 0); assert.equal(pgCalls, 0); assert.equal(forbiddenCalls, 0); },
    restore() { for (const handle of handles.reverse()) handle.restore(); } };
}

function seedRow(model: string, values: MongoRow) {
  const row = completeMongoRow(model, values);
  for (const [key, field] of Object.entries(mongoRuntimeContracts[model].fields)) {
    if (Object.hasOwn(row, key) || key.endsWith("PiiIndex") || key.endsWith("Encrypted")) continue;
    row[key] = field.values ? field.values[0] : field.uuid ? randomUUID() : field.type === "DateTime"
      ? new Date("2026-09-01T00:00:00.000Z") : field.type === "Int" ? 1 : field.type === "Boolean" ? false
      : field.type === "Decimal" ? "0.00" : field.type === "Json" ? {} : `Synthetic-${key}`;
  }
  return row;
}
export type Fixture = Awaited<ReturnType<Awaited<ReturnType<typeof openHarness>>["fixture"]>>;
export async function openHarness(uri: string) {
  assert.equal(uri, EXACT_URI, "exact opt-in only; no application URI fallback");
  const envKeys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS",
    "DEV_AUTH_BYPASS", "DATABASE_URL", "OPERATION_DATA_SOURCE"];
  const saved = new Map(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    PII_ENCRYPTION_KEYS: JSON.stringify({ sheetsfixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "sheetsfixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/sheets_tripwire", OPERATION_DATA_SOURCE: "local"
  });
  delete process.env.DEV_AUTH_BYPASS;
  const client = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const observer = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_sheets_tx_${randomBytes(12).toString("hex")}`;
  let owned = false, closed = false, serial = 0;
  const patches: Array<() => void> = [];
  async function close() {
    if (closed) return; closed = true;
    try {
      if (owned) {
        // Fixture cleanup budget is independent of any product request/transaction deadline.
        const deadline = performance.now() + 30_000;
        await client.db(databaseName).dropDatabase({ timeoutMS: 25_000 });
        const remaining = Math.floor(deadline - performance.now()); assert.ok(remaining > 0);
        const after = await observer.db("admin").admin().listDatabases({ nameOnly: true,
          filter: { name: databaseName }, timeoutMS: remaining });
        assert.equal(after.databases.length, 0, "owned DB absence must be observed after drop ACK");
        console.info(`[sheets-native] owned database removed and absence observed: ${databaseName}`);
      }
    } finally {
      try {
        const results = await Promise.allSettled([client.close(), observer.close()]);
        for (const result of results) if (result.status === "rejected") throw result.reason;
      } finally {
        for (const restore of patches.reverse()) restore();
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    }
  }
  try {
    await client.connect(); await observer.connect();
    const hello = await client.db("admin").command({ hello: 1 }, { timeoutMS: 5000 });
    assert.equal(hello.setName, "sheetsimport20260930");
    assert.ok(hello.logicalSessionTimeoutMinutes > 0);
    assert.ok(Array.isArray(hello.hosts) && hello.hosts.length === 1);
    assert.match(hello.hosts[0], /^(127\.0\.0\.1|localhost):27851$/);
    const before = await client.db("admin").admin().listDatabases({ nameOnly: true,
      filter: { name: databaseName }, timeoutMS: 5000 });
    assert.equal(before.databases.length, 0);
    // Claim only this freshly absent random name, before first mutation, so a lost create ACK
    // still reaches owned cleanup. No preexisting namespace can set this flag.
    owned = true;
    console.info(`[sheets-native] freshly absent database claimed: ${databaseName}`);
    await client.db(databaseName).createCollection("synthetic_ownership_marker", { timeoutMS: 5000 });
  } catch (error) { await close(); throw error; }

  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_sheets_tx_${++serial}`, allowShadowWrites: true as const };
    await prepareMongoImportStore(options);
    await prepareMongoReadStore(options, TEAM_READ_MODELS);
    await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
    await prepareMongoRequestAuditStore(options);
    const store = new MongoOperationStore(options, models);
    const read = new MongoOperationStore({ ...options, client: observer }, models);
    const put = (model: string, row: MongoRow) => store.collection(model).insertOne(encodeMongoRuntimeDocument(model, seedRow(model, row)));
    for (const role of ["OM", "LD"] as const) await put("TeamUser", {
      id: randomUUID(), name: role === "OM" ? OM : LD, email: `synthetic-${role}@example.invalid`,
      slackId: `synthetic-${role}`, team: "1팀", role, createdAt: new Date()
    });
    await put("InstructorNote", { id: randomUUID(), instructorName: INSTRUCTOR, displayName: INSTRUCTOR,
      recruitAvoid: false, createdAt: new Date(), updatedAt: new Date() });
    const companyId = randomUUID(), courseId = randomUUID();
    await put("Company", { id: companyId, name: "Synthetic sentinel company", normalizedName: "synthetic sentinel company" });
    await put("Course", { id: courseId, companyId, courseId: "SYNTHETIC-SENTINEL", processSeq: 1, name: "Synthetic sentinel course" });
    await put("OperationSession", { id: randomUUID(), courseRecordId: courseId, operationId: "SYNTHETIC-SENTINEL-SESSION" });
    let promotionCalls = 0;
    const scope = {
      imports: await MongoImportRepository.open(options), teamMembers: await MongoTeamMemberRepository.open(options),
      instructorNote: await MongoInstructorNoteRepository.open(options), requestActivity: await MongoRequestAuditRepository.open(options),
      googleSheetsImportSource: {
        async listTabs(): Promise<never> { throw new Error("IMPORT_MUST_NOT_LIST_TABS"); },
        async readRows(token: string, id: string, title: string) {
          const t = trace(); t.source++; t.events.push("source");
          assert.deepEqual([token, id, title], [TOKEN, SHEET_ID, TAB]);
          if (t.sourceFault) throw t.sourceFault;
          return structuredClone(t.table ?? TABLE);
        }
      },
      importPromotion: { async promoteReadyImportRows(): Promise<never> {
        promotionCalls++; throw new Error("SYNTHETIC_PROMOTION_TRIPWIRE");
      } }
    };
    // Count actual method calls without replacing their data or transaction behavior.
    const roster = scope.teamMembers.listRoleRosters.bind(scope.teamMembers);
    const rosterHook = mock.method(scope.teamMembers, "listRoleRosters", async () => {
      const t = trace(); t.roster++; t.events.push("roster"); const result = await roster();
      assert.deepEqual(result, { ld: { "1팀": [LD] }, om: { "1팀": [OM] } });
      if (t.rosterFault) throw t.rosterFault; return result;
    });
    const instructors = scope.instructorNote.listNotes.bind(scope.instructorNote);
    const instructorHook = mock.method(scope.instructorNote, "listNotes", async () => {
      const t = trace(); t.instructors++; t.events.push("instructors"); const result = await instructors();
      assert.equal(result.length, 1); assert.equal(result[0].displayName, INSTRUCTOR);
      if (t.instructorFault) throw t.instructorFault; return result;
    });
    const write = scope.imports.storeParsedImport.bind(scope.imports);
    const writeHook = mock.method(scope.imports, "storeParsedImport", async (...args: Parameters<typeof write>) => {
      const t = trace(); t.store++; t.events.push("store"); return write(...args);
    });
    const audit = scope.requestActivity.recordRequest.bind(scope.requestActivity);
    const auditHook = mock.method(scope.requestActivity, "recordRequest", async (...args: Parameters<typeof audit>) => {
      const t = trace(); t.audit++; t.events.push("audit-enter"); await t.beforeAudit?.();
      await audit(...args); t.events.push("audit-ack"); await t.afterAudit?.();
    });
    for (const hook of [rosterHook, instructorHook, writeHook, auditHook]) patches.push(() => hook.mock.restore());
    async function raw(model: string) {
      return read.collection(model).find({}, { timeoutMS: 5000 }).sort({ _id: 1 }).toArray();
    }
    async function snapshot(names: readonly string[]) { return Promise.all(names.map(async model => [model, await raw(model)])); }
    const beforeBusiness = await snapshot(businessModels);
    return { store, read, raw, snapshot, scope,
      async invoke(POST: (request: Request) => Promise<Response>, t: Trace) {
        t.from = Date.now();
        return runWithDataRepositories(scope, () => traces.run(t, async () => {
          t.handler++; t.events.push("handler-enter");
          try { return await POST(new Request(`https://example.invalid${ROUTE}`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(BODY)
          })); } finally { t.to = Date.now(); t.events.push("handler-settled"); }
        }));
      },
      async assertBusinessUnchanged() { assert.equal(promotionCalls, 0); assert.deepEqual(await snapshot(businessModels), beforeBusiness); },
      async assertNoMutationAudit() { assert.deepEqual(await raw("ActivityChange"), []); },
      async assertNoToken() {
        for (const info of await read.db.listCollections({}, { nameOnly: true, timeoutMS: 5000 }).toArray()) {
          if (!info.name.startsWith(`${options.namespace}_`)) continue;
          const documents = await read.db.collection(info.name).find({}, { timeoutMS: 5000 }).toArray();
          const text = inspect(documents, { depth: null, showHidden: true });
          assert.ok(!text.includes(TOKEN)); assert.ok(!text.includes(ERROR_CANARY));
        }
      }
    };
  }
  return { fixture, close };
}

export function assertOnce(t: Trace) {
  assert.deepEqual([t.handler, t.auth, t.source, t.parser, t.roster, t.instructors, t.store, t.audit], [1, 2, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(t.parsed, PARSED);
  assert.equal(t.transactions, 1); assert.equal(t.ended, 1);
  assert.equal(t.auditInserts, 1);
  assert.ok(t.events.indexOf("instructors") < t.events.indexOf("callback:1"));
  assert.ok(t.events.indexOf("audit-enter") > t.events.indexOf("commit-call") || t.commits === 0);
  assert.ok(t.events.indexOf("handler-settled") > t.events.indexOf("audit-enter"));
}
export async function assertWholeRun(f: Fixture, t: Trace, runId: string, duplicate = false) {
  const raw = await f.read.collection("DataImportRun").findOne({ _id: runId }, { timeoutMS: 5000 }); assert.ok(raw);
  assertRun(decodeMongoRuntimeDocument("DataImportRun", raw), runId, t.from, t.to || Date.now(), duplicate);
  const rows = await f.read.collection("OperationSourceRecord").find({ importRunId: runId }, { timeoutMS: 5000 })
    .sort({ sourceRowNumber: 1 }).toArray();
  assert.equal(rows.length, duplicate ? 0 : 2);
  assert.equal(new Set(rows.map(row => row._id)).size, rows.length);
  for (const [index, row] of rows.entries()) assertSourceRow(decodeMongoRuntimeDocument("OperationSourceRecord", row), runId, t.from, t.to || Date.now(), index);
  // Raw private fields remain envelopes; semantic expectations above do not strip unlisted fields.
  assert.notEqual(raw.sourceName, SOURCE_LITERAL); assert.notEqual(raw.importedBy, EMAIL);
}
const SOURCE_LITERAL = "Synthetic transaction source";
export async function assertAudit(f: Fixture, response: Response, t: Trace) {
  const id = response.headers.get("X-Request-Id"); uuid(id);
  const raw = await f.read.collection("ActivityRequest").findOne({ _id: id }, { timeoutMS: 5000 }); assert.ok(raw);
  const row = decodeMongoRuntimeDocument("ActivityRequest", raw);
  observedDate(row.occurredAt, t.from, t.to); assert.ok(Number.isInteger(row.durationMs) && Number(row.durationMs) >= 0);
  assert.deepEqual(semantic(row, ["actorEmailPiiIndex", "actorNamePiiIndex"]), {
    id, occurredAt: row.occurredAt, actorEmail: EMAIL.toLowerCase(), actorName: ACTOR_NAME, actorType: "user",
    route: ROUTE, method: "POST", status: response.status, durationMs: row.durationMs
  });
}
export async function captureLogs<T>(work: () => Promise<T>) {
  const entries: Array<{ level: string; values: unknown[] }> = [];
  const hooks = (["error", "warn", "log", "info", "debug"] as const).map(level =>
    mock.method(console, level, (...values: unknown[]) => { entries.push({ level, values }); }));
  try {
    const value = await work();
    const logged = inspect(entries, { depth: null, showHidden: true });
    assert.ok(!logged.includes(ERROR_CANARY)); assert.ok(!logged.includes(TOKEN));
    return { value, entries };
  } finally { for (const hook of hooks) hook.mock.restore(); }
}
