/** Parent-run only. Node24 --experimental-strip-types --experimental-test-module-mocks
 * --experimental-loader ./scripts/ts-loader.mjs --test THIS_FILE, in a sanitized worker.
 * This suite calls the actual POST, PII guard, withActivity, codec and native repositories.
 * It does not claim original PG snapshot guarantees or a Next HTTP error-page contract.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { inspect } from "node:util";
import { BSON, Collection, FindCursor, MongoClient, MongoOperationTimeoutError, MongoServerError, type CommandStartedEvent, type Document } from "mongodb";
import { runWithDataRepositories, getDataRepositoryOverride, type DataRepositories } from "./dataRepositoryContext";
import { MongoOperationStore, completeMongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoAdminBackupRepository, prepareMongoAdminBackupStore, ADMIN_BACKUP_READ_MODELS } from "./mongoAdminBackupRepository";
import { seedRows, expectedResponseData, checkBody, comparatorNegatives, JSON_NULL_RUN_ID, uuid } from "./admin-backup-tests/shared.fixture";

const URI = "mongodb://127.0.0.1:27856/?replicaSet=adminbackup20260930";
const DBPATH = "/private/tmp/hub-om-admin-backup-20260930/mongo";
const CODE = "ADMIN_BACKUP_READ_FAILED";
const SECRET = "synthetic-backup-bearer-only";
const PRIVATE = "synthetic-backup-private-value";
const CANARY = "synthetic-backup-error-never-public";
const ADMIN = "synthetic-backup-admin@day1company.co.kr";
const DENIED = "코치 개인정보 열람 권한이 없습니다. (ADMIN_EMAILS 설정 및 admin 계정 필요)";
const DATE = "2026-09-01T00:00:00.000Z";
const LATER = "2026-09-02T00:00:00.000Z";
const pairs = [
  ["coaches", "Coach"], ["privateProfiles", "CoachPrivateProfile"], ["fields", "CoachFieldMaster"],
  ["curriculums", "CoachCurriculumMaster"], ["coachFields", "CoachField"], ["coachCurriculums", "CoachCurriculum"],
  ["schedules", "CoachSchedule"], ["scheduleAccessLogs", "CoachScheduleAccessLog"], ["engagements", "CoachEngagement"],
  ["engagementSchedules", "CoachEngagementSchedule"], ["importRuns", "CoachImportRun"]
] as const;
type Rows = Record<string, Array<Record<string, unknown>>>;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Full public scalars are deliberately enumerated here, not discovered from a
// runtime contract, privacy policy, decoder or the product's output builder.
function literal(label = "a"): Rows {
  return {
    coaches: [{ id: id(1), sourceCoachId: `${PRIVATE}-source-${label}`, accessToken: `${PRIVATE}-access-${label}`,
      name: `${PRIVATE}-${label}`, normalizedName: `${PRIVATE}-${label}`, workType: "synthetic-work", status: "INACTIVE",
      statusNote: PRIVATE, returnDate: LATER, selfNote: PRIVATE, portfolioUrl: "https://synthetic.invalid/portfolio",
      availabilityDetail: PRIVATE, managerNote: PRIVATE, dxTag: "synthetic", employeeNo: `${PRIVATE}-employee-${label}`,
      notionNo: 17, notionPageId: `${PRIVATE}-page-${label}`, isActive: false, displayOrder: 7,
      createdAt: DATE, updatedAt: LATER, deletedAt: LATER, deletedBy: ADMIN }],
    privateProfiles: [{ coachId: id(1), employeeId: PRIVATE, phone: PRIVATE, email: `${label}@synthetic.invalid`,
      birthDate: DATE, affiliation: PRIVATE, createdAt: DATE, updatedAt: LATER }],
    fields: [{ id: id(2), name: `synthetic-field-${label}` }, { id: id(3), name: `synthetic-field-second-${label}` }],
    curriculums: [{ id: id(4), name: `synthetic-curriculum-${label}` }],
    coachFields: [{ coachId: id(1), tagId: id(2) }, { coachId: id(1), tagId: id(3) }],
    coachCurriculums: [{ coachId: id(1), tagId: id(4) }],
    schedules: [{ id: id(5), sourceScheduleId: "synthetic-schedule", coachId: id(1), date: DATE,
      startTime: "09:00", endTime: "10:30", updatedAt: LATER }],
    scheduleAccessLogs: [{ id: id(6), sourceAccessLogId: null, coachId: id(1), yearMonth: "2026-09", accessedAt: DATE, lastEditedAt: null }],
    engagements: [{ id: id(7), sourceEngagementId: `${PRIVATE}-engagement`, coachId: id(1), operationSessionId: null,
      courseName: "Synthetic course", status: "COMPLETED", source: "SHEET", startDate: DATE, endDate: LATER,
      startTime: null, endTime: "18:00", rating: 4, rehire: false, feedback: PRIVATE, reviewFlaggedAt: LATER,
      hiredById: PRIVATE, hiredByText: PRIVATE, createdAt: DATE }],
    engagementSchedules: [{ id: id(8), sourceEngagementScheduleId: `${PRIVATE}-engagement-schedule`, engagementId: id(7),
      coachId: id(1), date: DATE, startTime: "09:00", endTime: "18:00", cancelledAt: LATER }],
    importRuns: [
      { id: id(9), mode: "dry_run", status: "COMPLETED_WITH_ERRORS", coachCount: 1, engagementCount: 2, scheduleCount: 3,
        matchedOperationCount: 0, errorCount: 1, summary: { _id: "user-json-id", _seq: 4, namePiiIndex: "user-json-key", nested: [null, false, 3] },
        notes: PRIVATE, startedAt: DATE, finishedAt: LATER },
      { id: id(10), mode: "apply", status: "PENDING", coachCount: 0, engagementCount: 0, scheduleCount: 0,
        matchedOperationCount: 0, errorCount: 0, summary: ["synthetic", null, true], notes: null, startedAt: LATER, finishedAt: null },
      { id: id(11), mode: "dry_run", status: "FAILED", coachCount: 0, engagementCount: 0, scheduleCount: 0,
        matchedOperationCount: 0, errorCount: 1, summary: null, notes: null, startedAt: LATER, finishedAt: null }
    ],
    archiveSnapshots: []
  };
}
function empty(): Rows { return Object.fromEntries([...pairs.map(([key]) => [key, []]), ["archiveSnapshots", []]]); }
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
  return value;
}
const multiset = (rows: unknown[]) => rows.map(row => JSON.stringify(ordered(row))).sort();
function assertData(actual: Rows, expected: Rows) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const [key, rows] of Object.entries(expected)) {
    assert.ok(Array.isArray(actual[key]));
    if (key === "archiveSnapshots") assert.deepEqual(actual[key], rows);
    else assert.deepEqual(multiset(actual[key]), multiset(rows), key);
  }
}
function noLeaks(value: unknown, forbidden = [PRIVATE, CANARY, SECRET]) {
  const text = inspect(value, { depth: null, showHidden: true, maxArrayLength: null, maxStringLength: null });
  for (const marker of forbidden) assert.ok(!text.includes(marker), "Forbidden synthetic marker detected");
}
function fixed(error: unknown) {
  assert.ok(error instanceof Error); assert.equal(error.message, CODE); assert.equal(error.cause, undefined); noLeaks(error); return true;
}
type Session = { user: { email: string; name: string } } | null;
function trace(session: Session = { user: { email: ADMIN, name: "Synthetic admin" } }) {
  return { session, auth: 0, reads: 0, audit: 0, wire: [] as CommandStartedEvent[], logs: [] as unknown[][],
    cursors: new Set<FindCursor>(), closed: new Set<FindCursor>(), sessions: 0, ended: 0, clientCloses: 0,
    seen: [] as string[], errors: [] as unknown[], endOptions: [] as unknown[],
    finds: [] as Array<{ collection: string; cursor: FindCursor; timeoutMS: number | undefined; backup: boolean }>,
    cursorCloses: [] as Array<{ cursor: FindCursor; options: Parameters<FindCursor["close"]>[0]; completed: boolean }>,
    after: undefined as undefined | ((collection: string, row: Document | null) => Promise<void>) };
}
type Trace = ReturnType<typeof trace>;
const traces = new AsyncLocalStorage<Trace>();
function barrier() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function waitEntered(entered: Promise<void>, pending: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([entered, pending.then(() => { throw new Error("BACKUP_BARRIER_NOT_ENTERED"); }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("BACKUP_BARRIER_TIMEOUT")), 20_000); })]);
  } finally { if (timer) clearTimeout(timer); }
}

test("admin backup actual POST / native snapshot / cumulative boundaries", {
  skip: process.env.ADMIN_BACKUP_DATABASE_TESTS !== "1", timeout: 300_000
}, async root => {
  assert.equal(process.env.ADMIN_BACKUP_TEST_MONGO_URI, URI);
  const keys = ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY",
    "PII_ALLOW_PLAINTEXT_READS", "BACKUP_API_SECRET", "ADMIN_EMAILS", "DEV_AUTH_BYPASS"];
  for (const key of keys) assert.equal(process.env[key], undefined, `Sanitized worker required: ${key}`);
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ backupfixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "backupfixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    BACKUP_API_SECRET: SECRET, ADMIN_EMAILS: ADMIN, DEV_AUTH_BYPASS: "false",
    DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/admin_backup_tripwire" });
  const restores: Array<() => void> = [];
  let pgCalls = 0, externalCalls = 0;
  const pg = mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
    constructor() { pgCalls++; throw new Error("ADMIN_BACKUP_PG_TRIPWIRE"); }
  } } }); restores.push(() => pg.restore());
  const auth = mock.module("@/auth", { namedExports: { auth: async () => {
    const t = traces.getStore(); assert.ok(t); t.auth++; return t.session;
  } } }); restores.push(() => auth.restore());
  const fetchHook = mock.method(globalThis, "fetch", async () => { externalCalls++; throw new Error("ADMIN_BACKUP_EXTERNAL_TRIPWIRE"); });
  restores.push(() => fetchHook.mock.restore());
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level];
    const hook = mock.method(console, level, (...args: unknown[]) => {
      const t = traces.getStore(); if (t) t.logs.push(args); else original.apply(console, args);
    }); restores.push(() => hook.mock.restore());
  }
  const find = Collection.prototype.find;
  const findHook = mock.method(Collection.prototype, "find", function(this: Collection, ...args: Parameters<Collection["find"]>) {
    const cursor = find.apply(this, args);
    traces.getStore()?.finds.push({ collection: this.collectionName, cursor, timeoutMS: args[1]?.timeoutMS,
      backup: args[1]?.session?.explicit === true });
    return cursor;
  }); restores.push(() => findHook.mock.restore());
  const next = FindCursor.prototype.next;
  const nextHook = mock.method(FindCursor.prototype, "next", async function(this: FindCursor, ...args: Parameters<FindCursor["next"]>) {
    const t = traces.getStore(); if (t) { t.cursors.add(this); t.seen.push(this.namespace.collection ?? ""); }
    let row: Document | null;
    try { row = await next.apply(this, args); } catch (error) { t?.errors.push(error); throw error; }
    if (t?.after) await t.after(this.namespace.collection ?? "", row);
    return row;
  }); restores.push(() => nextHook.mock.restore());
  const close = FindCursor.prototype.close;
  const closeHook = mock.method(FindCursor.prototype, "close", async function(this: FindCursor, ...args: Parameters<FindCursor["close"]>) {
    const t = traces.getStore(), attempt = { cursor: this, options: args[0], completed: false };
    t?.cursorCloses.push(attempt);
    const result = await close.apply(this, args);
    attempt.completed = true; t?.closed.add(this); return result;
  }); restores.push(() => closeHook.mock.restore());
  const start = MongoClient.prototype.startSession;
  const sessionHook = mock.method(MongoClient.prototype, "startSession", function(this: MongoClient, ...args: Parameters<MongoClient["startSession"]>) {
    const session = start.apply(this, args), t = traces.getStore();
    if (t && session.explicit) {
      t.sessions++; const end = session.endSession.bind(session);
      const hook = mock.method(session, "endSession", async (...endArgs: Parameters<typeof end>) => {
        t.endOptions.push(endArgs[0]);
        const result = await end(...endArgs); t.ended++; return result;
      }); restores.push(() => hook.mock.restore());
    }
    return session;
  }); restores.push(() => sessionHook.mock.restore());
  const clientClose = MongoClient.prototype.close;
  const clientHook = mock.method(MongoClient.prototype, "close", function(this: MongoClient, ...args: Parameters<MongoClient["close"]>) {
    const t = traces.getStore(); if (t) t.clientCloses++; return clientClose.apply(this, args);
  }); restores.push(() => clientHook.mock.restore());
  const resolver = registerHooks({ resolve(specifier, context, nextResolve) {
    return nextResolve(["next/server", "next/navigation"].includes(specifier) ? `${specifier}.js` : specifier, context);
  } }); restores.push(() => resolver.deregister());
  const appName = `synthetic-backup-native-${randomBytes(6).toString("hex")}`;
  const client = new MongoClient(URI, { directConnection: true, serverSelectionTimeoutMS: 5000, monitorCommands: true, appName });
  client.on("commandStarted", event => traces.getStore()?.wire.push(event));
  const owned: string[] = [];
  try {
    const { POST, dynamic } = await import("../../app/api/admin/backup/route");
    assert.equal(dynamic, "force-dynamic");
    const { getPrismaClient } = await import("./prisma");
    assert.throws(() => getPrismaClient(), /ADMIN_BACKUP_PG_TRIPWIRE/); assert.equal(pgCalls, 1); pgCalls = 0;
    assert.deepEqual([...ADMIN_BACKUP_READ_MODELS].sort(), [...pairs.map(([, model]) => model), "CoachdbArchiveSnapshot"].sort());
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.setName, "adminbackup20260930"); assert.deepEqual(hello.hosts, ["127.0.0.1:27856"]);
    assert.equal((await client.db("admin").command({ getCmdLineOpts: 1 })).parsed?.storage?.dbPath, DBPATH);
    async function create(label = "a", seed = true) {
      const databaseName = `hub_om_shadow_backup_${randomBytes(8).toString("hex")}`;
      assert.ok(databaseName.length <= 63);
      assert.equal((await client.db(databaseName).listCollections({}, { nameOnly: true }).toArray()).length, 0);
      owned.push(databaseName);
      const options = { client, databaseName, namespace: "shadow_backup", allowShadowWrites: true as const };
      await prepareMongoAdminBackupStore(options); await prepareMongoRequestAuditStore(options);
      const store = new MongoOperationStore(options, [...new Set([...ADMIN_BACKUP_READ_MODELS, ...REQUEST_AUDIT_MODELS])]);
      if (seed) {
        for (const [key, model] of pairs) for (const row of literal(label)[key]) {
          await store.collection(model).insertOne(encodeMongoRuntimeDocument(model,
            completeMongoRow(model, { ...row, ...(model === "CoachImportRun" && row.summary === null ? { summary: MongoDbNull } : {}) })));
        }
      }
      const repo = await MongoAdminBackupRepository.open(options), audit = await MongoRequestAuditRepository.open(options);
      const scope: Partial<DataRepositories> = {
        adminBackup: { read: async () => { const t = traces.getStore(); if (t) t.reads++; return repo.read(); } },
        requestActivity: { recordRequest: async (...args) => { const t = traces.getStore(); if (t) t.audit++; return audit.recordRequest(...args); } }
      };
      return { databaseName, options, store, repo, audit, scope };
    }
    type Native = Awaited<ReturnType<typeof create>>;
    async function raw(a: Native) {
      return Promise.all(ADMIN_BACKUP_READ_MODELS.map(async model => ({ model,
        rows: await a.store.collection(model).find({}).sort({ _id: 1 }).toArray() })));
    }
    function invoke(a: Native, t = trace(), authorization: string | null = `Bearer ${SECRET}`, scope = a.scope) {
      return traces.run(t, () => runWithDataRepositories(scope, () => POST(new Request("http://synthetic.invalid/api/admin/backup", {
        method: "POST", headers: authorization === null ? {} : { authorization }
      }))));
    }
    function observations(t: Trace) {
      assert.equal(pgCalls, 0); assert.equal(externalCalls, 0); assert.equal(t.clientCloses, 0);
      assert.equal(t.ended, t.sessions); for (const cursor of t.cursors) assert.ok(t.closed.has(cursor) || cursor.closed);
      for (const options of t.endOptions) assert.deepEqual(options, { timeoutMS: 5000 });
      // Driver auto-close is not evidence of the explicit, bounded product close.
      for (const call of t.finds.filter(call => call.backup)) {
        const bounded = t.cursorCloses.filter(attempt => attempt.cursor === call.cursor && attempt.options?.timeoutMS === 5000);
        assert.ok(bounded.length > 0, "Every backup cursor requires an explicit bounded close");
        assert.ok(bounded.every(attempt => attempt.completed), "Bounded close must finish successfully");
      }
      noLeaks(t.logs);
      for (const event of t.wire) {
        assert.ok(!["create", "createIndexes", "collMod", "drop", "dropDatabase"].includes(event.commandName));
        if (["insert", "update", "delete"].includes(event.commandName)) {
          assert.ok(["shadow_backup_ActivityRequest", "shadow_backup_ActivityChange"].includes(String(event.command[event.commandName])));
        }
        if (event.commandName === "find") assert.ok([...ADMIN_BACKUP_READ_MODELS, "ActivityRequest", "ActivityChange"].some(model => event.command.find === `shadow_backup_${model}`));
      }
    }
    async function checkAudit(a: Native, t: Trace, requestId: string | null, status: number, actorType = "token_request") {
      assert.ok(requestId); const row = await a.store.one("ActivityRequest", { _id: requestId }); assert.ok(row);
      assert.equal(row.id, requestId); assert.equal(row.route, "/api/admin/backup"); assert.equal(row.method, "POST");
      assert.equal(row.status, status); assert.equal(row.actorType, actorType);
      assert.equal(row.actorEmail, actorType === "user" ? ADMIN : null);
      assert.equal(row.actorName, actorType === "user" ? "Synthetic admin" : null);
      assert.ok(row.occurredAt instanceof Date); assert.ok(typeof row.durationMs === "number" && row.durationMs >= 0);
      noLeaks(row); noLeaks(await a.store.collection("ActivityRequest").find({}).toArray());
      if (actorType === "user") {
        const stored = await a.store.collection("ActivityRequest").findOne({ _id: requestId }); assert.ok(stored);
        assert.match(String(stored.actorEmail), /^pii:v1:backupfixture:/);
        assert.match(String(stored.actorName), /^pii:v1:backupfixture:/);
        noLeaks(stored, [ADMIN, "Synthetic admin"]);
      }
      observations(t);
    }
    async function success(a: Native, expected: Rows, t = trace(), authorization: string | null = `Bearer ${SECRET}`) {
      const before = Date.now(), response = await invoke(a, t, authorization), after = Date.now();
      assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
      const body = await response.json(); assert.deepEqual(Object.keys(body).sort(), ["counts", "data", "exportedAt"]);
      assert.ok(Date.parse(body.exportedAt) >= before && Date.parse(body.exportedAt) <= after);
      assert.ok([before, after].some(time => response.headers.get("content-disposition") ===
        `attachment; filename="hub_om_coach_backup_${new Date(time).toISOString().slice(0, 10)}.json"`));
      assertData(body.data, expected);
      assert.deepEqual(body.counts, Object.fromEntries(Object.entries(expected).map(([key, rows]) => [key, rows.length])));
      await checkAudit(a, t, response.headers.get("X-Request-Id"), 200, authorization ? "token_request" : "user");
      assert.equal(t.reads, 1); assert.equal(t.audit, 1); return { body, response, t };
    }
    async function reject(a: Native, t: Trace, expected: string = CODE, authorization: string | null = `Bearer ${SECRET}`, scope = a.scope) {
      const before = new Set((await a.store.scan("ActivityRequest")).map(row => row.id));
      await assert.rejects(invoke(a, t, authorization, scope), expected === CODE ? fixed : { message: expected });
      const added = (await a.store.scan("ActivityRequest")).filter(row => !before.has(row.id));
      assert.equal(added.length, 1); await checkAudit(a, t, String(added[0].id), 500, authorization ? "token_request" : t.session ? "user" : "anonymous");
      assert.equal(t.audit, 1);
    }

    await root.test("independent full-row multiset/count/privacy oracles reject omissions, duplicates, additions and hidden scalars", async () => {
      comparatorNegatives();
      const expected = literal();
      for (const mutate of [
        (data: Rows) => { data.coachFields.pop(); }, (data: Rows) => { data.coachFields.push({ ...data.coachFields[0] }); },
        (data: Rows) => { data.coaches[0]._id = id(1); }, (data: Rows) => { delete data.coaches[0].accessToken; },
        (data: Rows) => { data.privateProfiles[0].coachId = id(99); }
      ]) { const bad = structuredClone(expected); mutate(bad); assert.throws(() => assertData(bad, expected)); }
      assert.throws(() => noLeaks([...Array(101).fill("safe"), CANARY]));
      assert.throws(() => noLeaks("safe".repeat(5000) + CANARY));
      const bad = trace(); bad.clientCloses = 1; assert.throws(() => observations(bad));
    });
    await root.test("shared rich 12-model literal oracle; SQL-null and encrypted JSON-null retain distinct storage and identical public null", async () => {
      const a = await create("rich", false);
      for (const [model, rows] of Object.entries(seedRows("rich"))) for (const row of rows) {
        const input = { ...row };
        if (model === "CoachImportRun" && input.summary === null) input.summary = input.id === JSON_NULL_RUN_ID ? MongoJsonNull : MongoDbNull;
        await a.store.collection(model).insertOne(encodeMongoRuntimeDocument(model, input));
      }
      const sqlNull = await a.store.collection("CoachImportRun").findOne({ _id: uuid(91) });
      const jsonNull = await a.store.collection("CoachImportRun").findOne({ _id: JSON_NULL_RUN_ID });
      assert.ok(sqlNull && jsonNull); assert.equal(sqlNull.summary, null);
      assert.notEqual(jsonNull.summary, null); assert.match(inspect(jsonNull.summary), /pii:v1:backupfixture:/);
      const before = await raw(a), started = Date.now();
      noLeaks(before, ["synthetic-access-a", "synthetic-feedback", "synthetic@example.invalid", "synthetic-hidden-error"]);
      const { body } = await success(a, expectedResponseData("rich")); checkBody(body, "rich", started, Date.now());
      assert.deepEqual(await raw(a), before);
    });
    await root.test("actual POST empty arrays and full 11-array decrypted public fields, soft-delete, compound PK and JSON preserved; raw unchanged", async () => {
      const e = await create("empty", false); await success(e, empty());
      const a = await create(), before = await raw(a); noLeaks(before);
      await success(a, literal()); assert.deepEqual(await raw(a), before);
      const stored = await a.store.collection("Coach").findOne({ _id: id(1) }); assert.ok(stored);
      assert.match(String(stored.accessToken), /^pii:v1:backupfixture:/); assert.match(String(stored.accessTokenPiiIndex), /^[a-f0-9]{64}$/);
      assert.equal((await client.db(a.databaseName).command({ ping: 1 })).ok, 1);
    });
    await root.test("snapshot six fields select newest 20 of 21 all statuses; corrupt unselected errorMessage ignored, selected type rejected", async () => {
      const a = await create(), expected = literal();
      for (let n = 0; n < 21; n++) {
        const started = new Date(Date.UTC(2026, 8, n + 1)).toISOString(), status = ["running", "failed", "completed"][n % 3];
        await a.store.collection("CoachdbArchiveSnapshot").insertOne(encodeMongoRuntimeDocument("CoachdbArchiveSnapshot", {
          id: id(100 + n), sourceDatabase: "synthetic-archive", sourceSchema: "public", tableCount: n, rowCount: n * 2,
          status, errorMessage: PRIVATE, startedAt: started, finishedAt: n % 2 ? LATER : null
        }));
        if (n) expected.archiveSnapshots.unshift({ id: id(100 + n), table_count: n, row_count: n * 2, status,
          started_at: started, finished_at: n % 2 ? LATER : null });
      }
      await a.store.collection("CoachdbArchiveSnapshot").updateMany({}, { $set: { errorMessage: CANARY, errorMessagePiiIndex: "corrupt-unselected-index" } }, { bypassDocumentValidation: true });
      const before = await raw(a), result = await success(a, expected); assert.deepEqual(await raw(a), before);
      const finds = result.t.wire.filter(event => event.commandName === "find" && event.command.find === "shadow_backup_CoachdbArchiveSnapshot");
      assert.ok(finds.length > 0);
      for (const event of finds) {
        assert.deepEqual(event.command.projection, { _id: 1, tableCount: 1, rowCount: 1, status: 1, startedAt: 1, finishedAt: 1 });
        const sort = event.command.sort;
        assert.deepEqual(sort instanceof Map ? [...sort.entries()] : Object.entries(sort), [["startedAt", -1]]);
        assert.equal(event.command.limit, 20);
      }
      await a.store.collection("CoachdbArchiveSnapshot").updateOne({ _id: id(120) }, { $set: { tableCount: "invalid" } }, { bypassDocumentValidation: true });
      const corrupted = await raw(a); await reject(a, trace()); assert.deepEqual(await raw(a), corrupted);
    });
    await root.test("actual auth matrix preserves Bearer/session precedence and rejection; data reads zero while wrapper audits", async () => {
      const a = await create();
      const secret = trace(null); await success(a, literal(), secret); assert.equal(secret.auth, 0);
      const wrong = trace(); await success(a, literal(), wrong, "Bearer synthetic-wrong"); assert.equal(wrong.auth, 1);
      const cookie = trace(); await success(a, literal(), cookie, null); assert.equal(cookie.auth, 2);
      for (const email of [null, "synthetic-nonadmin@day1company.co.kr", "outside@synthetic.invalid"]) {
        const t = trace(email ? { user: { email, name: "Synthetic admin" } } : null);
        await reject(a, t, DENIED, "Bearer synthetic-wrong"); assert.equal(t.reads, 0); assert.equal(t.auth, 1);
      }
      for (const admins of ["", "synthetic-other@day1company.co.kr"]) {
        process.env.ADMIN_EMAILS = admins; const t = trace(); await reject(a, t, DENIED, "Bearer synthetic-wrong"); assert.equal(t.reads, 0);
      }
      process.env.ADMIN_EMAILS = ADMIN;
      delete process.env.BACKUP_API_SECRET; const absent = trace(null); await reject(a, absent, DENIED); assert.equal(absent.reads, 0);
      process.env.BACKUP_API_SECRET = SECRET; process.env.DEV_AUTH_BYPASS = "true";
      const bypass = trace(null); await reject(a, bypass, DENIED, "Bearer wrong"); assert.equal(bypass.reads, 0);
      process.env.DEV_AUTH_BYPASS = "false";
    });
    await root.test("missing ports/nested empty scope fail closed, outer scope restores, audit failure stays best-effort without PG fallback", async () => {
      const a = await create(), missing = trace();
      await assert.rejects(invoke(a, missing, null, { adminBackup: a.scope.adminBackup }), { message: "DATA_REPOSITORY_NOT_CONFIGURED: requestActivity" });
      assert.deepEqual({ auth: missing.auth, reads: missing.reads, audit: missing.audit, wire: missing.wire }, { auth: 0, reads: 0, audit: 0, wire: [] }); observations(missing);
      const t = trace(); await reject(a, t, "DATA_REPOSITORY_NOT_CONFIGURED: adminBackup", null, { requestActivity: a.scope.requestActivity }); assert.equal(t.reads, 0);
      await runWithDataRepositories(a.scope, async () => {
        const nested = trace(); await assert.rejects(invoke(a, nested, null, {}), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
        assert.equal(nested.auth, 0); assert.equal(getDataRepositoryOverride("adminBackup"), a.scope.adminBackup);
        assert.equal(getDataRepositoryOverride("requestActivity"), a.scope.requestActivity); await success(a, literal());
      });
      const failed = trace(), count = await a.store.collection("ActivityRequest").countDocuments();
      const response = await invoke(a, failed, null, { ...a.scope, requestActivity: { recordRequest: async () => { failed.audit++; throw new Error(CANARY); } } });
      assert.equal(response.status, 200); assertData((await response.json()).data, literal());
      assert.equal(await a.store.collection("ActivityRequest").countDocuments(), count); assert.equal(failed.audit, 1);
      assert.deepEqual(failed.logs, [["[activity] API request log write failed"]]); observations(failed);
    });
    await root.test("overlapping A/B use isolated snapshot data and native encrypted request audit", async () => {
      const a = await create("a"), b = await create("b"), entered = barrier(), release = barrier();
      const ta = trace(), tb = trace(); let held = false;
      ta.after = async (collection, row) => { if (!held && row && collection.endsWith("_Coach")) { held = true; entered.release(); await release.promise; } };
      const pending = success(a, literal("a"), ta);
      try { await waitEntered(entered.promise, pending); const rb = await success(b, literal("b"), tb); release.release(); const ra = await pending;
        assert.notEqual(ra.response.headers.get("X-Request-Id"), rb.response.headers.get("X-Request-Id"));
        assert.equal(await a.store.collection("ActivityRequest").countDocuments({ _id: rb.response.headers.get("X-Request-Id")! }), 0);
        assert.equal(await b.store.collection("ActivityRequest").countDocuments({ _id: ra.response.headers.get("X-Request-Id")! }), 0);
      } finally { release.release(); await pending; }
    });
    await root.test("actual write between sequential model reads remains outside the single backup snapshot", async () => {
      const a = await create(), entered = barrier(), release = barrier(), t = trace(); let held = false;
      t.after = async (collection, row) => { if (!held && row && collection.endsWith("_Coach")) { held = true; entered.release(); await release.promise; } };
      const pending = success(a, literal(), t);
      try {
        await waitEntered(entered.promise, pending);
        await a.store.collection("CoachFieldMaster").updateOne({ _id: id(2) }, { $set: { name: "synthetic-concurrent-field" } });
        assert.equal((await a.store.collection("CoachFieldMaster").findOne({ _id: id(2) }))?.name, "synthetic-concurrent-field");
        release.release(); await pending;
        const expected = literal(); expected.fields[0].name = "synthetic-concurrent-field"; await success(a, expected);
        const reads = t.wire.filter(event => event.commandName === "find" && !String(event.command.find).includes("Activity"));
        assert.ok(reads.length >= 12); assert.equal(t.sessions, 1);
        assert.equal(reads[0].command.readConcern?.level, "snapshot");
        for (const event of reads) { assert.deepEqual(event.command.lsid, reads[0].command.lsid); assert.equal(event.command.autocommit, false); }
      } finally { release.release(); await pending; }
    });
    await root.test("later-model injected cursor failure and real corrupt encrypted row reject whole POST; recovery preserves borrowed client", async () => {
      const a = await create(), before = await raw(a), t = trace(); let injected = 0;
      t.after = async collection => { if (collection.endsWith("_CoachImportRun")) { injected++; throw new Error(CANARY); } };
      await reject(a, t); assert.ok(injected > 0); assert.deepEqual(await raw(a), before);
      const original = await a.store.collection("Coach").findOne({ _id: id(1) }); assert.ok(original);
      await a.store.collection("Coach").updateOne({ _id: id(1) }, { $set: { accessToken: "pii:v1:broken" } }, { bypassDocumentValidation: true });
      const corrupted = await raw(a); await reject(a, trace()); assert.deepEqual(await raw(a), corrupted);
      await a.store.collection("Coach").replaceOne({ _id: id(1) }, original);
      await success(a, literal()); assert.deepEqual(await raw(a), before);
    });
    await root.test("aggregate rows: 9999 + 10000 + one selected metadata equals 20000; next row rejects without partial JSON", async () => {
      const a = await create("rows", false), expected = empty();
      for (const [key, model, count, base] of [
        ["fields", "CoachFieldMaster", 9999, 1000], ["curriculums", "CoachCurriculumMaster", 10000, 20000]
      ] as const) {
        const rows = Array.from({ length: count }, (_, n) => ({ id: id(base + n), name: `synthetic-budget-${base + n}` }));
        expected[key] = rows;
        await a.store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
      }
      await a.store.collection("CoachdbArchiveSnapshot").insertOne(encodeMongoRuntimeDocument("CoachdbArchiveSnapshot", {
        id: id(40000), sourceDatabase: "synthetic", sourceSchema: "public", tableCount: 2, rowCount: 19999,
        status: "running", errorMessage: null, startedAt: DATE, finishedAt: null
      }));
      expected.archiveSnapshots = [{ id: id(40000), table_count: 2, row_count: 19999, status: "running", started_at: DATE, finished_at: null }];
      await success(a, expected);
      await a.store.collection("CoachFieldMaster").insertOne(encodeMongoRuntimeDocument("CoachFieldMaster", { id: id(19999), name: "synthetic-one-over" }));
      const overflow = await raw(a), t = trace(); await reject(a, t); assert.deepEqual(await raw(a), overflow);
      assert.ok(t.seen.includes("shadow_backup_CoachdbArchiveSnapshot"), "failure must include metadata in the accumulated limit");
      assert.equal(await a.store.collection("CoachFieldMaster").countDocuments(), 10000);
      assert.equal(await a.store.collection("CoachCurriculumMaster").countDocuments(), 10000);
      await a.store.collection("CoachFieldMaster").deleteOne({ _id: id(19999) }); await success(a, expected);
    });
    await root.test("aggregate BSON bytes include selected metadata: exact 32MiB succeeds, +1 byte distributed across models rejects", async () => {
      const a = await create("bytes", false), expected = empty();
      const metadata = { _id: id(50000), tableCount: 2, rowCount: 3, status: "running", startedAt: new Date(DATE), finishedAt: null };
      const total = 32 * 1024 * 1024, available = total - BSON.calculateObjectSize(metadata);
      const sizes = [Math.floor(available / 3), Math.floor(available / 3), available - 2 * Math.floor(available / 3)];
      const documents: Document[] = [];
      for (let n = 0; n < 3; n++) {
        const model = n < 2 ? "CoachFieldMaster" : "CoachCurriculumMaster", key = n < 2 ? "fields" : "curriculums";
        const skeleton = { _id: id(50001 + n), name: String(n) };
        const name = String(n) + "x".repeat(sizes[n] - BSON.calculateObjectSize(skeleton));
        const row = { id: id(50001 + n), name }, document = encodeMongoRuntimeDocument(model, row);
        assert.equal(BSON.calculateObjectSize(document), sizes[n]); assert.ok(sizes[n] < 16 * 1024 * 1024);
        documents.push(document); expected[key].push(row); await a.store.collection(model).insertOne(document);
      }
      await a.store.collection("CoachdbArchiveSnapshot").insertOne(encodeMongoRuntimeDocument("CoachdbArchiveSnapshot", {
        id: id(50000), sourceDatabase: "synthetic", sourceSchema: "public", tableCount: 2, rowCount: 3,
        status: "running", errorMessage: null, startedAt: DATE, finishedAt: null
      }));
      expected.archiveSnapshots = [{ id: id(50000), table_count: 2, row_count: 3, status: "running", started_at: DATE, finished_at: null }];
      assert.equal(documents.reduce((sum, document) => sum + BSON.calculateObjectSize(document), BSON.calculateObjectSize(metadata)), total);
      const before = await raw(a); await success(a, expected); assert.deepEqual(await raw(a), before);
      await a.store.collection("CoachCurriculumMaster").updateOne({ _id: id(50003) }, { $set: { name: `${expected.curriculums[0].name}x` } });
      const overflow = await raw(a), t = trace(); await reject(a, t); assert.deepEqual(await raw(a), overflow);
      assert.ok(t.seen.includes("shadow_backup_CoachdbArchiveSnapshot"));
      await a.store.collection("CoachCurriculumMaster").updateOne({ _id: id(50003) }, { $set: { name: expected.curriculums[0].name } });
      await success(a, expected);
    });
    await root.test("synthetic monotonic clock: cumulative 59999ms success / 60000ms failure; per-model and later-page clocks do not reset", async () => {
      const a = await create("clock", false); let now = 0;
      const timed = await MongoAdminBackupRepository.open({ ...a.options, clock: () => now });
      const original = a.scope.adminBackup;
      a.scope.adminBackup = { read: async () => { const t = traces.getStore(); if (t) t.reads++; return timed.read(); } };
      try {
        for (const last of [4999, 5000]) {
          now = 0; const t = trace(), seen = new Set<string>();
          t.after = async collection => {
            if (!ADMIN_BACKUP_READ_MODELS.some(model => collection === `shadow_backup_${model}`) || seen.has(collection)) return;
            seen.add(collection); now += collection.endsWith("_CoachdbArchiveSnapshot") ? last : 5000;
          };
          if (last === 4999) await success(a, empty(), t); else await reject(a, t);
          assert.equal(seen.size, 12); assert.equal(now, 55000 + last);
          assert.deepEqual(t.finds.filter(call => call.backup && call.collection === "shadow_backup_CoachdbArchiveSnapshot")
            .map(call => call.timeoutMS), [5000]);
        }
        now = 0; const scan = trace(); let advanced = false;
        scan.after = async collection => { if (!advanced && collection.endsWith("_Coach")) { advanced = true; now = 15000; } };
        await reject(a, scan); assert.equal(advanced, true); assert.ok(!scan.seen.includes("shadow_backup_CoachPrivateProfile"));
        await a.store.collection("CoachFieldMaster").insertMany(Array.from({ length: 101 }, (_, n) =>
          encodeMongoRuntimeDocument("CoachFieldMaster", { id: id(60000 + n), name: `synthetic-clock-${n}` })));
        now = 0; let pages = 0; const later = trace(), visited = new Set<FindCursor>();
        later.after = async (collection, row) => {
          if (!row || !collection.endsWith("_CoachFieldMaster")) return;
          const cursor = [...later.cursors].at(-1)!;
          if (!visited.has(cursor)) { visited.add(cursor); pages++; now += 8000; }
        };
        await reject(a, later); assert.equal(pages, 2); assert.equal(now, 16000);
        assert.deepEqual(later.finds.filter(call => call.backup && call.collection === "shadow_backup_CoachFieldMaster")
          .map(call => call.timeoutMS), [15000, 7000]);
        assert.ok(!later.seen.includes("shadow_backup_CoachCurriculumMaster"));
      } finally { a.scope.adminBackup = original; }
      await success(a, { ...empty(), fields: Array.from({ length: 101 }, (_, n) => ({ id: id(60000 + n), name: `synthetic-clock-${n}` })) });
    });
    await root.test("unprepared and mismatched stores reject without DDL/repair; closed borrowed client fails safely", async () => {
      const a = await create("readiness", false);
      const invalid = trace();
      await assert.rejects(traces.run(invalid, () => MongoAdminBackupRepository.open({ ...a.options, databaseName: "production" })), fixed);
      assert.deepEqual(invalid.wire, []); observations(invalid);
      await a.store.collection("Coach").drop();
      const t = trace(); await assert.rejects(traces.run(t, () => MongoAdminBackupRepository.open(a.options)), fixed); observations(t);
      assert.equal((await a.store.db.listCollections({ name: "shadow_backup_Coach" }).toArray()).length, 0);
      // A later mismatched model must prevent creating the earlier missing Coach.
      await a.store.db.command({ collMod: "shadow_backup_CoachImportRun", validationLevel: "off" });
      const before = await a.store.db.listCollections({}, { nameOnly: false }).toArray(), setup = trace();
      await assert.rejects(traces.run(setup, () => prepareMongoAdminBackupStore(a.options)), fixed); observations(setup);
      assert.deepEqual(await a.store.db.listCollections({}, { nameOnly: false }).toArray(), before);
      const healthy = await create("closed", false);
      const borrowed = new MongoClient(URI, { directConnection: true, serverSelectionTimeoutMS: 5000 });
      try {
        await borrowed.connect(); const repo = await MongoAdminBackupRepository.open({ ...healthy.options, client: borrowed });
        await borrowed.close(); const closed = trace();
        await assert.rejects(traces.run(closed, () => repo.read()), fixed); observations(closed);
      } finally { await borrowed.close(); }
      await success(healthy, empty());
    });
    await root.test("actual native blocked find obeys 15s driver deadline; failpoint reset, no pending read, same-client recovery", async () => {
      const a = await create("native-timeout", false), t = trace();
      const control = new MongoClient(URI, { directConnection: true, serverSelectionTimeoutMS: 5000, appName: `${appName}-control` });
      let resetNeeded = false;
      async function reset() {
        await control.db("admin").command({ configureFailPoint: "failCommand", mode: "off" }, { timeoutMS: 20_000 }); resetNeeded = false;
      }
      try {
        await control.connect();
        const enabled = await control.db("admin").command({ getParameter: 1, enableTestCommands: 1 });
        assert.ok(enabled.enableTestCommands === true || enabled.enableTestCommands === 1);
        // Capture the audit baseline before arming find failure: helper reads must
        // not consume the one-shot fault intended for the actual backup scan.
        const before = await raw(a), beforeIds = new Set((await a.store.scan("ActivityRequest")).map(row => row.id));
        const armed = await control.db("admin").command({ configureFailPoint: "failCommand", mode: { times: 1 },
          data: { failCommands: ["find"], appName, blockConnection: true, blockTimeMS: 18_000 } }); resetNeeded = true;
        assert.ok(Number.isInteger(armed.count));
        const started = performance.now();
        // No observer find is issued while the one-shot fault is armed. The
        // actual POST trace and the server entry counter both identify its target.
        const outcomes = await Promise.allSettled([
          assert.rejects(invoke(a, t), fixed),
          control.db("admin").command({ waitForFailPoint: "failCommand", timesEntered: armed.count + 1, maxTimeMS: 5000 }, { timeoutMS: 6000 })
        ]);
        const elapsed = performance.now() - started;
        for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
        assert.ok(elapsed >= 12_000 && elapsed < 25_000);
        assert.ok(t.errors.some(error => error instanceof MongoOperationTimeoutError || (error instanceof MongoServerError && error.code === 50)));
        const firstFind = t.wire.find(event => event.commandName === "find"); assert.ok(firstFind);
        assert.equal(firstFind.databaseName, a.databaseName); assert.equal(firstFind.command.find, "shadow_backup_Coach");
        assert.equal(firstFind.command.startTransaction, true); assert.equal(firstFind.command.autocommit, false);
        assert.equal(firstFind.command.readConcern?.level, "snapshot");
        const delegated = t.finds.filter(call => call.backup);
        assert.equal(delegated.length, 1); assert.equal(delegated[0].collection, "shadow_backup_Coach");
        assert.ok(typeof delegated[0].timeoutMS === "number" && delegated[0].timeoutMS > 0 && delegated[0].timeoutMS <= 15000);
        assert.equal(t.reads, 1); assert.equal(t.audit, 1);
        assert.ok(!t.seen.includes("shadow_backup_CoachPrivateProfile"));
        await reset();
        // This checks eventual absence after reset, not server cancellation at
        // the exact instant of the client's timeout.
        const cleanupDeadline = performance.now() + 20_000;
        while (true) {
          const pending = await control.db("admin").command({ currentOp: 1, active: true, "command.find": { $exists: true },
            $or: [{ appName }, { "clientMetadata.application.name": appName }] }, { timeoutMS: 5000 });
          assert.ok(Array.isArray(pending.inprog)); if (pending.inprog.length === 0) break;
          assert.ok(performance.now() < cleanupDeadline, "owned native read still active after bounded cleanup");
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.deepEqual(await raw(a), before);
        const added = (await a.store.scan("ActivityRequest")).filter(row => !beforeIds.has(row.id));
        assert.equal(added.length, 1); await checkAudit(a, t, String(added[0].id), 500);
        await success(a, empty());
      } finally { try { if (resetNeeded) await reset(); } finally { await control.close(); } }
    });
  } finally {
    const cleanup = await Promise.allSettled(owned.map(async databaseName => {
      assert.match(databaseName, /^hub_om_shadow_backup_[a-f0-9]{16}$/);
      // Fixture-owned resource cleanup has its own cumulative 30s allowance.
      const deadline = performance.now() + 30_000;
      const remaining = () => { const ms = Math.floor(deadline - performance.now()); assert.ok(ms > 0, "Fixture cleanup exceeded 30s"); return ms; };
      await client.db(databaseName).dropDatabase({ timeoutMS: remaining() });
      const cursor = client.db(databaseName).listCollections({}, { nameOnly: true, timeoutMS: remaining() });
      try { assert.equal((await cursor.toArray()).length, 0); }
      finally { await cursor.close({ timeoutMS: remaining() }); }
      remaining();
    }));
    for (const restore of restores.reverse()) restore(); await client.close();
    for (const key of keys) delete process.env[key];
    for (const result of cleanup) if (result.status === "rejected") throw result.reason;
  }
});
