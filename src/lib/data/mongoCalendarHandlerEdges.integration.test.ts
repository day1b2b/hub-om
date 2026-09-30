/** Calendar validation-v2 H5/H10b/H2 and F10/F11/F14/F15 edge fixtures.
 * Parent-only execution; explicit loopback opt-in. The original handler/helper
 * remain read-only. Google state is independent of Mongo and event builders.
 * Driver ACK/owner faults below are labelled; they are NOT natural lease expiry,
 * process-crash, real network loss, or frozen-original PG parity evidence.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { ClientSession, Collection, Long, MongoClient, MongoServerError, ReadConcern, type CommandStartedEvent } from "mongodb";
import ts from "typescript";
import { activityContext } from "../activity/context";
import { runWithDataRepositories, type DataRepositories } from "./dataRepositoryContext";
import { MongoOperationStore, OPERATION_MODELS, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { coachFixtureRow } from "./mongoCoachFixtures";
import type { CreateOperationInput } from "./operationTypes";
import type { ImportPromotionResult } from "./importPromotionContract";
import { CALENDAR_ID, PRIVATE_MARKER, SyntheticCalendarRemote, expectedEventId } from "./mongoCalendarHandlers.fixture";

type Actor = { user: { email: string; name: string }; expires: string };
const actorA: Actor = { user: { email: "calendar-edge-a@day1company.co.kr", name: "Synthetic edge A" }, expires: "" };
const actorB: Actor = { user: { email: "calendar-edge-b@day1company.co.kr", name: "Synthetic edge B" }, expires: "" };
const actors = new AsyncLocalStorage<Actor>();
type Probe = { paths: string[]; requestId?: string };
const probes = new AsyncLocalStorage<Probe>();
const remotes = new AsyncLocalStorage<SyntheticCalendarRemote>();
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
// Only the calendar-day seam; server $$NOW and all lease/transaction clocks are real.
mock.module("@/lib/seoulDate", { namedExports: { getSeoulToday: () => new Date(2099, 10, 30) } });
let pgAdapterCalls = 0, pgPoolCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
  constructor() { pgAdapterCalls++; throw new Error("EDGE_PG_ADAPTER_TRIPWIRE"); }
} } });
class PgPoolTripwire { constructor() { pgPoolCalls++; throw new Error("EDGE_PG_POOL_TRIPWIRE"); } }
mock.module("pg", { namedExports: { Pool: PgPoolTripwire }, defaultExport: { Pool: PgPoolTripwire } });
mock.module("next/cache.js", { namedExports: { revalidatePath: (path: string) => {
  const p = probes.getStore(); assert.ok(p); p.paths.push(path);
} } });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return next(["next/server", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText, shortCircuit: true };
    return next(url, context);
  }
});
const { prepareMongoCalendarRuntimeStore, openMongoCalendarRuntime } = await import("./mongoCalendarRuntime");
const { CALENDAR_LEASE_TIMING } = await import("./mongoCalendarOperationLock");
const { POST } = await import("../../app/api/admin/imports/[id]/promote/route");
const { resetAccessTokenCache } = await import("../googleCalendar/calendarWriteClient");
const { withCalendarOperationLock } = await import("../googleCalendar/calendarOperationLock");
const { getPrismaClient } = await import("./prisma");
const { PrismaOperationRepository } = await import("./prismaOperationRepository");
const { PrismaImportPromotionRepository } = await import("./prismaImportPromotionRepository");
const { PrismaTeamMemberRepository } = await import("./prismaTeamMemberRepository");
const pgPersistence = await import("../googleCalendar/prismaCalendarPersistence");
hooks.deregister();

const uri = process.env.MONGODB_CALENDAR_TEST_URI;
const EXACT_URI = "mongodb://127.0.0.1:27849/?replicaSet=calendarboundary20260930";
const CALENDAR_B = "synthetic-calendar-2@example.invalid";
const ROUTE = "/api/admin/imports/[id]/promote";
const OP = "synthetic-calendar-edge-r";
const OP_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const EMPTY: ImportPromotionResult = { sourceRows: 0, eligible: 0, blocked: 0, blockedReasons: {}, created: 0, linkedExisting: 0, revived: 0 };
const RESTORED: ImportPromotionResult = { ...EMPTY, sourceRows: 1, eligible: 1, revived: 1 };
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const paths = ["/", "/operations", "/admin/imports", `/admin/imports/${RUN_ID}`];
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("EDGE_BARRIER_TIMEOUT")), 8000); })]); }
  finally { clearTimeout(timer); }
}
async function reached(signal: ReturnType<typeof barrier>, pending: Promise<unknown>) {
  await bounded(Promise.race([signal.promise, pending.then(() => { throw new Error("EDGE_COMPLETED_BEFORE_BARRIER"); })]));
}
function ackError(code: 50 | 91): MongoServerError {
  const error = new MongoServerError({ code, message: `${PRIVATE_MARKER}-commit-ack` });
  error.addErrorLabel("UnknownTransactionCommitResult"); return error;
}

test("Calendar handler edges: real API/backfill with scoped native Mongo and labelled driver faults", { skip: !uri, timeout: 300_000 }, async suite => {
  assert.equal(uri, EXACT_URI);
  const env = {
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/calendar_edges_tripwire", OPERATION_DATA_SOURCE: "local",
    ADMIN_EMAILS: "calendar-admin@day1company.co.kr", DEV_AUTH_BYPASS: "false",
    GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-calendar-client", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-calendar-secret",
    GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-calendar-refresh", GOOGLE_CAL_PART_CALENDARS: `1파트:${CALENDAR_ID},2파트:${CALENDAR_B}`,
    HUB_OM_BASE_URL: "", SLACK_CALENDAR_ALERT_EMAIL: "", SLACK_BOT_TOKEN: "synthetic-calendar-slack-token"
  };
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  const globals = globalThis as unknown as { prisma?: unknown; calendarLockPool?: unknown };
  const previousPrisma = globals.prisma, previousPool = globals.calendarLockPool;
  delete globals.prisma; delete globals.calendarLockPool; Object.assign(process.env, env);
  const logs: unknown[][] = [];
  const loggers = (["error", "warn", "info", "log", "debug"] as const).map(level => mock.method(console, level, (...values: unknown[]) => { logs.push(values); }));
  let unexpectedFetch = 0;
  const fetchMock = mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const remote = remotes.getStore();
    if (!remote) { unexpectedFetch++; throw new Error("EDGE_EXTERNAL_FETCH_TRIPWIRE"); }
    return remote.fetch(input, init);
  });
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const observer = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_calendar_edges_${randomBytes(8).toString("hex")}`;
  let owned = false;
  const allRemotes: SyntheticCalendarRemote[] = [];
  try {
    assert.throws(() => getPrismaClient(), /EDGE_PG_ADAPTER_TRIPWIRE/);
    await assert.rejects(() => withCalendarOperationLock("edge-pg-control", async () => undefined), /EDGE_PG_POOL_TRIPWIRE/);
    assert.equal(pgAdapterCalls, 1); assert.equal(pgPoolCalls, 1); pgAdapterCalls = 0; pgPoolCalls = 0;
    await Promise.all([client.connect(), observer.connect()]);
    assert.equal((await client.db(databaseName).listCollections().toArray()).length, 0); owned = true;
    async function fixture(input: { part?: 1 | 2; remote?: SyntheticCalendarRemote; singleDate?: boolean; newOnly?: boolean } = {}) {
      const options = { client, databaseName, namespace: `shadow_calendar_edge_${randomBytes(6).toString("hex")}`, allowShadowWrites: true as const };
      await prepareMongoCalendarRuntimeStore({ ...options, processSequenceHighWater: 100 });
      const runtime = await openMongoCalendarRuntime(options);
      const store = new MongoOperationStore(options, [...new Set([...OPERATION_MODELS, "CalendarEventLink", "DataImportRun", "ActivityRequest"])]);
      const remote = input.remote ?? new SyntheticCalendarRemote(); if (!allRemotes.includes(remote)) allRemotes.push(remote);
      const seed = async (model: string, fields: MongoRow) => {
        const row = coachFixtureRow(model, fields); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
      };
      for (const [role, name] of [["OM", "가상CalendarEdgeOM"], ["LD", "가상CalendarEdgeLD"]]) {
        await seed("TeamUser", { role, name, team: `AX ${input.part ?? 1}파트`, email: `calendar-edge-${role.toLowerCase()}@example.invalid`, slackId: `synthetic-edge-${role}` });
      }
      const dates = input.singleDate ? ["2099-12-01"] : ["2099-12-01", "2099-12-02", "2099-12-04"];
      const fields = { companyName: "Synthetic Calendar Edge Company", courseName: "Synthetic Calendar Edge Course", courseId: "1001",
        om: "가상CalendarEdgeOM", ld: "가상CalendarEdgeLD", roundNo: "1", educationDays: String(dates.length), operationStatus: "배정필요",
        startDate: dates[0], endDate: dates.at(-1)! };
      if (!input.newOnly) {
        const company = await seed("Company", { name: fields.companyName, normalizedName: fields.companyName.toLowerCase() });
        const course = await seed("Course", { companyId: company.id, processSeq: 1, name: fields.courseName, courseId: fields.courseId, operationType: "NEEDS_REVIEW" });
        await seed("OperationSession", { id: OP_ID, operationId: OP, courseRecordId: course.id, sourceFingerprint: "a".repeat(64),
          operationStatus: "ASSIGNMENT_NEEDED", archiveStatus: "NOT_READY", educationFormat: "NEEDS_REVIEW", operationChannel: "NEEDS_REVIEW",
          roundNo: "1", educationDays: fields.educationDays, startDate: day(fields.startDate), endDate: day(fields.endDate), educationDates: dates.map(day),
          omName: fields.om, ldName: fields.ld, onsiteOmName: null, instructorsText: null, timeText: null, region: null,
          deletedAt: day("2099-11-29"), deletedBy: actorA.user.email, createdAt: day("2099-11-01"), updatedAt: day("2099-11-29") });
      }
      await seed("DataImportRun", { id: RUN_ID, sourceType: "csv", sourceName: "Synthetic Edge Import", importedBy: actorA.user.email,
        status: "COMPLETED", sourceTeam: "TEAM_1", rowCount: 1, successCount: 1, errorCount: 0 });
      const source = await seed("OperationSourceRecord", { importRunId: RUN_ID, operationSessionId: null, sourceTeam: "TEAM_1",
        sourceWorkbook: "synthetic-calendar-edges.csv", sourceSheet: "synthetic", sourceRowNumber: 2, headerRowNumber: 1, sourceFingerprint: "a".repeat(64),
        mappedFields: fields, rowSnapshot: { synthetic: PRIVATE_MARKER }, unmappedFields: {}, validationErrors: [] });
      const raw = async (all = false) => {
        const names = (await store.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name)
          .filter(name => name.startsWith(`${options.namespace}_`) && (all || !name.endsWith("_ActivityRequest") && !name.endsWith("_CalendarOperationLease"))).sort();
        return Promise.all(names.map(async name => {
          const rows = await store.db.collection(name).find({}).sort({ _id: 1 }).toArray();
          // Same narrow normalization as the parent handler: the internal
          // serialization nonce may change on replay, all business bytes remain.
          if (!all && name === `${options.namespace}_CourseNameRestoreGuard`) {
            return [name, rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "nonce")))];
          }
          return [name, rows];
        }));
      };
      return { options, runtime, store, remote, source, fields, dates, raw, calendarId: input.part === 2 ? CALENDAR_B : CALENDAR_ID };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const invoke = (f: Fixture, p: Probe = { paths: [] }, actor = actorA) => f.runtime.run(() => actors.run(actor, () => probes.run(p, () => remotes.run(f.remote, () => {
      return POST(new Request(`https://example.invalid/api/admin/imports/${RUN_ID}/promote`, { method: "POST" }), { params: Promise.resolve({ id: RUN_ID }) });
    }))));
    async function audit(f: Fixture, response: Response, actor = actorA) {
      const id = response.headers.get("X-Request-Id"); assert.ok(id);
      const row = await f.store.one("ActivityRequest", { _id: id }); assert.ok(row);
      assert.equal(row.route, ROUTE); assert.equal(row.method, "POST"); assert.equal(row.status, response.status);
      assert.equal(row.actorType, "user"); assert.equal(row.actorEmail, actor.user.email); assert.equal(row.actorName, actor.user.name);
      return id;
    }
    async function success(f: Fixture, response: Response, inserted: number, failed: number, result = RESTORED, actor = actorA) {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, result, calendar: { insertedEvents: inserted, failedOperations: failed } });
      return audit(f, response, actor);
    }
    async function committed(f: Fixture) {
      const source = await f.store.one("OperationSourceRecord", { _id: String(f.source.id) }); assert.ok(source?.operationSessionId);
      const op = await f.store.one("OperationSession", { _id: String(source.operationSessionId) }); assert.ok(op); assert.equal(op.deletedAt, null);
      const course = await f.store.one("Course", { _id: String(op.courseRecordId) }); assert.ok(course);
      assert.ok(await f.store.one("Company", { _id: String(course.companyId) }));
      const changes = await f.store.scan("ActivityChange"); assert.ok(changes.every(row => !["data_import_runs", "operation_source_records"].includes(String(row.targetType))));
      return op;
    }
    async function state(f: Fixture, remoteCount: number, mappings: number, posts: number, requestId?: string) {
      const op = await committed(f);
      assert.equal(f.remote.active().length, remoteCount); assert.equal(f.remote.calls("event", "POST").length, posts);
      const links = await f.store.scan("CalendarEventLink"); assert.equal(links.length, mappings);
      const changes = await f.store.scan("ActivityChange", { targetType: "calendar_event_links" }); assert.equal(changes.length, mappings);
      for (const link of links) {
        assert.equal(link.operationId, op.operationId); assert.equal(link.calendarId, f.calendarId);
        assert.equal(link.eventId, expectedEventId(String(op.operationId), (link.eventDate as Date).toISOString().slice(0, 10), "", f.calendarId));
        assert.ok(f.remote.events.get(f.calendarId)?.get(String(link.eventId)));
      }
      for (const change of changes) {
        assert.equal(change.action, "create"); if (requestId) assert.equal(change.requestId, requestId);
        const values = change.changes as Record<string, unknown>;
        assert.deepEqual(values.calendar_id, { redacted: true }); assert.deepEqual(values.event_id, { redacted: true });
      }
      for (const call of f.remote.calls("event", "POST")) assert.equal(call.sendUpdates, "none");
      return { links, changes };
    }
    function clean() {
      assert.equal(pgAdapterCalls, 0); assert.equal(pgPoolCalls, 0); assert.equal(unexpectedFetch, 0);
      for (const remote of allRemotes) { assert.deepEqual(remote.violations, []); assert.equal(remote.calls("slack").length, 0); }
      const text = inspect(logs, { depth: null });
      for (const value of [PRIVATE_MARKER, CALENDAR_ID, CALENDAR_B, actorA.user.email, actorB.user.email, "가상CalendarEdgeOM", "가상CalendarEdgeLD", "synthetic-calendar-token"]) assert.ok(!text.includes(value));
    }

    await suite.test("H2 mixed client: all eight real ports from same DB/namespace but different MongoClient reject before actual POST", async () => {
      const f = await fixture();
      const foreign = await openMongoCalendarRuntime({ ...f.options, client: observer });
      const before = await f.raw(true); let callbacks = 0;
      for (const key of Object.keys(f.runtime.repositories) as Array<keyof typeof f.runtime.repositories>) {
        assert.throws(() => runWithDataRepositories({ ...f.runtime.repositories, [key]: foreign.repositories[key] }, () => {
          callbacks++; return invoke(f);
        }), /CALENDAR_SCOPE_MISMATCH/);
      }
      assert.equal(callbacks, 0); assert.deepEqual(await f.raw(true), before); assert.equal(f.remote.ledger.length, 0); clean();
    });

    await suite.test("H2 mixed backend: actual PG operation/promotion/roster/persistence ports reject before callback with guard intact", async () => {
      const f = await fixture();
      const legacy: Partial<DataRepositories> = { operations: new PrismaOperationRepository(), importPromotion: new PrismaImportPromotionRepository(),
        teamMembers: new PrismaTeamMemberRepository(), calendarPersistence: pgPersistence };
      const before = await f.raw(true); let callbacks = 0;
      for (const [key, value] of Object.entries(legacy)) {
        assert.throws(() => runWithDataRepositories({ ...f.runtime.repositories, [key]: value }, () => { callbacks++; return invoke(f); }), /CALENDAR_SCOPE_MISMATCH/);
      }
      // These calls are outside the rejected candidate callback and exercise the
      // original guard below the real PG repository, not a mocked guard function.
      await assert.rejects(() => f.runtime.run(() => new PrismaOperationRepository().listOperations()), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
      await assert.rejects(() => f.runtime.run(() => new PrismaImportPromotionRepository().promoteReadyImportRows(RUN_ID)), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
      assert.equal(callbacks, 0); assert.deepEqual(await f.raw(true), before); assert.equal(f.remote.ledger.length, 0); clean();
    });

    for (const mode of ["callback-retry", "commit-ACK-retry", "unresolved-ACK"] as const) {
      await suite.test(`H5 labelled promotion ${mode}: no OAuth/ACL/Google during retries; real backfill only after confirmed return`, async () => {
        resetAccessTokenCache(); const f = await fixture(), p: Probe = { paths: [] };
        const replace = Collection.prototype.replaceOne, commit = ClientSession.prototype.commitTransaction;
        let session: ClientSession | undefined, writes = 0, commits = 0;
        const during: number[] = [];
        const replacePatch = mock.method(Collection.prototype, "replaceOne", async function (this: Collection, ...args: Parameters<Collection["replaceOne"]>) {
          const result = await Reflect.apply(replace, this, args);
          if (probes.getStore() === p && this.collectionName === f.store.collection("OperationSession").collectionName) {
            writes++; session = args[2]?.session; assert.ok(session); during.push(f.remote.ledger.length);
            if (mode === "callback-retry" && writes === 1) {
              // Explicit driver fault after a real uncommitted write, NOT native conflict evidence.
              const error = new MongoServerError({ code: 112, message: `${PRIVATE_MARKER}-labelled-callback` });
              error.addErrorLabel("TransientTransactionError"); throw error;
            }
          }
          return result;
        });
        const commitPatch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
          const result = await Reflect.apply(commit, this, args);
          if (this === session) {
            commits++; during.push(f.remote.ledger.length);
            if (mode !== "callback-retry" && commits === 1) throw ackError(mode === "unresolved-ACK" ? 50 : 91);
          }
          return result;
        });
        try {
          const response = await invoke(f, p);
          if (mode === "unresolved-ACK") {
            assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: "반영 요청을 처리하지 못했습니다." });
            await audit(f, response); await state(f, 0, 0, 0); assert.deepEqual(p.paths, []); assert.equal(f.remote.ledger.length, 0);
          } else {
            const id = await success(f, response, 2, 0); await state(f, 2, 2, 2, id); assert.deepEqual(p.paths, paths);
            // Two configured calendars are diagnosed once each by one real backfill.
            assert.equal(f.remote.calls("acl").length, 2); assert.equal(f.remote.calls("oauth").length, 1);
          }
          assert.equal(writes, mode === "callback-retry" ? 2 : 1); assert.equal(commits, mode === "commit-ACK-retry" ? 2 : 1);
          assert.ok(during.length > 0 && during.every(count => count === 0)); clean();
        } finally { replacePatch.mock.restore(); commitPatch.mock.restore(); }
      });
    }

    await suite.test("H5 native Company insert race ordinary-first: actual promotion retries, real Calendar starts once after commit", async () => {
      resetAccessTokenCache(); const f = await fixture({ newOnly: true }), p: Probe = { paths: [] };
      const input: CreateOperationInput = { ...f.fields, educationDates: f.dates, archiveStatus: "아카이빙전", operationStatus: "배정필요",
        operationType: "단기", educationFormat: "오프라인", onsiteRequired: "N", revenue: null, totalCost: null, instructorCost: null, operationCost: null,
        coach: "", companyWikiLink: "", costRaw: "", driveLink: "", instructorWikiLink: "", instructors: "", lectureManagementLink: "",
        operationDetail: "", operationIssue: "", padletLink: "", region: "", resultReportLink: "", specialNotes: "", timeText: "", createdBy: actorB.user.email };
      const ordinaryId = randomUUID(), ordinaryHeld = barrier(), promotionHeld = barrier(), ordinaryGo = barrier(), promotionGo = barrier();
      const insert = Collection.prototype.insertOne, findOne = Collection.prototype.findOne;
      let ordinaryPaused = false, promotionPaused = false, runReads = 0;
      const conflicts: number[] = [], during: number[] = [];
      const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const company = this.collectionName === f.store.collection("Company").collectionName;
        const promotion = probes.getStore() === p;
        if (company && activityContext.getStore()?.requestId === ordinaryId && !ordinaryPaused) {
          ordinaryPaused = true; ordinaryHeld.release(); await bounded(ordinaryGo.promise);
        }
        if (company && promotion && !promotionPaused) { promotionPaused = true; promotionHeld.release(); await bounded(promotionGo.promise); }
        if (company && promotion) during.push(f.remote.ledger.length);
        try { return await Reflect.apply(insert, this, args); }
        catch (error) {
          if (company && promotion && error instanceof MongoServerError && [11000, 112].includes(Number(error.code))) {
            conflicts.push(Number(error.code)); during.push(f.remote.ledger.length);
          }
          throw error;
        }
      });
      const readPatch = mock.method(Collection.prototype, "findOne", async function (this: Collection, ...args: Parameters<Collection["findOne"]>) {
        if (probes.getStore() === p && this.collectionName === f.store.collection("DataImportRun").collectionName) { runReads++; during.push(f.remote.ledger.length); }
        return Reflect.apply(findOne, this, args);
      });
      const winner = f.runtime.run(() => activityContext.run({ requestId: ordinaryId, actorEmail: actorB.user.email, actorName: actorB.user.name,
        actorType: "user", route: "/synthetic/calendar-edge-create", method: "POST" }, () => f.runtime.repositories.operations.createOperation(input)));
      void winner.catch(() => {});
      let pending: Promise<Response> | undefined;
      try {
        await reached(ordinaryHeld, winner); pending = invoke(f, p); void pending.catch(() => {}); await reached(promotionHeld, pending);
        ordinaryGo.release(); const manual = await winner; assert.equal(f.remote.ledger.length, 0);
        promotionGo.release(); const response = await pending;
        const id = await success(f, response, 2, 0, { ...EMPTY, sourceRows: 1, eligible: 1, linkedExisting: 1 });
        assert.ok(conflicts.length > 0, "Require actual native 11000/112; no fabricated conflict"); assert.ok(runReads >= 2);
        assert.ok(during.length > 0 && during.every(count => count === 0));
        const op = await committed(f); assert.equal(op.operationId, manual.operationId);
        await state(f, 2, 2, 2, id); assert.equal(f.remote.calls("acl").length, 2); assert.deepEqual(p.paths, paths);
        assert.equal(await f.store.collection("Company").countDocuments(), 1); assert.equal(await f.store.collection("Course").countDocuments(), 1);
        assert.equal((await f.store.collection("__counter").findOne({ _id: "Course.processSeq" }))?.value, 101);
        const before = await f.raw(); const replay = await invoke(f); await success(f, replay, 0, 0, EMPTY);
        assert.deepEqual(await f.raw(), before); await state(f, 2, 2, 2); assert.equal(f.remote.calls("acl").length, 4); clean();
      } finally {
        ordinaryGo.release(); promotionGo.release(); await Promise.allSettled([winner, ...(pending ? [pending] : [])]);
        insertPatch.mock.restore(); readPatch.mock.restore();
      }
    });

    await suite.test("H10b simultaneous namespaces share one fake but distinct calendarIds create two independent Google objects", async () => {
      resetAccessTokenCache(); const remote = new SyntheticCalendarRemote();
      const a = await fixture({ remote, part: 1, singleDate: true }), b = await fixture({ remote, part: 2, singleDate: true });
      const both = barrier(); let arrived = 0;
      remote.beforePost = async () => { if (++arrived === 2) both.release(); await bounded(both.promise); };
      try {
        const [ra, rb] = await Promise.all([invoke(a), invoke(b, { paths: [] }, actorB)]);
        const idA = await success(a, ra, 1, 0), idB = await success(b, rb, 1, 0, RESTORED, actorB); assert.notEqual(idA, idB);
        assert.equal(arrived, 2); assert.equal(remote.active().length, 2);
        assert.deepEqual(remote.calls("event", "POST").map(call => call.status), [201, 201]); assert.equal(remote.calls("event", "GET").length, 0);
        const [la, lb] = await Promise.all([state(a, 2, 1, 2, idA), state(b, 2, 1, 2, idB)]);
        assert.notEqual(la.links[0].eventId, lb.links[0].eventId);
        assert.equal(la.changes[0].actorEmail, actorA.user.email); assert.equal(lb.changes[0].actorEmail, actorB.user.email);
        const beforeA = await a.raw(), beforeB = await b.raw();
        await success(a, await invoke(a), 0, 0, EMPTY); await success(b, await invoke(b, { paths: [] }, actorB), 0, 0, EMPTY, actorB);
        assert.deepEqual(await a.raw(), beforeA); assert.deepEqual(await b.raw(), beforeB); assert.equal(remote.calls("event", "POST").length, 2); clean();
      } finally { both.release(); remote.beforePost = undefined; }
    });

    type Lease = { _id: string; owner: string | null; generation: Long; nonce: string; leaseUntil: Date };
    const leaseCollection = (f: Fixture) => observer.db(databaseName).collection<Lease>(`${f.options.namespace}_CalendarOperationLease`, { promoteLongs: false, readPreference: "primary", readConcern: { level: "majority" } });
    // Deliberately bypass expiry with a native, majority-acknowledged owner write.
    // This is the plan's forced-owner FAULT, never described as native acquisition.
    async function forceOwner(f: Fixture) {
      const collection = leaseCollection(f), before = await collection.findOne({ _id: OP }); assert.ok(before?.owner); assert.ok(Long.isLong(before.generation));
      const owner = randomUUID(), generation = before.generation.add(Long.ONE);
      const result = await collection.updateOne({ _id: OP, owner: before.owner, generation: before.generation }, [{ $set: {
        owner: { $literal: owner }, generation: { $literal: generation }, nonce: { $literal: randomUUID() },
        leaseUntil: { $dateAdd: { startDate: "$$NOW", unit: "millisecond", amount: CALENDAR_LEASE_TIMING.leaseMs } }
      } }], { writeConcern: { w: "majority", j: true }, timeoutMS: 5000 });
      assert.equal(result.matchedCount, 1); assert.equal(result.modifiedCount, 1);
      const after = await collection.findOne({ _id: OP }); assert.ok(after); assert.equal(after.owner, owner); assert.ok(after.generation.equals(generation));
      return { owner, generation };
    }
    async function mappingSnapshot(f: Fixture) {
      const db = observer.db(databaseName, { readPreference: "primary", readConcern: new ReadConcern("majority") });
      return { links: await db.collection(`${f.options.namespace}_CalendarEventLink`).find({}).sort({ _id: 1 }).toArray(),
        changes: await db.collection(`${f.options.namespace}_ActivityChange`).find({ targetType: "calendar_event_links" }).sort({ _id: 1 }).toArray() };
    }

    for (const mode of ["F10", "F11", "F14", "F15"] as const) await suite.test(`${mode} actual POST: native committed mapping with labelled ${mode === "F11" ? "release" : mode === "F10" ? "completion-owner" : "commit-ACK"} fault`, async () => {
      resetAccessTokenCache(); const f = await fixture(), p: Probe = { paths: [] };
      const insert = Collection.prototype.insertOne, update = Collection.prototype.updateOne, commit = ClientSession.prototype.commitTransaction;
      const mappingSessions: ClientSession[] = [], guards = new Map<ClientSession, number>(), guardStarted = new Map<ClientSession, number>();
      const sessionIds = new Map<ClientSession, string>();
      const commitCalls = new Map<ClientSession, number>();
      const wireCommits: Array<{ session: ClientSession; txn: string; lsid: string }> = [];
      let releaseFaults = 0, ackFaults = 0, ownerFault: Awaited<ReturnType<typeof forceOwner>> | undefined;
      let stored: Awaited<ReturnType<typeof mappingSnapshot>> | undefined;
      const commands = (event: CommandStartedEvent) => {
        if (event.commandName !== "commitTransaction") return;
        const lsid = JSON.stringify(event.command.lsid);
        const session = mappingSessions.find(item => sessionIds.get(item) === lsid);
        if (session) wireCommits.push({ session, txn: String(event.command.txnNumber), lsid });
      };
      client.on("commandStarted", commands);
      const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        if (this.collectionName === f.store.collection("CalendarEventLink").collectionName && probes.getStore() === p) {
          const session = args[1]?.session; assert.ok(session);
          // Each real DB callback is counted; a retried callback must not be hidden.
          mappingSessions.push(session); sessionIds.set(session, JSON.stringify(session.id));
        }
        return Reflect.apply(insert, this, args);
      });
      const updatePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const isLease = this.collectionName === `${f.options.namespace}_CalendarOperationLease` && probes.getStore() === p;
        const session = args[2]?.session;
        if (isLease && session) {
          guards.set(session, (guards.get(session) ?? 0) + 1); if (!guardStarted.has(session)) guardStarted.set(session, performance.now());
        }
        const pipeline = args[1];
        if (mode === "F11" && isLease && !session && Array.isArray(pipeline) && pipeline[0]?.$set?.owner === null) {
          // Release is after completion verdict. No fake callback success and no
          // intercepted mapping commit: only this final native write is rejected.
          releaseFaults++; stored = await mappingSnapshot(f); assert.equal(stored.links.length, 2); assert.equal(stored.changes.length, 2);
          throw new Error(`${PRIVATE_MARKER}-release-write`);
        }
        return Reflect.apply(update, this, args);
      });
      const commitPatch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
        const result = await Reflect.apply(commit, this, args);
        const index = mappingSessions.indexOf(this);
        if (index < 0) return result; // Promotion transaction remains completely real.
        const count = (commitCalls.get(this) ?? 0) + 1; commitCalls.set(this, count);
        if (mode === "F10" && index === 1 && count === 1) {
          stored = await mappingSnapshot(f); assert.equal(stored.links.length, 2); assert.equal(stored.changes.length, 2);
          ownerFault = await forceOwner(f); // before outer completion, after both server commits
        }
        if ((mode === "F14" || mode === "F15") && index === 0 && count === 1) {
          stored = await mappingSnapshot(f); assert.equal(stored.links.length, 1); assert.equal(stored.changes.length, 1);
          assert.equal(f.remote.active().length, 1); assert.equal(f.remote.calls("event", "POST").length, 1);
          if (mode === "F15") ownerFault = await forceOwner(f);
          const started = guardStarted.get(this); assert.ok(started !== undefined);
          assert.ok(performance.now() - started < CALENDAR_LEASE_TIMING.transactionMs, "Fault must remain inside original DB10s budget");
          ackFaults++; throw ackError(mode === "F14" ? 50 : 91);
        }
        if (mode === "F15" && index === 0 && count === 2) {
          assert.deepEqual(await mappingSnapshot(f), stored, "Commit reconfirmation must preserve original mapping and audit bytes");
          const started = guardStarted.get(this); assert.ok(started !== undefined);
          assert.ok(performance.now() - started < CALENDAR_LEASE_TIMING.transactionMs);
        }
        return result;
      });
      try {
        const response = await invoke(f, p);
        const inserted = mode === "F14" ? 0 : mode === "F15" ? 1 : 2;
        const failed = mode === "F11" ? 0 : 1;
        const id = await success(f, response, inserted, failed);
        const savedCount = mode === "F14" || mode === "F15" ? 1 : 2;
        await state(f, savedCount, savedCount, savedCount, id); assert.deepEqual(p.paths, paths);
        assert.equal(f.remote.calls("event").length, savedCount, "No extra GET/PATCH/DELETE or replayed Google effect after the fault");
        assert.equal(f.remote.calls("oauth").length, 1); assert.equal(f.remote.calls("acl").length, 2);
        assert.ok(stored); assert.deepEqual(await mappingSnapshot(f), stored);
        assert.equal(mappingSessions.length, savedCount, "No mapping callback replay after server commit");
        for (const session of mappingSessions) assert.equal(guards.get(session), 1, "No new nonce guard during commit-only retry");
        assert.equal(releaseFaults, mode === "F11" ? 1 : 0); assert.equal(ackFaults, mode === "F14" || mode === "F15" ? 1 : 0);
        if (mode === "F15") {
          assert.equal(commitCalls.get(mappingSessions[0]), 2);
          const wires = wireCommits.filter(row => row.session === mappingSessions[0]); assert.equal(wires.length, 2);
          assert.equal(wires[0].txn, wires[1].txn); assert.equal(wires[0].lsid, wires[1].lsid);
        } else for (const session of mappingSessions) assert.equal(commitCalls.get(session), 1);
        const lease = await leaseCollection(f).findOne({ _id: OP }); assert.ok(lease);
        if (ownerFault) { assert.equal(lease.owner, ownerFault.owner); assert.ok(lease.generation.equals(ownerFault.generation)); }
        if (mode === "F11") assert.ok(lease.owner, "Rejected release must leave the real active owner for expiry recovery");
        if (mode === "F14") assert.equal(lease.owner, null);
        clean();
      } finally { insertPatch.mock.restore(); updatePatch.mock.restore(); commitPatch.mock.restore(); client.off("commandStarted", commands); }
      if (mode === "F14") {
        assert.ok(stored);
        const response = await invoke(f); await success(f, response, 1, 0, EMPTY); await state(f, 2, 2, 2);
        const after = await mappingSnapshot(f);
        for (const row of stored.links) assert.deepEqual(after.links.find(item => String(item._id) === String(row._id)), row);
        for (const row of stored.changes) assert.deepEqual(after.changes.find(item => String(item._id) === String(row._id)), row);
        assert.equal(f.remote.calls("event", "GET").length, 0, "Committed first mapping is skipped, not repaired by extra Google requests"); clean();
      }
    });
    clean();
  } finally {
    try { if (owned) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await Promise.all([client.close(), observer.close()]); }
      finally {
        resetAccessTokenCache(); fetchMock.mock.restore(); for (const logger of loggers) logger.mock.restore();
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        if (previousPrisma === undefined) delete globals.prisma; else globals.prisma = previousPrisma;
        if (previousPool === undefined) delete globals.calendarLockPool; else globals.calendarLockPool = previousPool;
      }
    }
  }
});
