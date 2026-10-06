/** Calendar v2 adjacent gaps, complementary to mongoCalendarHandlers.integration.test.ts.
 * Parent executes: exact local opt-in only; no dotenv or production fallback.
 * Real registered runtime, operation/mapping writers, lease, planner/apply, auth and
 * request audits. Only auth identity, Next resolution, date and HTTP are synthetic.
 * Faults are labelled: native validator rejection, driver observation, native owner
 * replacement (NOT natural expiry/takeover), gated retry timer and remote response.
 * This is not a frozen-PG parity oracle. Exact E2 cache-promise microtask loss,
 * commit ACK ambiguity, real Google/mail delivery and production wiring stay gaps.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { BSON, Collection, Long, MongoClient, MongoServerError } from "mongodb";
import ts from "typescript";
import { activityContext } from "../activity/context";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoOperationStore, OPERATION_MODELS, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { operationCreationIdentity } from "./operationCreationIdentity";
import type { CreateOperationInput } from "./operationTypes";
import { CALENDAR_ID, PRIVATE_MARKER, SyntheticCalendarRemote, expectedEventId } from "./mongoCalendarHandlers.fixture";

const ADMIN = "synthetic-calendar-admin@day1company.co.kr";
const OM = "가상인접OM", ONSITE = "가상인접현장OM", OM2 = "가상인접2파트OM", LD = "가상인접LD";
const OM_EMAIL = "synthetic-adjacent-om@example.invalid", ONSITE_EMAIL = "synthetic-adjacent-onsite@example.invalid";
const CALENDAR2 = "synthetic-calendar-2@example.invalid";
const R = "synthetic-adjacent-r", A = "synthetic-adjacent-a";
const R_ID = "11111111-1111-4111-8111-111111111111", A_ID = "22222222-2222-4222-8222-222222222222";
const REVERSE_ROUTE = "/api/sync/calendar-events", CLEANUP_ROUTE = "/api/admin/calendar/backfill-events";
const GENERIC = "캘린더 작업을 처리하지 못했습니다.";
const uri = process.env.MONGODB_CALENDAR_TEST_URI;
const exactURI = "mongodb://127.0.0.1:27849/?replicaSet=calendarboundary20260930";
const transport = new AsyncLocalStorage<{ remote: SyntheticCalendarRemote; intercept?: typeof fetch }>();
let pgCalls = 0;
mock.module("@/auth", { namedExports: { auth: async () => ({ user: { email: ADMIN, name: "Synthetic Adjacent Admin" }, expires: "" }) } });
mock.module("@/lib/seoulDate", { namedExports: { getSeoulToday: () => new Date(2099, 10, 30) } });
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_ADAPTER_TRIPWIRE"); } } } });
class PgTripwire { constructor() { pgCalls++; throw new Error("PG_POOL_TRIPWIRE"); } }
mock.module("pg", { namedExports: { Pool: PgTripwire }, defaultExport: { Pool: PgTripwire } });
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
const reverseAPI = await import("../../app/api/sync/calendar-events/route");
const cleanupAPI = await import("../../app/api/admin/calendar/backfill-events/route");
const { backfillMissingCalendarEvents } = await import("../googleCalendar/backfillCalendarEvents");
const { withCalendarOperationLock, calendarLockSignal } = await import("../googleCalendar/calendarOperationLock");
const { resetAccessTokenCache, getGoogleB2BAccessToken, insertOperationEvent, listUpdatedEvents } = await import("../googleCalendar/calendarWriteClient");
const { reflectOperationCreated, reflectOperationUpdated } = await import("../googleCalendar/reflectOperationToCalendar");
hooks.deregister();

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("ADJACENT_BARRIER_TIMEOUT")), 8_000); })]); }
  finally { clearTimeout(timer); }
}
function createInput(suffix: string, overrides: Partial<CreateOperationInput> = {}): CreateOperationInput {
  const input: CreateOperationInput = {
    companyName: `Synthetic Adjacent Company ${suffix}`, courseName: `Synthetic Adjacent Course ${suffix}`, courseId: `ADJACENT-${suffix}`,
    startDate: "2099-12-10", endDate: "2099-12-12", educationDates: ["2099-12-10", "2099-12-12"],
    archiveStatus: "아카이빙전", operationStatus: "배정필요", operationType: "단기", educationFormat: "오프라인",
    onsiteRequired: "N", revenue: null, totalCost: null, instructorCost: null, operationCost: null,
    coach: "", companyWikiLink: "", costRaw: "", driveLink: "", educationDays: "2", instructorWikiLink: "", instructors: "",
    ld: LD, lectureManagementLink: "", om: OM, operationDetail: "", operationIssue: "", padletLink: "", region: "",
    resultReportLink: "", roundNo: "1", specialNotes: "", timeText: "09:00 ~ 10:00", createdBy: ADMIN, ...overrides
  };
  input.creationIdentity = operationCreationIdentity(`synthetic-adjacent-key-${suffix}`, ADMIN, "/api/operations", input);
  return input;
}
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

test("Calendar adjacent: native forward, reverse compensation, cleanup retry and pre-send lease loss", { skip: !uri, timeout: 300_000 }, async suite => {
  assert.equal(uri, exactURI, "Only the dedicated local replica may execute this suite");
  const env = {
    PII_ENCRYPTION_KEYS: JSON.stringify({ adjacent: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "adjacent",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/adjacent_tripwire", OPERATION_DATA_SOURCE: "local",
    ADMIN_EMAILS: ADMIN, DEV_AUTH_BYPASS: "false", SYNC_API_SECRET: "synthetic-adjacent-sync", AUTH_SECRET: "synthetic-adjacent-signing", NEXTAUTH_SECRET: "",
    GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-calendar-client", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-calendar-secret",
    GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-calendar-refresh", GOOGLE_CAL_PART_CALENDARS: `1파트:${CALENDAR_ID},2파트:${CALENDAR2}`,
    HUB_OM_BASE_URL: "", SLACK_CALENDAR_ALERT_EMAIL: "", SLACK_BOT_TOKEN: "synthetic-calendar-slack-token", SLACK_OM_REQUEST_BOT_TOKEN: "synthetic-calendar-slack-token",
    CALENDAR_REVERSE_SYNC_LOOKBACK_MINUTES: "60", CALENDAR_REVERSE_SYNC_MIN_LAG_SECONDS: "0", CALENDAR_REVERSE_SYNC_MAX_APPLY: "20"
  };
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  const globals = globalThis as unknown as { prisma?: unknown; calendarLockPool?: unknown };
  const previousPrisma = globals.prisma, previousPool = globals.calendarLockPool;
  delete globals.prisma; delete globals.calendarLockPool; Object.assign(process.env, env);
  let unscopedFetch = 0;
  const logs: unknown[][] = [];
  const loggers = (["error", "warn", "info", "log", "debug"] as const).map(level => mock.method(console, level, (...values: unknown[]) => { logs.push(values); }));
  const fetchMock = mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const scope = transport.getStore();
    if (!scope) { unscopedFetch++; throw new Error("UNSCOPED_FETCH_TRIPWIRE"); }
    return (scope.intercept ?? scope.remote.fetch)(input, init);
  });
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  const databaseName = `hub_om_shadow_calendar_adjacent_${randomBytes(8).toString("hex")}`;
  const remotes: SyntheticCalendarRemote[] = [];
  let owned = false;
  try {
    await client.connect();
    assert.equal((await client.db(databaseName).listCollections().toArray()).length, 0); owned = true;
    assert.equal((await client.db(databaseName).command({ hello: 1 })).setName, "calendarboundary20260930");
    async function fixture(singleDate = false) {
      resetAccessTokenCache();
      const options = { client, databaseName, namespace: `shadow_adjacent_${randomBytes(6).toString("hex")}`, allowShadowWrites: true as const };
      await prepareMongoCalendarRuntimeStore({ ...options, processSequenceHighWater: 100 });
      const runtime = await openMongoCalendarRuntime({ ...options, reflectOperations: true });
      const store = new MongoOperationStore(options, [...OPERATION_MODELS, "CalendarEventLink", "ActivityRequest"]);
      const remote = new SyntheticCalendarRemote(); remotes.push(remote);
      const wire: { remote: SyntheticCalendarRemote; intercept?: typeof fetch } = { remote };
      const seed = async (model: string, fields: MongoRow) => {
        const row = coachFixtureRow(model, fields);
        await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
      };
      for (const [role, name, email, team] of [
        ["OM", OM, OM_EMAIL, "AX 1파트"], ["OM", ONSITE, ONSITE_EMAIL, "AX 1파트"],
        ["OM", OM2, "synthetic-adjacent-part2@example.invalid", "AX 2파트"], ["LD", LD, "synthetic-adjacent-ld@example.invalid", "AX 1파트"]
      ]) await seed("TeamUser", { role, name, email, team, slackId: `synthetic-slack-${role}-${name}` });
      for (const [name, id, operationId, processSeq] of [["R", R_ID, R, 1], ["A", A_ID, A, 2]] as const) {
        const company = await seed("Company", { name: `Synthetic Adjacent ${name}`, normalizedName: `syntheticadjacent${name.toLowerCase()}` });
        const course = await seed("Course", { companyId: company.id, processSeq, courseId: `ADJ-${name}`, name: `Synthetic Course ${name}`, operationType: "SHORT" });
        await seed("OperationSession", { id, operationId, courseRecordId: course.id,
          operationStatus: "ASSIGNMENT_NEEDED", archiveStatus: "NOT_READY", educationFormat: "OFFLINE", operationChannel: "NEEDS_REVIEW",
          roundNo: "1", startDate: date("2099-12-01"), endDate: date(singleDate ? "2099-12-01" : "2099-12-04"),
          educationDates: name === "A" ? [] : (singleDate ? ["2099-12-01"] : ["2099-12-01", "2099-12-04"]).map(date),
          educationDays: singleDate ? "1" : "2", omName: OM, ldName: LD, onsiteOmName: null, instructorsText: null,
          timeText: "09:00 ~ 10:00", region: null, deletedAt: null, deletedBy: null,
          createdAt: date("2099-11-01"), updatedAt: date("2099-11-29") });
      }
      assert.deepEqual((await store.scan("Course")).map(row => row.processSeq).sort(), [1, 2]);
      assert.equal((await store.collection("__counter").findOne({ _id: "Course.processSeq" }))?.value, 100);
      const run = <T>(work: () => T): T => runtime.run(() => transport.run(wire, () => activityContext.run({
        requestId: randomUUID(), actorEmail: ADMIN, actorName: "Synthetic Adjacent Admin", actorType: "user", route: "/synthetic/calendar-adjacent", method: "POST"
      }, work)));
      // Explicit native fault, not natural lease expiry or a successful second callback.
      const forceOwner = async (operationId: string) => {
        const leases = store.db.collection<{ _id: string; owner: string | null; generation: Long; nonce: string; leaseUntil: Date }>(`${options.namespace}_CalendarOperationLease`, { promoteLongs: false });
        const before = await leases.findOne({ _id: operationId }); assert.ok(before?.owner);
        const owner = randomUUID();
        const result = await leases.updateOne({ _id: operationId, owner: before.owner }, [{ $set: {
          owner: { $literal: owner }, generation: { $add: ["$generation", Long.ONE] }, nonce: { $literal: randomUUID() },
          leaseUntil: { $dateAdd: { startDate: "$$NOW", unit: "millisecond", amount: 60_000 } }
        } }], { writeConcern: { w: "majority", j: true }, timeoutMS: 5_000 });
        assert.equal(result.modifiedCount, 1);
        const after = await leases.findOne({ _id: operationId }); assert.equal(after?.owner, owner);
        return owner;
      };
      return { options, runtime, store, remote, wire, run, forceOwner };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const links = (f: Fixture) => f.run(() => f.runtime.repositories.calendarPersistence.listCalendarEventLinks(R));
    const operationBytes = async (f: Fixture) => {
      const row = await f.store.collection("OperationSession").findOne({ _id: R_ID }); assert.ok(row); return BSON.serialize(row);
    };
    const mappingAudits = (f: Fixture) => f.store.scan("ActivityChange", { targetType: "calendar_event_links" });
    async function api(f: Fixture, handler: (request: Request) => Promise<Response>, method: string, path: string, body?: unknown, bearer = false) {
      const response = await f.run(() => handler(new Request(`https://example.invalid${path}`, {
        method, headers: { ...(bearer ? { Authorization: "Bearer synthetic-adjacent-sync" } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      })));
      const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
      const audit = await f.store.one("ActivityRequest", { _id: requestId }); assert.ok(audit);
      assert.equal(audit.method, method); assert.equal(audit.status, response.status);
      assert.equal(audit.actorType, bearer ? "token_request" : "user");
      assert.equal(audit.actorEmail, bearer ? null : ADMIN);
      return response;
    }
    async function seedForward(f: Fixture) {
      await f.run(async () => {
        const operation = await f.runtime.repositories.operations.getOperationById(R); assert.ok(operation);
        await reflectOperationCreated(operation);
      });
      assert.equal(f.remote.active().length, 2); assert.equal((await links(f)).length, 2);
    }
    function humanMove(f: Fixture) {
      const id = expectedEventId(R, "2099-12-01");
      const event = f.remote.events.get(CALENDAR_ID)?.get(id); assert.ok(event);
      event.start = { dateTime: "2099-12-08T11:00:00+09:00" };
      event.end = { dateTime: "2099-12-08T12:00:00+09:00" };
      event.summary = "Synthetic human title"; event.location = "Synthetic human location";
      event.updated = "2099-12-01T12:00:00.000Z"; event.etag = '"synthetic-human-version"';
      return event;
    }
    async function rejectOperationWrites(f: Fixture, loseLease: boolean) {
      const name = f.store.collection("OperationSession").collectionName;
      await f.store.db.command({ collMod: name, validator: { $and: [operationMongoValidator("OperationSession"), { _id: { $ne: R_ID } }] }, validationLevel: "strict", validationAction: "error" });
      const original = Collection.prototype.replaceOne;
      const codes: number[] = [];
      const observer = mock.method(Collection.prototype, "replaceOne", async function (this: Collection, ...args: Parameters<Collection["replaceOne"]>) {
        try { return await Reflect.apply(original, this, args); }
        catch (error) {
          if (this.collectionName === name && error instanceof MongoServerError && error.code === 121) {
            codes.push(121);
            if (loseLease) await f.forceOwner(R);
          }
          throw error;
        }
      });
      return { codes, restore: async () => {
        observer.mock.restore();
        await f.store.db.command({ collMod: name, validator: operationMongoValidator("OperationSession"), validationLevel: "strict", validationAction: "error" });
      } };
    }
    async function cleanupTokens(f: Fixture) {
      const generated = await f.run(() => backfillMissingCalendarEvents({ dryRun: false, from: "all" }));
      assert.equal(generated.totals.insertedEvents, 1); assert.equal(generated.totals.failedOperations, 0);
      assert.equal(f.remote.calls("event", "POST")[0].sendUpdates, "none");
      const response = await api(f, cleanupAPI.GET, "GET", `${CLEANUP_ROUTE}?mode=cleanup&operationIds=${R}`);
      assert.equal(response.status, 200);
      const result = await response.json(); assert.equal(result.candidates.length, 1);
      return [result.candidates[0].token as string];
    }

    await suite.test("X1 real create/replay/update/delete preserves invitation policy and creation replay is effect-free", async () => {
      const f = await fixture(), input = createInput("lifecycle");
      const created = await f.run(() => f.runtime.repositories.operations.createOperation(input));
      assert.equal(created.creationReplayed, undefined);
      assert.equal(f.remote.active().length, 2);
      assert.deepEqual(f.remote.calls("event", "POST").map(call => call.sendUpdates), ["all", "all"]);
      for (const event of f.remote.active()) {
        assert.deepEqual(event.attendees, [{ email: OM_EMAIL }]);
        assert.equal(event.extendedProperties?.private?.hubOmCreationSource, "forward");
      }
      const courses = await f.store.scan("Course"); assert.ok(courses.some(row => row.processSeq === 101));
      const requests = f.remote.ledger.length, changes = (await f.store.scan("ActivityChange")).length;
      const replay = await f.run(() => f.runtime.repositories.operations.createOperation(input));
      assert.equal(replay.operationId, created.operationId); assert.equal(replay.creationReplayed, true);
      assert.equal(f.remote.ledger.length, requests); assert.equal((await f.store.scan("ActivityChange")).length, changes);
      await f.run(() => f.runtime.repositories.operations.updateOperation(created.operationId, { region: "Synthetic room" }, ADMIN));
      assert.deepEqual(f.remote.calls("event", "PATCH").map(call => call.sendUpdates), ["none", "none"]);
      await f.run(() => f.runtime.repositories.operations.updateOperation(created.operationId, { onsiteOm: ONSITE }, ADMIN));
      assert.deepEqual(f.remote.calls("event", "PATCH").slice(-2).map(call => call.sendUpdates), ["all", "all"]);
      for (const event of f.remote.active()) assert.deepEqual(event.attendees, [{ email: OM_EMAIL }, { email: ONSITE_EMAIL }]);
      await f.run(() => f.runtime.repositories.operations.updateOperation(created.operationId, { onsiteOm: ONSITE }, ADMIN));
      assert.deepEqual(f.remote.calls("event", "PATCH").slice(-2).map(call => call.sendUpdates), ["none", "none"]);
      await f.run(() => f.runtime.repositories.operations.deleteOperation(created.operationId, ADMIN));
      assert.deepEqual(f.remote.calls("event", "DELETE").map(call => call.sendUpdates), ["all", "all"]);
      assert.equal(f.remote.active().length, 0);
      assert.deepEqual(await f.runtime.repositories.calendarPersistence.listCalendarEventLinks(created.operationId), []);
      const row = await f.store.one("OperationSession", { operationId: created.operationId }); assert.ok(row?.deletedAt instanceof Date);
      assert.equal(row.deletedBy, ADMIN);
      const afterDelete = f.remote.ledger.length;
      await assert.rejects(f.run(() => f.runtime.repositories.operations.createOperation(input)), /이미 처리한 등록 요청/);
      assert.equal(f.remote.ledger.length, afterDelete); assert.equal(f.remote.calls("slack").length, 0);
    });

    await suite.test("X1 part reassignment deletes old events then creates in the new calendar, both with mail", async () => {
      const f = await fixture(), operation = await f.run(() => f.runtime.repositories.operations.createOperation(createInput("part-change")));
      const before = f.remote.calls("event").length;
      await f.run(() => f.runtime.repositories.operations.updateOperation(operation.operationId, { om: OM2 }, ADMIN));
      const writes = f.remote.calls("event").slice(before).filter(call => call.method !== "GET");
      assert.deepEqual(writes.map(call => [call.method, call.calendarId, call.sendUpdates]), [
        ["DELETE", CALENDAR_ID, "all"], ["DELETE", CALENDAR_ID, "all"], ["POST", CALENDAR2, "all"], ["POST", CALENDAR2, "all"]
      ]);
      assert.equal(f.remote.active().length, 2);
      const movedLinks = await f.run(() => f.runtime.repositories.calendarPersistence.listCalendarEventLinks(operation.operationId));
      assert.deepEqual([...movedLinks].sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
        ["2099-12-10", "2099-12-12"].map(eventDate => ({ operationId: operation.operationId, calendarId: CALENDAR2,
          eventId: expectedEventId(operation.operationId, eventDate, "", CALENDAR2), eventDate })));
    });

    await suite.test("X5 missing part sends actual Slack DM on create only, never on replay or update", async () => {
      const f = await fixture();
      process.env.SLACK_CALENDAR_ALERT_EMAIL = OM_EMAIL;
      try {
        const input = createInput("missing-part", { om: "", ld: "" });
        const operation = await f.run(() => f.runtime.repositories.operations.createOperation(input));
        const sent = f.remote.calls("slack"); assert.equal(sent.length, 1);
        assert.equal(new URL(sent[0].url).pathname, "/api/chat.postMessage");
        const message = sent[0].body as { channel: string; text: string };
        assert.equal(message.channel, `synthetic-slack-OM-${OM}`);
        assert.ok(message.text.includes(input.companyName)); assert.ok(message.text.includes(input.courseName));
        assert.ok(message.text.includes(operation.operationId)); assert.ok(message.text.includes("캘린더 자동 반영 안 됨"));
        assert.equal(f.remote.calls("event").length, 0);
        const replay = await f.run(() => f.runtime.repositories.operations.createOperation(input)); assert.equal(replay.creationReplayed, true);
        await f.run(() => f.runtime.repositories.operations.updateOperation(operation.operationId, { region: "Synthetic room" }));
        assert.equal(f.remote.calls("slack").length, 1); assert.equal(f.remote.calls("event").length, 0);
      } finally { process.env.SLACK_CALENDAR_ALERT_EMAIL = ""; }
    });

    await suite.test("X2 actual bearer reverse schedule apply moves mapping, keeps ETag, suppresses duplicate reflection and sends no mail", async () => {
      const f = await fixture(); await seedForward(f);
      const human = humanMove(f), sourceId = human.id, sourceEtag = human.etag;
      const preview = await api(f, reverseAPI.GET, "GET", REVERSE_ROUTE, undefined, true); assert.equal(preview.status, 200);
      const plan = await preview.json(); assert.equal(plan.items.length, 1);
      assert.equal(plan.items[0].action, "운영현황 반영");
      assert.deepEqual(plan.items[0].scheduleChange.to, { startDate: "2099-12-08", endDate: "2099-12-08", timeText: "11:00 ~ 12:00" });
      const before = f.remote.calls("event").length;
      const response = await api(f, reverseAPI.POST, "POST", REVERSE_ROUTE, undefined, true); assert.equal(response.status, 200);
      const result = await response.json(); assert.equal(result.ok, true); assert.equal(result.appliedCount, 1); assert.equal(result.failedCount, 0);
      const operation = await f.runtime.repositories.operations.getOperationById(R); assert.ok(operation);
      assert.deepEqual(operation.educationDates, ["2099-12-04", "2099-12-08"]);
      assert.equal(operation.startDate, "2099-12-04"); assert.equal(operation.endDate, "2099-12-08"); assert.equal(operation.timeText, "11:00 ~ 12:00");
      assert.deepEqual((await links(f)).map(link => [link.eventDate, link.eventId]), [
        ["2099-12-04", expectedEventId(R, "2099-12-04")], ["2099-12-08", sourceId]
      ]);
      const writes = f.remote.calls("event").slice(before).filter(call => call.method !== "GET");
      assert.deepEqual(writes.map(call => [call.method, call.sendUpdates]), [["PATCH", "none"], ["PATCH", "none"]]);
      const target = writes.filter(call => call.eventId === sourceId); assert.equal(target.length, 1); assert.equal(target[0].ifMatch, sourceEtag);
      const body = target[0].body as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["extendedProperties", "location", "summary"]);
      const final = f.remote.events.get(CALENDAR_ID)?.get(sourceId); assert.ok(final);
      assert.equal(final.extendedProperties?.private?.hubOmSchedule, "time:2099-12-08T11:00~2099-12-08T12:00");
      assert.deepEqual(final.attendees, [{ email: OM_EMAIL }]);
      assert.equal(final.summary, "[강의관리] Synthetic Adjacent R_Synthetic Course R_1회차");
      const sibling = f.remote.events.get(CALENDAR_ID)?.get(expectedEventId(R, "2099-12-04")); assert.ok(sibling);
      assert.deepEqual(sibling.start, { dateTime: "2099-12-04T11:00:00", timeZone: "Asia/Seoul" });
      const requestId = response.headers.get("X-Request-Id")!;
      const audits = await f.store.scan("ActivityChange", { requestId });
      assert.equal(audits.filter(row => row.targetType === "operation_sessions").length, 1);
      assert.equal(audits.filter(row => row.targetType === "calendar_event_links" && row.action === "update").length, 1);
      const ledgerSize = f.remote.calls("event").filter(call => call.method !== "GET").length;
      const replay = await api(f, reverseAPI.POST, "POST", REVERSE_ROUTE, undefined, true);
      assert.equal((await replay.json()).appliedCount, 0);
      assert.equal(f.remote.calls("event").filter(call => call.method !== "GET").length, ledgerSize);
    });

    for (const loseLease of [false, true]) await suite.test(`X2 native validator 121 after mapping move: ${loseLease ? "owner replacement rejects compensation, moved mapping remains" : "active lease restores the mapping"}`, async () => {
      const f = await fixture(); await seedForward(f); humanMove(f);
      const before = await operationBytes(f), auditCount = (await mappingAudits(f)).length;
      const writeCount = f.remote.calls("event").filter(call => call.method !== "GET").length;
      const fault = await rejectOperationWrites(f, loseLease);
      try {
        const response = await api(f, reverseAPI.POST, "POST", REVERSE_ROUTE); assert.equal(response.status, 200);
        const result = await response.json(); assert.equal(result.ok, false); assert.equal(result.appliedCount, 0); assert.equal(result.failedCount, 1);
        assert.equal(result.outcomes[0].detail, GENERIC); assert.deepEqual(fault.codes, [121]);
        assert.deepEqual(await operationBytes(f), before, "failed operation transaction must retain its original encrypted bytes");
        assert.deepEqual((await links(f)).map(link => [link.eventDate, link.eventId, link.calendarId]), loseLease ? [
          ["2099-12-04", expectedEventId(R, "2099-12-04"), CALENDAR_ID],
          ["2099-12-08", expectedEventId(R, "2099-12-01"), CALENDAR_ID]
        ] : [
          ["2099-12-01", expectedEventId(R, "2099-12-01"), CALENDAR_ID],
          ["2099-12-04", expectedEventId(R, "2099-12-04"), CALENDAR_ID]
        ]);
        const changes = await f.store.scan("ActivityChange", { requestId: response.headers.get("X-Request-Id")!, targetType: "calendar_event_links" });
        assert.equal(changes.length, loseLease ? 1 : 2);
        assert.ok(changes.every(row => row.action === "update"));
        assert.equal((await mappingAudits(f)).length - auditCount, loseLease ? 1 : 2);
        assert.equal(f.remote.calls("event").filter(call => call.method !== "GET").length, writeCount);
        const owner = await f.store.db.collection<{ _id: string; owner: string | null }>(`${f.options.namespace}_CalendarOperationLease`).findOne({ _id: R });
        assert.equal(Boolean(owner?.owner), loseLease);
      } finally { await fault.restore(); }
    });

    for (const replacement of [false, true]) await suite.test(`X3 Google delete then native audit 121: retry ${replacement ? "preserves replacement mapping and event" : "removes only stale mapping without a second Google delete"}`, async () => {
      const f = await fixture(true), tokens = await cleanupTokens(f);
      const oldLink = (await links(f))[0], name = f.store.collection("ActivityChange").collectionName;
      const auditCount = (await mappingAudits(f)).length;
      await f.store.db.command({ collMod: name, validator: { $and: [operationMongoValidator("ActivityChange"), { _id: "synthetic-impossible-id" }] }, validationLevel: "strict", validationAction: "error" });
      const original = Collection.prototype.insertOne; const rejected: number[] = [];
      const observer = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        try { return await Reflect.apply(original, this, args); }
        catch (error) { if (this.collectionName === name && error instanceof MongoServerError) rejected.push(Number(error.code)); throw error; }
      });
      try {
        const response = await api(f, cleanupAPI.DELETE, "DELETE", CLEANUP_ROUTE, { tokens }); assert.equal(response.status, 200);
        const result = await response.json(); assert.equal(result.ok, false); assert.equal(result.deletedEvents, 1); assert.equal(result.failedEvents, 1);
        assert.equal(result.outcomes[0].googleDeleted, true); assert.equal(result.outcomes[0].detail, GENERIC);
        assert.deepEqual(rejected, [121]); assert.deepEqual(await links(f), [oldLink]);
        assert.equal((await mappingAudits(f)).length, auditCount); assert.equal(f.remote.active().length, 0);
      } finally {
        observer.mock.restore();
        await f.store.db.command({ collMod: name, validator: operationMongoValidator("ActivityChange"), validationLevel: "strict", validationAction: "error" });
      }
      let replacementId: string | undefined;
      if (replacement) {
        // Recreate the cancelled event without changing the operation revision:
        // the old cleanup token must reject the replaced mapping specifically.
        await f.run(async () => {
          const current = await f.runtime.repositories.operations.getOperationById(R); assert.ok(current);
          await reflectOperationUpdated(current);
        });
        replacementId = (await links(f))[0].eventId; assert.notEqual(replacementId, oldLink.eventId);
        assert.equal(f.remote.active().length, 1);
      }
      const replacementSnapshot = async () => ({
        events: structuredClone(f.remote.events),
        mappings: (await f.store.collection("CalendarEventLink").find({}).sort({ _id: 1 }).toArray()).map(row => BSON.serialize(row)),
        audits: (await f.store.collection("ActivityChange").find({ targetType: "calendar_event_links" }).sort({ _id: 1 }).toArray()).map(row => BSON.serialize(row)),
        writes: structuredClone(f.remote.calls("event").filter(call => call.method !== "GET"))
      });
      const beforeRetry = replacement ? await replacementSnapshot() : undefined;
      const deletes = f.remote.calls("event", "DELETE").length;
      const response = await api(f, cleanupAPI.DELETE, "DELETE", CLEANUP_ROUTE, { tokens }); assert.equal(response.status, 200);
      const result = await response.json(); assert.equal(result.deletedEvents, 0); assert.equal(result.failedEvents, replacement ? 1 : 0);
      assert.equal(result.ok, !replacement); assert.equal(f.remote.calls("event", "DELETE").length, deletes); assert.equal(deletes, 1);
      assert.equal(f.remote.calls("event", "DELETE")[0].sendUpdates, "none");
      if (replacement) {
        assert.deepEqual(await replacementSnapshot(), beforeRetry, "stale cleanup preserves complete remote objects and encrypted mapping/audit bytes; request audit and lease may change");
        assert.equal((await links(f)).length, 1);
        assert.equal((await links(f))[0].eventId, replacementId);
        assert.equal(f.remote.active().length, 1);
        assert.equal(f.remote.active()[0].id, replacementId);
        assert.equal(result.outcomes[0].detail, "미리보기 후 매핑이 변경되었습니다.");
      } else {
        assert.deepEqual(await links(f), []);
        assert.equal((await mappingAudits(f)).filter(row => row.action === "delete").length, 1);
      }
    });

    const eventBody = { summary: "Synthetic lease boundary", start: { date: "2099-12-01" }, end: { date: "2099-12-02" } };
    await suite.test("E1 native owner replacement while OAuth response is held blocks the subsequent Calendar fetch", async () => {
      const f = await fixture(true), entered = barrier(), release = barrier();
      let calendarAttempts = 0, callbacks = 0, aborted = false;
      f.wire.intercept = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname === "www.googleapis.com") calendarAttempts++;
        const response = await f.remote.fetch(input, init);
        if (url.hostname === "oauth2.googleapis.com") { entered.resolve(); await bounded(release.promise); }
        return response;
      };
      const pending = f.run(() => withCalendarOperationLock(R, async () => {
        callbacks++;
        try { return await insertOperationEvent(CALENDAR_ID, eventBody, { operationId: R, eventDate: "2099-12-01", source: "forward" }); }
        finally { aborted = calendarLockSignal()?.aborted === true; }
      }));
      // Attach a rejection handler before waiting on either side of the barrier.
      const settled = pending.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
      try {
        await bounded(entered.promise); await f.forceOwner(R); release.resolve();
        const result = await bounded(settled); assert.equal(result.ok, false);
        if (result.ok) assert.fail("lost lease unexpectedly sent Calendar mutation");
        assert.ok(result.error instanceof Error); assert.equal(result.error.message, GENERIC);
        assert.equal(aborted, true); assert.equal(callbacks, 1);
        assert.equal(f.remote.calls("oauth").length, 1); assert.equal(calendarAttempts, 0);
        assert.equal(f.remote.active().length, 0); assert.deepEqual(await links(f), []); assert.deepEqual(await mappingAudits(f), []);
      } finally { release.resolve(); await settled; }
    });

    await suite.test("E2 subset: real cached token + native lost owner blocks Calendar; exact post-token microtask race remains separate", async () => {
      const f = await fixture(true); let calendarAttempts = 0;
      f.wire.intercept = async (input, init) => {
        if (new URL(input instanceof Request ? input.url : String(input)).hostname === "www.googleapis.com") calendarAttempts++;
        return f.remote.fetch(input, init);
      };
      await f.run(() => getGoogleB2BAccessToken()); assert.equal(f.remote.calls("oauth").length, 1);
      await assert.rejects(f.run(() => withCalendarOperationLock(R, async () => {
        await f.forceOwner(R);
        await insertOperationEvent(CALENDAR_ID, eventBody, { operationId: R, eventDate: "2099-12-01", source: "forward" });
      })), { message: GENERIC });
      assert.equal(f.remote.calls("oauth").length, 1, "cache path must not request another token");
      assert.equal(calendarAttempts, 0); assert.equal(f.remote.active().length, 0); assert.deepEqual(await links(f), []);
    });

    await suite.test("E3 real GET retry waits 800ms; native owner replacement before gated resume prevents second fetch", async () => {
      const f = await fixture(true), entered = barrier(), release = barrier();
      let calendarAttempts = 0, retryTimers = 0;
      f.wire.intercept = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname !== "www.googleapis.com") return f.remote.fetch(input, init);
        calendarAttempts++;
        const response = await f.remote.fetch(input, init);
        if (calendarAttempts !== 1) return response;
        f.remote.calls("event").at(-1)!.status = 503;
        return Response.json({ error: PRIVATE_MARKER }, { status: 503 });
      };
      const originalTimer = globalThis.setTimeout;
      // Gate only the client retry timer. Native lease 15s/59s timers and clocks stay real.
      const timer = mock.method(globalThis, "setTimeout", ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
        if (delay !== 800) return originalTimer(callback, delay, ...args);
        retryTimers++; entered.resolve();
        return originalTimer(() => { void release.promise.then(() => callback(...args)); }, delay);
      }) as typeof setTimeout);
      const pending = f.run(() => withCalendarOperationLock(R, () => listUpdatedEvents(CALENDAR_ID, "2099-11-30T00:00:00Z")));
      const settled = pending.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
      try {
        await bounded(entered.promise); await f.forceOwner(R); release.resolve();
        const result = await bounded(settled); assert.equal(result.ok, false);
        if (result.ok) assert.fail("lost lease unexpectedly retried Calendar read");
        assert.ok(result.error instanceof Error); assert.equal(result.error.message, GENERIC);
        assert.equal(retryTimers, 1); assert.equal(calendarAttempts, 1);
        assert.equal(f.remote.calls("event", "GET").length, 1); assert.equal(f.remote.calls("event", "POST").length, 0);
        assert.equal(f.remote.active().length, 0); assert.deepEqual(await links(f), []);
      } finally { release.resolve(); await settled; timer.mock.restore(); }
    });

    assert.equal(pgCalls, 0); assert.equal(unscopedFetch, 0);
    for (const remote of remotes) assert.deepEqual(remote.violations, []);
    const text = inspect(logs, { depth: null });
    for (const secret of [PRIVATE_MARKER, R, A, CALENDAR_ID, CALENDAR2, OM, ONSITE, OM_EMAIL, ADMIN, "synthetic-calendar-token", "synthetic-calendar-refresh"]) {
      assert.ok(!text.includes(secret), "Calendar log exposed synthetic private data");
    }
  } finally {
    try { if (owned) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await client.close(); }
      finally {
        resetAccessTokenCache(); fetchMock.mock.restore(); for (const logger of loggers) logger.mock.restore();
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        if (previousPrisma === undefined) delete globals.prisma; else globals.prisma = previousPrisma;
        if (previousPool === undefined) delete globals.calendarLockPool; else globals.calendarLockPool = previousPool;
      }
    }
  }
});
