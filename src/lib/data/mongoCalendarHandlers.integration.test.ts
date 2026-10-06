/** Calendar validation-v2: actual handlers -> real backfill -> native scoped ports.
 * Parent owns execution. This suite never substitutes Calendar functions, guards,
 * withActivity or repositories. Only auth/Next/date and HTTP transports are fake.
 * Independent literal/remote-state assertions are NOT a frozen-PG parity oracle.
 * Full frozen closure/PG parity and native lease timing/ACK suites are separate.
 * Not covered here: F10/F11/F14/F15, H5/H10b, cross-client/backend port mixing,
 * reverse schedule writes/compensation, forward create/delete/replay, cleanup
 * post-delete DB failure, OAuth-loss barriers and full S3-S5 logging/allowlist.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { Collection, MongoClient, MongoServerError } from "mongodb";
import ts from "typescript";
import { activityContext } from "../activity/context";
import { runWithDataRepositories, getDataRepositoryOverride, type DataRepositories } from "./dataRepositoryContext";
import { MongoOperationStore, OPERATION_MODELS, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { CALENDAR_ID, PRIVATE_MARKER, SyntheticCalendarRemote, expectedEventId } from "./mongoCalendarHandlers.fixture";

type Actor = { user: { email: string; name: string }; expires: string };
const member: Actor = { user: { email: "calendar-actor@day1company.co.kr", name: "Synthetic Calendar Actor" }, expires: "" };
const admin: Actor = { user: { email: "calendar-admin@day1company.co.kr", name: "Synthetic Calendar Admin" }, expires: "" };
const other: Actor = { user: { email: "calendar-other@day1company.co.kr", name: "Synthetic Calendar Other" }, expires: "" };
const actors = new AsyncLocalStorage<Actor | null>();
type Probe = { paths: string[]; failRevalidation?: number };
const probes = new AsyncLocalStorage<Probe>();
const remotes = new AsyncLocalStorage<SyntheticCalendarRemote>();
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
// Calendar date only. Mongo $$NOW, Date.now and monotonic lease budgets stay real.
mock.module("@/lib/seoulDate", { namedExports: { getSeoulToday: () => new Date(2099, 10, 30) } });
let pgAdapterCalls = 0, pgPoolCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
  constructor() { pgAdapterCalls++; throw new Error("PG_ADAPTER_TRIPWIRE"); }
} } });
class PgPoolTripwire { constructor() { pgPoolCalls++; throw new Error("PG_POOL_TRIPWIRE"); } }
mock.module("pg", { namedExports: { Pool: PgPoolTripwire }, defaultExport: { Pool: PgPoolTripwire } });
mock.module("next/cache.js", { namedExports: { revalidatePath: (path: string) => {
  const p = probes.getStore(); assert.ok(p); p.paths.push(path);
  if (p.failRevalidation === p.paths.length) throw new Error(`${PRIVATE_MARKER}-revalidate`);
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
const { POST: promotePOST } = await import("../../app/api/admin/imports/[id]/promote/route");
const backfillAPI = await import("../../app/api/admin/calendar/backfill-events/route");
const refreshAPI = await import("../../app/api/admin/calendar/refresh-events/route");
const reverseAPI = await import("../../app/api/sync/calendar-events/route");
const { resetAccessTokenCache } = await import("../googleCalendar/calendarWriteClient");
const { withCalendarOperationLock } = await import("../googleCalendar/calendarOperationLock");
const { getPrismaClient } = await import("./prisma");
hooks.deregister();

const uri = process.env.MONGODB_CALENDAR_TEST_URI;
const exactURI = "mongodb://127.0.0.1:27849/?replicaSet=calendarboundary20260930";
const PROMOTE_ROUTE = "/api/admin/imports/[id]/promote";
const BACKFILL_ROUTE = "/api/admin/calendar/backfill-events";
const REFRESH_ROUTE = "/api/admin/calendar/refresh-events";
const REVERSE_ROUTE = "/api/sync/calendar-events";
const GENERIC = "반영 요청을 처리하지 못했습니다.";
const CALENDAR_GENERIC = "캘린더 작업을 처리하지 못했습니다.";
const R = "synthetic-calendar-r", A = "synthetic-calendar-a";
const R_ID = "11111111-1111-4111-8111-111111111111";
const A_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const EMPTY = { sourceRows: 0, eligible: 0, blocked: 0, blockedReasons: {}, created: 0, revived: 0, linkedExisting: 0 };
const RESTORED = { ...EMPTY, sourceRows: 1, eligible: 1, revived: 1 };
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const revalidations = (id: string) => ["/", "/operations", "/admin/imports", `/admin/imports/${id}`];
const jsonRequest = (path: string, method = "GET", body?: unknown, bearer = false) => new Request(`https://example.invalid${path}`, {
  method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(bearer ? { Authorization: "Bearer synthetic-calendar-sync" } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});

test("Calendar actual API: native runtime, independent synthetic remote and literal contracts", { skip: !uri, timeout: 300_000 }, async suite => {
  assert.equal(uri, exactURI, "No default database, alternate host, credentials or previous promotion replica");
  const env = {
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/calendar_tripwire", OPERATION_DATA_SOURCE: "local",
    ADMIN_EMAILS: admin.user.email, DEV_AUTH_BYPASS: "false",
    GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-calendar-client", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-calendar-secret",
    GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-calendar-refresh", GOOGLE_CAL_PART_CALENDARS: `1파트:${CALENDAR_ID}`,
    AUTH_SECRET: "synthetic-calendar-cleanup-signing-secret", NEXTAUTH_SECRET: "", SYNC_API_SECRET: "synthetic-calendar-sync",
    HUB_OM_BASE_URL: "", SLACK_CALENDAR_ALERT_EMAIL: "", SLACK_BOT_TOKEN: "synthetic-calendar-slack-token",
    CALENDAR_REVERSE_SYNC_LOOKBACK_MINUTES: "60", CALENDAR_REVERSE_SYNC_MIN_LAG_SECONDS: "0"
  };
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  const globals = globalThis as unknown as { prisma?: unknown; calendarLockPool?: unknown };
  const savedPrisma = globals.prisma, savedPool = globals.calendarLockPool;
  delete globals.prisma; delete globals.calendarLockPool; Object.assign(process.env, env);
  const logs: unknown[][] = [];
  const loggers = (["error", "warn", "info", "log", "debug"] as const).map(level => mock.method(console, level, (...values: unknown[]) => { logs.push(values); }));
  let unscopedFetch = 0;
  const fetchMock = mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const remote = remotes.getStore();
    if (!remote) { unscopedFetch++; throw new Error("EXTERNAL_FETCH_TRIPWIRE"); }
    return remote.fetch(input, init);
  });
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_calendar_handlers_${randomBytes(8).toString("hex")}`;
  let owned = false;
  const allRemotes: SyntheticCalendarRemote[] = [];
  try {
    // Positive controls prove traps are BELOW the unchanged production guards.
    assert.throws(() => getPrismaClient(), /PG_ADAPTER_TRIPWIRE/);
    await assert.rejects(() => withCalendarOperationLock("synthetic-pg-control", async () => undefined), /PG_POOL_TRIPWIRE/);
    assert.equal(pgAdapterCalls, 1); assert.equal(pgPoolCalls, 1); pgAdapterCalls = 0; pgPoolCalls = 0;
    await client.connect();
    assert.equal((await client.db(databaseName).listCollections().toArray()).length, 0); owned = true;
    async function fixture(input: { h3?: boolean; reflecting?: boolean; remote?: SyntheticCalendarRemote; singleDate?: boolean; active?: boolean; client?: MongoClient } = {}) {
      const options = { client: input.client ?? client, databaseName, namespace: `shadow_calendar_${randomBytes(6).toString("hex")}`, allowShadowWrites: true as const };
      await prepareMongoCalendarRuntimeStore({ ...options, processSequenceHighWater: 100 });
      const runtime = await openMongoCalendarRuntime({ ...options, reflectOperations: input.reflecting ?? false });
      const store = new MongoOperationStore(options, [...new Set([...OPERATION_MODELS, "CalendarEventLink", "DataImportRun", "ActivityRequest"])]);
      const remote = input.remote ?? new SyntheticCalendarRemote(); if (!allRemotes.includes(remote)) allRemotes.push(remote);
      const seed = async (model: string, fields: MongoRow) => {
        const row = coachFixtureRow(model, fields);
        await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
      };
      for (const [role, name, email] of [["OM", "가상CalendarOM", "calendar-om@example.invalid"], ["LD", "가상CalendarLD", "calendar-ld@example.invalid"]]) {
        await seed("TeamUser", { role, name, email, team: "AX 1파트", slackId: `synthetic-${role.toLowerCase()}` });
      }
      const fields = (name: "R" | "A" | "N") => ({ companyName: `Synthetic Calendar Company ${name}`, courseName: `Synthetic Calendar Course ${name}`,
        courseId: name === "R" ? "1001" : name === "A" ? "1002" : "1003", om: "가상CalendarOM", ld: "가상CalendarLD",
        roundNo: "1", educationDays: name === "R" ? "3" : "1", operationStatus: "배정필요",
        startDate: name === "R" ? "2099-12-01" : name === "A" ? "2099-12-05" : "2099-12-06",
        endDate: name === "R" ? (input.singleDate ? "2099-12-01" : "2099-12-04") : name === "A" ? "2099-12-05" : "2099-12-06" });
      for (const name of input.h3 ? ["R", "A"] as const : ["R"] as const) {
        const f = fields(name);
        const company = await seed("Company", { id: name === "R" ? "55555555-5555-4555-8555-555555555555" : "66666666-6666-4666-8666-666666666666", name: f.companyName, normalizedName: f.companyName.toLowerCase().replace(/\s+/g, "") });
        const course = await seed("Course", { id: name === "R" ? "77777777-7777-4777-8777-777777777777" : "88888888-8888-4888-8888-888888888888", companyId: company.id, processSeq: name === "R" ? 1 : 2, name: f.courseName, courseId: f.courseId, operationType: "NEEDS_REVIEW" });
        await seed("OperationSession", { id: name === "R" ? R_ID : A_ID, operationId: name === "R" ? R : A, courseRecordId: course.id,
          sourceFingerprint: name === "R" ? "a".repeat(64) : "c".repeat(64), operationStatus: "ASSIGNMENT_NEEDED", archiveStatus: "NOT_READY",
          educationFormat: "NEEDS_REVIEW", operationChannel: "NEEDS_REVIEW", roundNo: "1", educationDays: f.educationDays,
          startDate: date(f.startDate), endDate: date(f.endDate), educationDates: (name === "A" ? ["2099-12-05"] : input.singleDate ? ["2099-12-01"] : ["2099-12-01", "2099-12-02", "2099-12-04"]).map(date),
          omName: f.om, ldName: f.ld, onsiteOmName: null, instructorsText: null, timeText: null, region: null,
          deletedAt: name === "R" && !input.active ? date("2099-11-29") : null, deletedBy: name === "R" && !input.active ? member.user.email : null,
          createdAt: date("2099-11-01"), updatedAt: date("2099-11-29") });
      }
      await seed("DataImportRun", { id: RUN_ID, sourceType: "csv", sourceName: "Synthetic Calendar Import", importedBy: member.user.email,
        status: "COMPLETED", sourceTeam: "TEAM_1", rowCount: input.h3 ? 2 : 1, successCount: input.h3 ? 2 : 1, errorCount: 0 });
      const sourceIds: string[] = [];
      for (const [index, name] of (input.h3 ? ["R", "N"] as const : ["R"] as const).entries()) {
        const row = await seed("OperationSourceRecord", { importRunId: RUN_ID, operationSessionId: null, sourceTeam: "TEAM_1", sourceWorkbook: "synthetic-calendar.csv",
          sourceSheet: "synthetic-calendar", sourceRowNumber: index + 2, headerRowNumber: 1, sourceFingerprint: (name === "R" ? "a" : "b").repeat(64),
          mappedFields: fields(name), rowSnapshot: { synthetic: PRIVATE_MARKER }, unmappedFields: {}, validationErrors: [] });
        sourceIds.push(String(row.id));
      }
      const raw = async (includeRequests = false, includeLease = false) => {
        const names = (await store.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name)
          .filter(name => name.startsWith(`${options.namespace}_`) && (includeRequests || !name.endsWith("_ActivityRequest")) && (includeLease || !name.endsWith("_CalendarOperationLease"))).sort();
        return Promise.all(names.map(async name => [name, await store.db.collection(name).find({}).sort({ _id: 1 }).toArray()]));
      };
      return { options, runtime, store, remote, sourceIds, raw };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    function inScope<T>(f: Fixture, work: () => T, actor: Actor | null = member, p: Probe = { paths: [] }): T {
      return f.runtime.run(() => actors.run(actor, () => probes.run(p, () => remotes.run(f.remote, work))));
    }
    const promote = (f: Fixture, p: Probe = { paths: [] }, actor: Actor | null = member) => inScope(f,
      () => promotePOST(jsonRequest(`/api/admin/imports/${RUN_ID}/promote`, "POST"), { params: Promise.resolve({ id: RUN_ID }) }), actor, p);
    const api = (f: Fixture, handler: (request: Request) => Promise<Response>, path: string, method = "GET", body?: unknown, actor: Actor | null = admin, bearer = false) =>
      inScope(f, () => handler(jsonRequest(path, method, body, bearer)), actor);
    async function requestAudit(f: Fixture, response: Response, route = PROMOTE_ROUTE, actor: Actor | null = member, method = "POST", token = false) {
      const id = response.headers.get("X-Request-Id"); assert.ok(id);
      const audit = await f.store.one("ActivityRequest", { _id: id }); assert.ok(audit);
      assert.equal(audit.route, route); assert.equal(audit.method, method); assert.equal(audit.status, response.status);
      assert.equal(audit.actorType, token ? "token_request" : actor ? "user" : "anonymous");
      assert.equal(audit.actorEmail, token ? null : actor?.user.email ?? null);
      assert.equal(audit.actorName, token ? null : actor?.user.name ?? null);
      assert.ok(typeof audit.durationMs === "number" && audit.durationMs >= 0);
      return id;
    }
    async function success(f: Fixture, response: Response, inserted: number, failed = 0, result = RESTORED, actor = member) {
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, result, calendar: { insertedEvents: inserted, failedOperations: failed } });
      return requestAudit(f, response, PROMOTE_ROUTE, actor);
    }
    async function state(f: Fixture, remote: number, mapping: number, postAttempts: number) {
      assert.equal(f.remote.active().length, remote);
      const links = await f.store.scan("CalendarEventLink"); assert.equal(links.length, mapping);
      assert.equal(f.remote.calls("event", "POST").length, postAttempts);
      const audits = await f.store.scan("ActivityChange", { targetType: "calendar_event_links" }); assert.equal(audits.length, mapping);
      for (const link of links) {
        const event = f.remote.events.get(String(link.calendarId))?.get(String(link.eventId)); assert.ok(event);
        assert.equal(event.status, "confirmed");
        assert.equal(link.eventId, expectedEventId(String(link.operationId), (link.eventDate as Date).toISOString().slice(0, 10)));
      }
      assert.equal(f.remote.calls("slack").length, 0); assert.deepEqual(f.remote.violations, []);
      return { links, audits };
    }
    async function committed(f: Fixture) {
      const operation = await f.store.one("OperationSession", { _id: R_ID }); assert.ok(operation); assert.equal(operation.deletedAt, null);
      assert.equal((await f.store.one("OperationSourceRecord", { _id: f.sourceIds[0] }))?.operationSessionId, R_ID);
      for (const sourceId of f.sourceIds) {
        const source = await f.store.one("OperationSourceRecord", { _id: sourceId }); assert.ok(source?.operationSessionId);
        const row = await f.store.one("OperationSession", { _id: String(source.operationSessionId) }); assert.ok(row);
        const course = await f.store.one("Course", { _id: String(row.courseRecordId) }); assert.ok(course);
        assert.ok(await f.store.one("Company", { _id: String(course.companyId) }));
      }
      const changes = await f.store.scan("ActivityChange");
      assert.equal(changes.filter(row => ["data_import_runs", "operation_source_records"].includes(String(row.targetType))).length, 0);
    }
    function clean() {
      assert.equal(pgAdapterCalls, 0); assert.equal(pgPoolCalls, 0); assert.equal(unscopedFetch, 0);
      for (const remote of allRemotes) assert.deepEqual(remote.violations, []);
      const text = inspect(logs, { depth: null });
      for (const secret of [PRIVATE_MARKER, CALENDAR_ID, "가상CalendarOM", "가상CalendarLD", member.user.email, "calendar-om@example.invalid", "synthetic-calendar-token", "synthetic-calendar-refresh"]) assert.ok(!text.includes(secret), `console leaked ${secret}`);
    }
    async function rejectInserts(f: Fixture, model: "CalendarEventLink" | "ActivityRequest") {
      const name = f.store.collection(model).collectionName;
      await f.store.db.command({ collMod: name, validator: { $and: [operationMongoValidator(model), { _id: "synthetic-impossible-id" }] }, validationLevel: "strict", validationAction: "error" });
      const original = Collection.prototype.insertOne;
      const errors: number[] = [];
      const observer = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        try { return await Reflect.apply(original, this, args); }
        catch (error) { if (this.collectionName === name && error instanceof MongoServerError) errors.push(Number(error.code)); throw error; }
      });
      return { errors, restore: async () => { observer.mock.restore(); await f.store.db.command({ collMod: name, validator: operationMongoValidator(model), validationLevel: "strict", validationAction: "error" }); } };
    }

    await suite.test("H3 literal restored R two intervals + unrelated active A + empty-date new N: actual POST three events, replay zero", async () => {
      resetAccessTokenCache(); const f = await fixture({ h3: true }), p: Probe = { paths: [] };
      const response = await promote(f, p);
      const requestId = await success(f, response, 3, 0, { ...RESTORED, sourceRows: 2, eligible: 2, created: 1 });
      assert.deepEqual(p.paths, revalidations(RUN_ID)); await committed(f);
      const { links, audits } = await state(f, 3, 3, 3);
      assert.deepEqual(links.map(row => [row.operationId, (row.eventDate as Date).toISOString().slice(0, 10)]).sort(), [[A, "2099-12-05"], [R, "2099-12-01"], [R, "2099-12-04"]].sort());
      const expected = [[R, "2099-12-01", "2099-12-03", "R"], [R, "2099-12-04", "2099-12-05", "R"], [A, "2099-12-05", "2099-12-06", "A"]];
      for (const [op, start, end, name] of expected) {
        const event = f.remote.events.get(CALENDAR_ID)?.get(expectedEventId(op, start)); assert.ok(event);
        assert.equal(event.summary, `[강의관리] Synthetic Calendar Company ${name}_Synthetic Calendar Course ${name}_1회차`);
        assert.deepEqual(event.start, { date: start }); assert.deepEqual(event.end, { date: end });
        assert.deepEqual(event.attendees, [{ email: "calendar-om@example.invalid" }]);
        assert.equal(event.guestsCanModify, true); assert.equal(event.guestsCanInviteOthers, false);
        assert.deepEqual(event.extendedProperties?.private, {
          hubOmSchedule: `allday:${start}~${end}`, hubOmCreationKey: expectedEventId(op, start), hubOmCreationSource: "backfill"
        });
        assert.equal(event.description, [
          "hub-om 운영현황과 연동된 일정입니다.",
          "· 날짜·시간을 여기서 옮기면 5분 안에 hub-om에 반영됩니다.",
          "· 제목·장소는 hub-om 값으로 되돌아갑니다. 바꿀 일이 있으면 hub-om에서 고쳐주세요.",
          "· 이 일정을 삭제해도 hub-om에는 반영되지 않습니다. 회차 취소는 hub-om에서 해주세요.",
          "담당 OM: 가상CalendarOM",
          name === "R" ? "교육일: 99.12.01~02, 04 (3일)" : "교육일: 99.12.05 (1일)"
        ].join("\n"));
      }
      for (const call of f.remote.calls("event", "POST")) assert.equal(call.sendUpdates, "none");
      assert.equal(f.remote.calls("oauth").length, 1); assert.equal(f.remote.calls("acl").length, 1); assert.equal(f.remote.calls("event", "GET").length, 0);
      for (const audit of audits) {
        assert.equal(audit.requestId, requestId); assert.equal(audit.actorEmail, member.user.email); assert.equal(audit.action, "create");
        const changes = audit.changes as Record<string, unknown>;
        assert.deepEqual(changes.calendar_id, { redacted: true }); assert.deepEqual(changes.event_id, { redacted: true });
      }
      const allChanges = await f.store.scan("ActivityChange", { requestId });
      assert.deepEqual(allChanges.map(row => `${row.targetType}:${row.action}`).sort(), ["calendar_event_links:create", "calendar_event_links:create", "calendar_event_links:create", "companies:create", "courses:create", "operation_sessions:create", "operation_sessions:restore"].sort());
      const newSource = await f.store.one("OperationSourceRecord", { _id: f.sourceIds[1] }); assert.ok(newSource);
      assert.deepEqual((await f.store.one("OperationSession", { _id: String(newSource.operationSessionId) }))?.educationDates, []);
      // Promotion performs a fresh serialization write even on an empty replay.
      // Only that guard nonce is volatile; compare every business/audit/counter byte.
      const replaySnapshot = async () => (await f.raw()).map(([name, rows]) => [name,
        String(name).endsWith("_CourseNameRestoreGuard")
          ? (rows as Array<Record<string, unknown>>).map(row => { const stable = { ...row }; delete stable.nonce; return stable; }) : rows]);
      const rawBefore = await replaySnapshot();
      const again = await promote(f); const nextId = await success(f, again, 0, 0, EMPTY); assert.notEqual(nextId, requestId);
      assert.deepEqual(await replaySnapshot(), rawBefore); await state(f, 3, 3, 3);
      assert.equal(f.remote.calls("oauth").length, 1); assert.equal(f.remote.calls("acl").length, 2);
      const completedPreview = await api(f, backfillAPI.GET, BACKFILL_ROUTE);
      assert.equal(completedPreview.status, 200);
      assert.deepEqual((await completedPreview.json()).totals, { operationsScanned: 3, inScope: 3, alreadyComplete: 2,
        excludedNoEducationDates: 1, plannedOperations: 0, plannedEvents: 0, insertedEvents: 0, skippedOperations: 0, failedOperations: 0, capped: false });
      assert.deepEqual(await replaySnapshot(), rawBefore);
      const rawText = inspect(await f.raw(true), { depth: null });
      for (const secret of [PRIVATE_MARKER, CALENDAR_ID, member.user.email, "calendar-om@example.invalid"]) assert.ok(!rawText.includes(secret));
      clean();
    });

    await suite.test("F1/H1 workspace guard is real; anonymous and outsider redirect before any business or external effect", async () => {
      const f = await fixture(); const before = await f.raw();
      for (const actor of [null, { user: { email: "synthetic-outsider@example.invalid", name: "Synthetic outsider" }, expires: "" }]) {
        await assert.rejects(() => promote(f, { paths: [] }, actor), (error: unknown) => {
          assert.ok(error instanceof Error && "digest" in error); assert.equal(error.digest, "NEXT_REDIRECT;replace;/sign-in;307;"); return true;
        });
      }
      assert.deepEqual(await f.raw(), before); assert.equal(f.remote.ledger.length, 0);
      const audits = await f.store.scan("ActivityRequest"); assert.equal(audits.length, 2);
      for (const row of audits) { assert.equal(row.status, 307); assert.equal(row.actorType, "anonymous"); }
      clean();
    });

    await suite.test("F0/H2 every missing or foreign registered port rejects before callback/audit/lease; nested scopes do not merge", async () => {
      const a = await fixture(), b = await fixture({ reflecting: true });
      const beforeA = await a.raw(true, true), beforeB = await b.raw(true, true); let callbacks = 0;
      for (const key of Object.keys(a.runtime.repositories) as Array<keyof typeof a.runtime.repositories>) {
        const missing: Partial<DataRepositories> = { ...a.runtime.repositories }; delete missing[key];
        assert.throws(() => runWithDataRepositories(missing, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
        const mixed = { ...a.runtime.repositories, [key]: b.runtime.repositories[key] };
        assert.throws(() => runWithDataRepositories(mixed, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
      }
      a.runtime.run(() => {
        runWithDataRepositories({}, () => { assert.throws(() => getDataRepositoryOverride("operations"), /DATA_REPOSITORY_NOT_CONFIGURED/); });
        b.runtime.run(() => assert.equal(getDataRepositoryOverride("operations"), b.runtime.repositories.operations));
        assert.equal(getDataRepositoryOverride("operations"), a.runtime.repositories.operations);
      });
      assert.equal(callbacks, 0); assert.deepEqual(await a.raw(true, true), beforeA); assert.deepEqual(await b.raw(true, true), beforeB);
      await inScope(a, () => withCalendarOperationLock(R, async () => {
        assert.throws(() => b.runtime.run(() => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
      }));
      assert.equal(callbacks, 0); assert.deepEqual(await b.raw(true, true), beforeB); assert.equal(a.remote.ledger.length + b.remote.ledger.length, 0);
      // Unregistered legacy scoped calls must still hit the real PG guard first.
      assert.throws(() => a.runtime.run(() => getPrismaClient()), /DEFAULT_DATABASE_ACCESS_BLOCKED/); clean();
    });

    await suite.test("F2 driver read fault at initial Calendar link scan: promotion commits, 200 omits calendar, no OAuth", async () => {
      resetAccessTokenCache(); const f = await fixture(), p: Probe = { paths: [] }; let faults = 0;
      const find = Collection.prototype.find;
      const injection = mock.method(Collection.prototype, "find", function (this: Collection, ...args: Parameters<Collection["find"]>) {
        if (this.collectionName === f.store.collection("CalendarEventLink").collectionName) { faults++; throw new Error(`${PRIVATE_MARKER}-driver-read`); }
        return Reflect.apply(find, this, args);
      });
      let response: Response;
      try { response = await promote(f, p); } finally { injection.mock.restore(); }
      assert.equal(faults, 1); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, result: RESTORED });
      await requestAudit(f, response); await committed(f); await state(f, 0, 0, 0);
      assert.equal(f.remote.ledger.length, 0); assert.deepEqual(p.paths, revalidations(RUN_ID)); clean();
    });

    for (const mode of ["acl-error", "acl-reader"] as const) await suite.test(`F3/F4 ${mode}: ACL before lease retains exact aggregate and remote state`, async () => {
      resetAccessTokenCache(); const f = await fixture();
      if (mode === "acl-error") f.remote.aclStatus = 403; else f.remote.aclRole = "reader";
      await success(f, await promote(f), mode === "acl-error" ? 2 : 0);
      await committed(f); await state(f, mode === "acl-error" ? 2 : 0, mode === "acl-error" ? 2 : 0, mode === "acl-error" ? 2 : 0);
      assert.equal(f.remote.calls("oauth").length, 1); assert.equal(f.remote.calls("acl").length, 1); clean();
    });

    await suite.test("F5 native held lease makes real backfill item fail once; pre-lease OAuth and ACL remain permitted", async () => {
      resetAccessTokenCache(); const f = await fixture();
      let acquired!: () => void, release!: () => void;
      const ready = new Promise<void>(resolve => { acquired = resolve; });
      const untilReleased = new Promise<void>(resolve => { release = resolve; });
      const holder = inScope(f, () => withCalendarOperationLock(R, async () => { acquired(); await untilReleased; }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([ready, holder.then(() => { throw new Error("Lease holder ended before barrier"); }), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Native held lease barrier missing")), 8000);
        })]);
        const lease = await f.store.db.collection<{ _id: string; owner: string | null }>(`${f.options.namespace}_CalendarOperationLease`).findOne({ _id: R });
        assert.ok(lease?.owner);
        await success(f, await promote(f), 0, 1); await committed(f); await state(f, 0, 0, 0);
        assert.equal(f.remote.calls("oauth").length, 1); assert.equal(f.remote.calls("acl").length, 1); clean();
      } finally { clearTimeout(timer); release(); await holder; }
    });

    for (const fault of [
      { id: "F6", ordinal: 1, mode: "before-apply" as const, inserted: 0, remote: 0, mapping: 0 },
      { id: "F7", ordinal: 1, mode: "after-apply" as const, inserted: 0, remote: 1, mapping: 0 },
      { id: "F9", ordinal: 2, mode: "before-apply" as const, inserted: 1, remote: 1, mapping: 1 }
    ]) await suite.test(`${fault.id} real client transport ${fault.mode} event ${fault.ordinal}: partial state and next-request repair`, async () => {
      resetAccessTokenCache(); const f = await fixture(); f.remote.failPost = fault;
      await success(f, await promote(f), fault.inserted, 1); await committed(f);
      await state(f, fault.remote, fault.mapping, fault.ordinal);
      f.remote.failPost = undefined;
      const priorPosts = f.remote.calls("event", "POST").length;
      await success(f, await promote(f), 2 - fault.mapping, 0, EMPTY);
      await state(f, 2, 2, priorPosts + 2 - fault.mapping);
      assert.equal(f.remote.calls("event", "GET").length, fault.id === "F7" ? 1 : 0);
      if (fault.id === "F7") assert.equal(f.remote.calls("event", "POST")[priorPosts].status, 409);
      for (const call of f.remote.calls("event", "POST")) assert.equal(call.sendUpdates, "none"); clean();
    });

    await suite.test("F8 real native validator 121 after Google success rolls back mapping+audit; new request uses 409 proof", async () => {
      resetAccessTokenCache(); const f = await fixture(); const rejected = await rejectInserts(f, "CalendarEventLink");
      try {
        await success(f, await promote(f), 0, 1); assert.deepEqual(rejected.errors, [121]);
        await committed(f); await state(f, 1, 0, 1);
      } finally { await rejected.restore(); }
      await success(f, await promote(f), 2, 0, EMPTY); await state(f, 2, 2, 3);
      assert.equal(f.remote.calls("event", "POST")[1].status, 409); assert.equal(f.remote.calls("event", "GET").length, 1); clean();
    });

    await suite.test("F12 revalidation failure keeps committed promotion and two mappings but returns original 400", async () => {
      resetAccessTokenCache(); const f = await fixture(), p: Probe = { paths: [], failRevalidation: 2 };
      const response = await promote(f, p); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: GENERIC });
      await requestAudit(f, response); await committed(f); await state(f, 2, 2, 2); assert.deepEqual(p.paths, revalidations(RUN_ID).slice(0, 2)); clean();
    });

    await suite.test("F13 actual withActivity native request-audit failure is best effort after successful Calendar", async () => {
      resetAccessTokenCache(); const f = await fixture(); const rejected = await rejectInserts(f, "ActivityRequest");
      try {
        const response = await promote(f); assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, result: RESTORED, calendar: { insertedEvents: 2, failedOperations: 0 } });
        assert.deepEqual(rejected.errors, [121]); assert.equal(await f.store.collection("ActivityRequest").countDocuments(), 0);
        await committed(f); const { audits } = await state(f, 2, 2, 2);
        for (const row of audits) assert.equal(row.requestId, response.headers.get("X-Request-Id")); clean();
      } finally { await rejected.restore(); }
    });

    await suite.test("H9 complete disabled runtime returns calendar zero, commits promotion and creates no lease or HTTP request", async () => {
      const f = await fixture(); const value = process.env.GOOGLE_CAL_OAUTH_REFRESH_TOKEN;
      try {
        delete process.env.GOOGLE_CAL_OAUTH_REFRESH_TOKEN;
        await success(f, await promote(f), 0); await committed(f); await state(f, 0, 0, 0);
        assert.equal(await f.store.db.collection(`${f.options.namespace}_CalendarOperationLease`).countDocuments(), 0); assert.equal(f.remote.ledger.length, 0); clean();
      } finally { process.env.GOOGLE_CAL_OAUTH_REFRESH_TOKEN = value; }
    });

    await suite.test("H10a concurrent complete namespaces share one Google object; independent mapping, actors and request audits", async () => {
      resetAccessTokenCache(); const remote = new SyntheticCalendarRemote();
      const a = await fixture({ remote, singleDate: true }), b = await fixture({ remote, singleDate: true });
      let arrived = 0, release!: () => void;
      const both = new Promise<void>(resolve => { release = resolve; });
      remote.beforePost = async () => {
        arrived++; if (arrived === 2) release();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([both, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("H10 overlap barrier missing")), 8000); })]); }
        finally { clearTimeout(timer); }
      };
      const [ra, rb] = await Promise.all([promote(a), promote(b, { paths: [] }, other)]);
      const aId = await success(a, ra, 1), bId = await success(b, rb, 1, 0, RESTORED, other); assert.notEqual(aId, bId);
      assert.equal(arrived, 2); assert.equal(remote.active().length, 1);
      assert.deepEqual(remote.calls("event", "POST").map(call => call.status).sort(), [201, 409]); assert.equal(remote.calls("event", "GET").length, 1);
      for (const [f, requestId, actor] of [[a, aId, member], [b, bId, other]] as const) {
        const links = await f.store.scan("CalendarEventLink"); assert.equal(links.length, 1); assert.equal(links[0].eventId, expectedEventId(R, "2099-12-01"));
        const audits = await f.store.scan("ActivityChange", { targetType: "calendar_event_links" }); assert.equal(audits.length, 1);
        assert.equal(audits[0].requestId, requestId); assert.equal(audits[0].actorEmail, actor.user.email); await committed(f);
      }
      clean();
    });

    await suite.test("X3 admin/bearer access, dry-run literal totals, cleanup token preflight and silent real delete", async () => {
      resetAccessTokenCache(); const f = await fixture({ active: true });
      const before = await f.raw();
      const denied = await api(f, backfillAPI.GET, BACKFILL_ROUTE, "GET", undefined, member);
      assert.equal(denied.status, 500); await requestAudit(f, denied, BACKFILL_ROUTE, member, "GET"); assert.equal(f.remote.ledger.length, 0);
      const preview = await api(f, backfillAPI.GET, BACKFILL_ROUTE); assert.equal(preview.status, 200);
      const planned = await preview.json(); assert.equal(planned.dryRun, true); assert.equal(planned.from, "2099-11-30");
      assert.deepEqual(planned.totals, { operationsScanned: 1, inScope: 1, alreadyComplete: 0, excludedNoEducationDates: 0, plannedOperations: 1, plannedEvents: 2, insertedEvents: 0, skippedOperations: 0, failedOperations: 0, capped: false });
      await requestAudit(f, preview, BACKFILL_ROUTE, admin, "GET"); assert.deepEqual(await f.raw(), before); assert.equal(f.remote.calls("event", "POST").length, 0);
      const apply = await api(f, backfillAPI.POST, BACKFILL_ROUTE, "POST", undefined, null, true); assert.equal(apply.status, 200);
      assert.equal((await apply.json()).totals.insertedEvents, 2); await requestAudit(f, apply, BACKFILL_ROUTE, null, "POST", true); await state(f, 2, 2, 2);
      const cleanup = await api(f, backfillAPI.GET, `${BACKFILL_ROUTE}?mode=cleanup&operationIds=${R}`);
      const data = await cleanup.json(); assert.equal(data.candidates.length, 2); assert.equal(data.skipped.length, 0);
      const tokens = data.candidates.map((row: { token: string }) => row.token) as string[];
      const beforeInvalid = await f.raw(); const count = f.remote.ledger.length;
      const invalid = await api(f, backfillAPI.DELETE, BACKFILL_ROUTE, "DELETE", { tokens: [tokens[0], `${tokens[1]}-tampered`] });
      assert.equal(invalid.status, 400); assert.deepEqual(await f.raw(), beforeInvalid); assert.equal(f.remote.ledger.length, count);
      const removed = await api(f, backfillAPI.DELETE, BACKFILL_ROUTE, "DELETE", { tokens }); assert.equal(removed.status, 200);
      const result = await removed.json(); assert.equal(result.deletedEvents, 2); assert.equal(result.failedEvents, 0);
      assert.equal(f.remote.active().length, 0); assert.equal(await f.store.collection("CalendarEventLink").countDocuments(), 0);
      const requestId = await requestAudit(f, removed, BACKFILL_ROUTE, admin, "DELETE");
      const changes = await f.store.scan("ActivityChange", { requestId, targetType: "calendar_event_links" }); assert.equal(changes.length, 2);
      for (const row of changes) assert.equal(row.action, "delete");
      for (const call of f.remote.calls("event", "DELETE")) { assert.equal(call.sendUpdates, "none"); assert.ok(call.ifMatch); }
      assert.ok(await f.store.one("OperationSession", { _id: R_ID, deletedAt: null })); clean();
    });

    await suite.test("X4 real refresh API patches text only with ETag and no mail; missing PATCH does not recreate", async () => {
      resetAccessTokenCache(); const f = await fixture(); await success(f, await promote(f), 2);
      const before = await f.raw(); const preview = await api(f, refreshAPI.GET, REFRESH_ROUTE); assert.equal(preview.status, 200);
      assert.deepEqual((await preview.json()).counts, { planned: 2, updated: 0, missing: 0, skipped: 0, failed: 0 });
      assert.equal(f.remote.calls("event", "PATCH").length, 0);
      f.remote.patchMissingOnce = true;
      const response = await api(f, refreshAPI.POST, REFRESH_ROUTE, "POST"); assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).counts, { planned: 0, updated: 1, missing: 1, skipped: 0, failed: 0 });
      await requestAudit(f, response, REFRESH_ROUTE, admin); assert.deepEqual(await f.raw(), before);
      assert.equal(f.remote.calls("event", "POST").length, 2); assert.equal(f.remote.calls("event", "PATCH").length, 2);
      for (const call of f.remote.calls("event", "PATCH")) {
        assert.equal(call.sendUpdates, "none"); assert.ok(call.ifMatch);
        assert.deepEqual(Object.keys(call.body as object).sort(), ["description", "summary"]);
      }
      clean();
    });

    await suite.test("X1 registered reflecting wrapper: irrelevant update silent; missing mapped event restored with previous ID and default mail", async () => {
      resetAccessTokenCache(); const f = await fixture({ reflecting: true, singleDate: true }); await success(f, await promote(f), 1);
      const afterPromote = f.remote.ledger.length;
      await inScope(f, () => f.runtime.repositories.operations.updateOperation(R, { specialNotes: "Synthetic non-calendar note" }));
      assert.equal(f.remote.ledger.length, afterPromote);
      const oldId = expectedEventId(R, "2099-12-01"); const event = f.remote.events.get(CALENDAR_ID)?.get(oldId); assert.ok(event); event.status = "cancelled";
      // This is a direct repository compatibility test, with explicit actor
      // context so mapping mutation audit is observable without fake withActivity.
      const requestId = "44444444-4444-4444-8444-444444444444";
      await inScope(f, () => activityContext.run({ requestId, actorEmail: member.user.email, actorName: member.user.name, actorType: "user", route: "/synthetic/calendar-forward", method: "PATCH" },
        () => f.runtime.repositories.operations.updateOperation(R, { region: "Synthetic updated region" })));
      const newId = expectedEventId(R, "2099-12-01", oldId);
      const links = await f.store.scan("CalendarEventLink"); assert.equal(links.length, 1); assert.equal(links[0].eventId, newId);
      assert.equal(f.remote.active().length, 1); assert.ok(f.remote.events.get(CALENDAR_ID)?.get(newId));
      const calls = f.remote.calls("event", "POST"); assert.equal(calls.length, 2); assert.equal(calls[0].sendUpdates, "none"); assert.equal(calls[1].sendUpdates, "all");
      const audit = await f.store.scan("ActivityChange", { requestId, targetType: "calendar_event_links" }); assert.equal(audit.length, 1); assert.equal(audit[0].action, "update"); clean();
    });

    await suite.test("X2 actual reverse preview/apply: human-cancelled events retain mapping and operation, no outgoing mutation", async () => {
      resetAccessTokenCache(); const f = await fixture({ reflecting: true, singleDate: true }); await success(f, await promote(f), 1);
      const event = f.remote.active()[0]; event.status = "cancelled";
      const before = await f.raw(); const mutationCount = f.remote.calls("event").filter(call => call.method !== "GET").length;
      const preview = await api(f, reverseAPI.GET, REVERSE_ROUTE, "GET", undefined, null, true); assert.equal(preview.status, 200);
      const plan = await preview.json(); assert.equal(plan.enabled, true); assert.deepEqual(plan.items, []); assert.equal(plan.calendars[0].linkedEvents, 1);
      await requestAudit(f, preview, REVERSE_ROUTE, null, "GET", true);
      const applied = await api(f, reverseAPI.POST, REVERSE_ROUTE, "POST", undefined, null, true); assert.equal(applied.status, 200);
      const result = await applied.json(); assert.equal(result.appliedCount, 0); assert.equal(result.failedCount, 0);
      await requestAudit(f, applied, REVERSE_ROUTE, null, "POST", true); assert.deepEqual(await f.raw(), before);
      assert.equal(f.remote.calls("event").filter(call => call.method !== "GET").length, mutationCount); clean();
    });

    await suite.test("S5 transport subset: actual Calendar API keeps suffix and unknown Korean Google response bodies private", async () => {
      for (const message of [`${CALENDAR_GENERIC} ${PRIVATE_MARKER}`, `등록되지 않은 오류 ${PRIVATE_MARKER}`]) {
        resetAccessTokenCache(); const f = await fixture({ active: true }); f.remote.failPost = { ordinal: 1, mode: "before-apply", message };
        const response = await api(f, backfillAPI.POST, BACKFILL_ROUTE, "POST"); assert.equal(response.status, 200);
        const body = await response.json(); assert.equal(body.totals.insertedEvents, 0); assert.equal(body.totals.failedOperations, 1);
        assert.equal(body.outcomes[0].detail, CALENDAR_GENERIC); assert.ok(!JSON.stringify(body).includes(PRIVATE_MARKER));
        await requestAudit(f, response, BACKFILL_ROUTE, admin); await state(f, 0, 0, 1); clean();
      }
    });
    clean();
  } finally {
    try { if (owned) await client.db(databaseName).dropDatabase(); }
    finally {
      await client.close(); resetAccessTokenCache(); fetchMock.mock.restore(); for (const logger of loggers) logger.mock.restore();
      for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      if (savedPrisma === undefined) delete globals.prisma; else globals.prisma = savedPrisma;
      if (savedPool === undefined) delete globals.calendarLockPool; else globals.calendarLockPool = savedPool;
    }
  }
});
