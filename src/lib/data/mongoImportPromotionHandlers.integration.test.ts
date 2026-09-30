/** plan-v2 §5 / validation-v2 C4-C5: actual POST, guards, facade and native storage.
 * Parent owns execution. Explicit loopback opt-in only; no application URI fallback.
 * Calendar/revalidation are synthetic effects. Driver/repository fault injections
 * are labelled separately from native server failures and original-route controls.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { ClientSession, Collection, MongoClient, MongoServerError } from "mongodb";
import ts from "typescript";
import { activityContext } from "../activity/context";
import { runWithDataRepositories, type DataRepositories } from "./dataRepositoryContext";
import { MongoOperationStore, operationMongoValidator, prepareMongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { MongoOperationRepository } from "./mongoOperationRepository";
import type { CreateOperationInput } from "./operationTypes";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { TEAM_READ_MODELS, prepareMongoReadStore } from "./mongoReadStore";
import { MongoRequestAuditRepository, REQUEST_AUDIT_MODELS, prepareMongoRequestAuditStore } from "./mongoRequestAuditRepository";
import { IMPORT_MODELS, MongoImportRepository, prepareMongoImportStore } from "./mongoImportRepository";
import type { ImportPromotionResult } from "./importPromotionService";

const PRIVATE = "synthetic-promotion-private-marker";
const GENERIC = "반영 요청을 처리하지 못했습니다.";
const NOTION = "Notion 가져오기는 검수용으로만 저장합니다. 중복 방지를 위해 운영 데이터 반영은 막혀 있습니다.";
const route = "/api/admin/imports/[id]/promote";
type Session = { user: { email: string; name: string }; expires: string };
const member: Session = { user: { email: "promotion-member@day1company.co.kr", name: `${PRIVATE}-member` }, expires: "" };
const other: Session = { user: { email: "promotion-other@day1company.co.kr", name: `${PRIVATE}-other` }, expires: "" };
const outsider: Session = { user: { email: "promotion-outsider@example.invalid", name: "Synthetic outsider" }, expires: "" };
const actors = new AsyncLocalStorage<Session | null>();
type Probe = {
  paths: string[];
  order: string[];
  revalidateFailure?: number;
  calendarFailure?: Error;
  transactions: number;
  calendarDuringTransaction: number[];
};
const probes = new AsyncLocalStorage<Probe>();
const probe = (values: Partial<Probe> = {}): Probe => ({ paths: [], order: [], transactions: 0, calendarDuringTransaction: [], ...values });
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0, defaultCalendarCalls = 0;
// Never replace getPrismaClient/assertDefaultDatabaseAccess: the trap is below them.
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
  constructor() { pgCalls++; throw new Error("PG_ADAPTER_TRIPWIRE"); }
} } });
mock.module("@/lib/googleCalendar/backfillCalendarEvents", { namedExports: { backfillMissingCalendarEvents: async () => {
  defaultCalendarCalls++; throw new Error("DEFAULT_CALENDAR_TRIPWIRE");
} } });
mock.module("next/cache.js", { namedExports: { revalidatePath: (path: string) => {
  const current = probes.getStore(); assert.ok(current, "Revalidation needs an explicit test probe");
  current.paths.push(path); current.order.push(`revalidate:${path}`);
  if (current.paths.length === current.revalidateFailure) throw new Error(`${PRIVATE}-revalidation-${path}`);
} } });

// Execute the byte-frozen original route, with ONLY its business/effect boundaries
// supplied synthetically. This is a route-control-flow oracle, not a PG oracle.
type Oracle = {
  promote(id: string): Promise<ImportPromotionResult>;
  calendar(options: { dryRun: false }): Promise<{ totals: { insertedEvents: number; failedOperations: number } }>;
};
const oracleContext = new AsyncLocalStorage<Oracle>();
const oracleGlobal = globalThis as unknown as { hubOmPromotionRouteOracle?: AsyncLocalStorage<Oracle> };
const savedOracle = oracleGlobal.hubOmPromotionRouteOracle;
oracleGlobal.hubOmPromotionRouteOracle = oracleContext;
const fixtureUrl = new URL("../../../.claude/plans/mongodb-import-promotion/original-route.fixture.txt", import.meta.url);
const originalSource = readFileSync(fixtureUrl, "utf8");
const originalDigest = "1af91db9f00445caf1e980bc2a3fea312f4731763b7effbc3a3885d54d2bd33d";
const originalModule = `data:text/javascript,${encodeURIComponent(ts.transpileModule(originalSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === originalModule) {
      if (specifier === "@/lib/data/importPromotionService") return {
        url: "data:text/javascript,export const promoteReadyImportRows=(id)=>globalThis.hubOmPromotionRouteOracle.getStore().promote(id);", shortCircuit: true
      };
      if (specifier === "@/lib/googleCalendar/backfillCalendarEvents") return {
        url: "data:text/javascript,export const backfillMissingCalendarEvents=(options)=>globalThis.hubOmPromotionRouteOracle.getStore().calendar(options);", shortCircuit: true
      };
    }
    // A data URL cannot anchor package resolution; keep the frozen source intact
    // and resolve its remaining Next/alias dependencies from this real file.
    const resolutionContext = context.parentURL === originalModule
      ? { ...context, parentURL: import.meta.url }
      : context;
    return next(["next/server", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, resolutionContext);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText, shortCircuit: true };
    return next(url, context);
  }
});
// Parent supplies these exports; no product/helper edits belong to this sidecar.
const { IMPORT_PROMOTION_MODELS, MongoImportPromotionRepository, prepareMongoImportPromotionStore } = await import("./mongoImportPromotionRepository");
const { getPrismaClient } = await import("./prisma");
const { POST } = await import("../../app/api/admin/imports/[id]/promote/route");
const originalRoute = await import(originalModule) as { POST: typeof POST };
hooks.deregister();

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (id: string) => new Request(`https://example.invalid/api/admin/imports/${id}/promote`, { method: "POST" });
const paths = (id: string) => ["/", "/operations", "/admin/imports", `/admin/imports/${id}`];
const empty: ImportPromotionResult = { blocked: 0, blockedReasons: {}, created: 0, eligible: 0, linkedExisting: 0, revived: 0, sourceRows: 0 };
const created: ImportPromotionResult = { ...empty, created: 1, eligible: 1, sourceRows: 1 };
async function failure(response: Response, error = GENERIC) {
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error });
}
async function success(response: Response, result: ImportPromotionResult, calendar: { insertedEvents: number; failedOperations: number } | null = { insertedEvents: 7, failedOperations: 3 }) {
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, result, ...(calendar ? { calendar } : {}) });
}
function noRedirectLeak(error: unknown) {
  assert.ok(error instanceof Error && "digest" in error);
  assert.equal(error.digest, "NEXT_REDIRECT;replace;/sign-in;307;"); return true;
}
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Synthetic promotion handler barrier not reached")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
async function arrived(held: ReturnType<typeof signal>, pending: Promise<unknown>) {
  await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Request completed before expected barrier"); })]));
}
const uri = process.env.MONGODB_IMPORT_PROMOTION_TEST_URI;

test("promotion actual POST: native Mongo and frozen route state-table oracle", { skip: !uri, timeout: 300_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(["27839", "27849"].includes(url.port));
  assert.equal(url.pathname, "/"); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.hash, "");
  assert.equal(url.searchParams.get("replicaSet"), url.port === "27849" ? "calendarboundary20260930" : "importpromotion20260930");
  for (const [name, value] of url.searchParams) {
    assert.ok(["replicaSet", "directConnection"].includes(name));
    if (name === "directConnection") assert.equal(value, "true");
  }
  assert.equal(createHash("sha256").update(originalSource).digest("hex"), originalDigest);
  const envKeys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL", "DEV_AUTH_BYPASS", "ADMIN_EMAILS", "OPERATION_DATA_SOURCE"];
  const saved = new Map(envKeys.map(name => [name, process.env[name]]));
  const globals = globalThis as unknown as { prisma?: unknown }, savedPrisma = globals.prisma;
  delete globals.prisma;
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/promotion_tripwire", ADMIN_EMAILS: "unrelated-admin@day1company.co.kr", OPERATION_DATA_SOURCE: "local" });
  delete process.env.DEV_AUTH_BYPASS;
  const databaseName = `hub_om_shadow_promotion_handlers_${randomBytes(10).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  let owned = false;
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("EXTERNAL_FETCH_TRIPWIRE"); });
  const logs: unknown[][] = [], oracleLogs: unknown[][] = [];
  const loggers = (["error", "warn", "info", "log"] as const).map(level => mock.method(console, level, (...values: unknown[]) => {
    (oracleContext.getStore() ? oracleLogs : logs).push(values);
  }));
  const transaction = ClientSession.prototype.withTransaction;
  const transactionProbe = mock.method(ClientSession.prototype, "withTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["withTransaction"]>) {
    const current = probes.getStore(); if (current) current.transactions++;
    try { return await Reflect.apply(transaction, this, args); }
    finally { if (current) current.transactions--; }
  });
  try {
    assert.throws(() => getPrismaClient(), /PG_ADAPTER_TRIPWIRE/); assert.equal(pgCalls, 1); pgCalls = 0;
    await client.connect();
    assert.equal((await client.db(databaseName).listCollections().toArray()).length, 0); owned = true;
    async function fixture(suffix = randomBytes(5).toString("hex")) {
      const options = { client, databaseName, namespace: `shadow_promotion_${suffix}`, allowShadowWrites: true as const };
      await prepareMongoImportPromotionStore({ ...options, processSequenceHighWater: 0 });
      await prepareMongoReadStore(options, TEAM_READ_MODELS);
      await prepareMongoRequestAuditStore(options);
      const store = new MongoOperationStore(options, [...new Set([...IMPORT_PROMOTION_MODELS, ...TEAM_READ_MODELS, ...REQUEST_AUDIT_MODELS])]);
      const seed = async (model: string, fields: MongoRow) => {
        const row = coachFixtureRow(model, fields);
        await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
      };
      const om = `${PRIVATE}-om-${suffix}`, ld = `${PRIVATE}-ld-${suffix}`;
      for (const [role, name] of [["OM", om], ["LD", ld]]) await seed("TeamUser", { name, role, team: "1팀", email: `synthetic-${role}@example.invalid`, slackId: `synthetic-${role}` });
      const calls: Array<{ options: unknown; actor: string | undefined; sourceLinks: unknown[]; probe: Probe }> = [];
      const scope = {
        importPromotion: await MongoImportPromotionRepository.open(options),
        teamMembers: await MongoTeamMemberRepository.open(options),
        importPromotionCalendar: { backfillMissingCalendarEvents: async (value: { dryRun: false }) => {
          const current = probes.getStore(); assert.ok(current);
          current.order.push("calendar"); current.calendarDuringTransaction.push(current.transactions);
          calls.push({ options: value, actor: actors.getStore()?.user.email,
            sourceLinks: (await store.scan("OperationSourceRecord")).map(row => row.operationSessionId), probe: current });
          if (current.calendarFailure) throw current.calendarFailure;
          return { totals: { insertedEvents: 7, failedOperations: 3 } };
        } },
        requestActivity: await MongoRequestAuditRepository.open(options)
      };
      async function seedRun(count = 1, sourceType = "csv", validationErrors: string[] = []) {
        const run = await seed("DataImportRun", { sourceType, sourceName: `${PRIVATE}-source`, importedBy: member.user.email,
          status: "COMPLETED", sourceTeam: "TEAM_1", rowCount: count, successCount: count, errorCount: 0 });
        const sources: MongoRow[] = [];
        for (let index = 0; index < count; index++) sources.push(await seed("OperationSourceRecord", {
          importRunId: run.id, operationSessionId: null, sourceTeam: "TEAM_1", sourceWorkbook: `${PRIVATE}.csv`, sourceSheet: `${PRIVATE}-sheet`,
          sourceRowNumber: index + 2, headerRowNumber: 1, sourceFingerprint: randomBytes(32).toString("hex"),
          // Company/course names follow the existing public business-field policy;
          // put privacy sentinels only in existing encrypted personal/source fields.
          mappedFields: { companyName: `Synthetic promotion company ${suffix}-${index}`, courseName: `Synthetic promotion course ${suffix}-${index}`,
            courseId: `synthetic-course-${suffix}-${index}`, om, ld, specialNotes: PRIVATE, startDate: "2099-12-01", endDate: "2099-12-02" },
          rowSnapshot: { private: PRIVATE }, unmappedFields: {}, validationErrors
        }));
        return { id: String(run.id), sources };
      }
      async function raw() {
        const names = (await store.db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name)
          .filter(name => name.startsWith(`${options.namespace}_`) && name !== store.collection("ActivityRequest").collectionName).sort();
        return Promise.all(names.map(async name => [name, await store.db.collection(name).find({}).sort({ _id: 1 }).toArray()]));
      }
      return { options, store, scope, calls, seedRun, raw };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const invoke = (f: Fixture, id: string, p = probe(), actor: Session | null = member, scope: Partial<DataRepositories> = f.scope) =>
      runWithDataRepositories(scope, () => actors.run(actor, () => probes.run(p, () => POST(request(id), context(id)))));
    async function audit(f: Fixture, response: Response, actor = member) {
      const id = response.headers.get("X-Request-Id"); assert.ok(id);
      const row = await f.store.one("ActivityRequest", { _id: id }); assert.ok(row);
      assert.equal(row.actorEmail, actor.user.email); assert.equal(row.actorName, actor.user.name); assert.equal(row.actorType, "user");
      assert.equal(row.route, route); assert.equal(row.method, "POST"); assert.equal(row.status, response.status);
      assert.ok(typeof row.durationMs === "number" && row.durationMs >= 0);
      return id;
    }
    function clean() {
      assert.equal(pgCalls, 0); assert.equal(defaultCalendarCalls, 0); assert.equal(external.mock.callCount(), 0);
      assert.ok(!inspect(logs, { depth: null }).includes(PRIVATE));
    }
    async function committed(f: Fixture, sourceId: unknown, requestId?: string) {
      const source = await f.store.one("OperationSourceRecord", { _id: String(sourceId) }); assert.ok(source);
      assert.equal(typeof source.operationSessionId, "string");
      const operation = await f.store.one("OperationSession", { _id: source.operationSessionId as string }); assert.ok(operation);
      const course = await f.store.one("Course", { _id: operation.courseRecordId as string }); assert.ok(course);
      assert.ok(await f.store.one("Company", { _id: course.companyId as string }));
      if (requestId) {
        const changes = await f.store.scan("ActivityChange", { requestId });
        assert.deepEqual(changes.map(row => row.targetType).sort(), ["companies", "courses", "operation_sessions"]);
        for (const change of changes) { assert.equal(change.actorEmail, member.user.email); assert.equal(change.action, "create"); }
      }
    }
    function effects(f: Fixture, p: Probe, id: string, count = 1, revalidations = 4) {
      const calls = f.calls.filter(call => call.probe === p); assert.equal(calls.length, count);
      for (const call of calls) assert.deepEqual(call.options, { dryRun: false });
      assert.deepEqual(p.calendarDuringTransaction, Array(count).fill(0));
      assert.deepEqual(p.paths, paths(id).slice(0, revalidations));
      assert.deepEqual(p.order, [...Array(count).fill("calendar"), ...paths(id).slice(0, revalidations).map(path => `revalidate:${path}`)]);
    }

    await suite.test("frozen original route independently defines empty-result, Calendar-failure and revalidation-failure control flow", async () => {
      const f = await fixture(), id = randomUUID();
      for (const scenario of ["empty", "calendar-failure", "revalidation-failure"] as const) {
        const p = probe({ ...(scenario === "revalidation-failure" ? { revalidateFailure: 2 } : {}) });
        let promoted = false, calendarCalls = 0;
        const oracle: Oracle = {
          promote: async value => { assert.equal(value, id); promoted = true; return { ...empty }; },
          calendar: async options => { assert.ok(promoted); assert.deepEqual(options, { dryRun: false }); calendarCalls++;
            p.order.push("calendar"); if (scenario === "calendar-failure") throw new Error(`${PRIVATE}-oracle-calendar`);
            return { totals: { insertedEvents: 7, failedOperations: 3 } }; }
        };
        const response = await runWithDataRepositories(f.scope, () => actors.run(member, () => probes.run(p,
          () => oracleContext.run(oracle, () => originalRoute.POST(request(id), context(id))))));
        if (scenario === "revalidation-failure") await failure(response, `${PRIVATE}-revalidation-/operations`);
        else await success(response, empty, scenario === "calendar-failure" ? null : undefined);
        assert.equal(calendarCalls, 1); assert.deepEqual(p.paths, paths(id).slice(0, scenario === "revalidation-failure" ? 2 : 4));
        await audit(f, response);
      }
      // Original raw-error logging is captured separately; only the new route must redact it.
      assert.ok(inspect(oracleLogs, { depth: null }).includes(PRIVATE)); clean();
    });

    await suite.test("actual workspace guard rejects outsiders but permits a non-admin member; default scope remains PG", async () => {
      const f = await fixture(), run = await f.seedRun(), before = await f.raw();
      for (const actor of [null, outsider]) {
        await assert.rejects(invoke(f, run.id, probe(), actor), noRedirectLeak);
      }
      assert.deepEqual(await f.raw(), before); assert.equal(f.calls.length, 0);
      const denied = await f.store.scan("ActivityRequest"); assert.equal(denied.length, 2);
      for (const row of denied) { assert.equal(row.status, 307); assert.equal(row.actorType, "anonymous"); assert.equal(row.actorEmail, null); }
      for (const source of ["local", "notion"]) {
        process.env.OPERATION_DATA_SOURCE = source;
        const response = await actors.run(member, () => probes.run(probe(), () => POST(request(run.id), context(run.id))));
        await failure(response); assert.equal(pgCalls, 2); pgCalls = 0; // business plus best-effort request audit
      }
      process.env.OPERATION_DATA_SOURCE = "local";
      assert.deepEqual(await f.raw(), before); assert.equal(f.calls.length, 0);
      const p = probe(), response = await invoke(f, run.id, p); await success(response, created);
      await committed(f, run.sources[0].id, await audit(f, response)); effects(f, p, run.id);
      assert.ok(f.calls[0].sourceLinks.every(value => typeof value === "string")); clean();
    });

    await suite.test("each missing port is rejected before business, Calendar or revalidation; staging-only scope still refuses promotion", async () => {
      const f = await fixture(), run = await f.seedRun();
      for (const missing of ["importPromotion", "teamMembers", "importPromotionCalendar", "requestActivity"] as const) {
        const partial: Partial<DataRepositories> = { ...f.scope }; delete partial[missing];
        const before = await f.raw(), requestCount = await f.store.collection("ActivityRequest").countDocuments(), p = probe();
        if (missing === "requestActivity") await assert.rejects(invoke(f, run.id, p, member, partial), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
        else { const response = await invoke(f, run.id, p, member, partial); await failure(response); await audit(f, response); }
        assert.equal(await f.store.collection("ActivityRequest").countDocuments(), requestCount + (missing === "requestActivity" ? 0 : 1));
        assert.deepEqual(await f.raw(), before); effects(f, p, run.id, 0, 0); clean();
      }
      await prepareMongoImportStore(f.options);
      const stagingOnly = { imports: await MongoImportRepository.open(f.options), teamMembers: f.scope.teamMembers, requestActivity: f.scope.requestActivity };
      assert.ok(IMPORT_MODELS.every(model => f.store.models.includes(model)));
      const before = await f.raw(), p = probe();
      assert.throws(() => runWithDataRepositories(stagingOnly, () => getPrismaClient()), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
      await failure(await invoke(f, run.id, p, member, stagingOnly));
      assert.deepEqual(await f.raw(), before); effects(f, p, run.id, 0, 0); clean();
    });

    await suite.test("empty/missing run and linked-only replay each invoke exact Calendar options once per successful request", async () => {
      const f = await fixture(), zero = await f.seedRun(0), active = await f.seedRun();
      await success(await invoke(f, active.id), created);
      for (const id of [randomUUID(), zero.id, active.id, active.id]) {
        const before = await f.store.collection("ActivityChange").countDocuments(), p = probe();
        const response = await invoke(f, id, p); await success(response, empty); await audit(f, response);
        effects(f, p, id); assert.equal(await f.store.collection("ActivityChange").countDocuments(), before);
      }
      assert.equal(f.calls.length, 5); clean();
    });

    await suite.test("approved blockedReasons remain visible while blocked-only retries still call Calendar", async () => {
      const f = await fixture(), reason = `${PRIVATE}-approved-row-validation`, run = await f.seedRun(1, "csv", [reason]);
      const result = { ...empty, blocked: 1, sourceRows: 1, blockedReasons: { [reason]: 1 } };
      for (let attempt = 0; attempt < 2; attempt++) {
        const p = probe(), response = await invoke(f, run.id, p); await success(response, result); await audit(f, response); effects(f, p, run.id);
      }
      assert.equal(await f.store.collection("OperationSession").countDocuments(), 0);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0); clean();
    });

    for (const item of [
      { parent: "DataImportRun", blocked: false }, { parent: "DataImportRun", blocked: true },
      { parent: "Course", blocked: false }, { parent: "Company", blocked: false }
    ] as const) await suite.test(`native missing ${item.parent}, blocked=${item.blocked}: generic error with no Calendar or revalidation`, async () => {
      const f = await fixture(), run = await f.seedRun(1, "csv", item.blocked ? [PRIVATE] : []);
      if (item.parent === "DataImportRun") await f.store.collection("DataImportRun").deleteOne({ _id: run.id });
      else {
        const initial = await f.seedRun();
        await success(await invoke(f, initial.id), created);
        const linked = await f.store.one("OperationSourceRecord", { _id: String(initial.sources[0].id) }); assert.ok(linked);
        const operation = await f.store.one("OperationSession", { _id: String(linked.operationSessionId) }); assert.ok(operation);
        const course = await f.store.one("Course", { _id: String(operation.courseRecordId) }); assert.ok(course);
        await f.store.collection("OperationSourceRecord").updateOne({ _id: String(run.sources[0].id) }, { $set: { sourceFingerprint: operation.sourceFingerprint } });
        await f.store.collection(item.parent).deleteOne({ _id: String(item.parent === "Course" ? course.id : course.companyId) });
      }
      const before = await f.raw(), callCount = f.calls.length, p = probe();
      const response = await invoke(f, run.id, p); await failure(response); await audit(f, response);
      assert.deepEqual(await f.raw(), before); assert.equal(f.calls.length, callCount);
      effects(f, p, run.id, 0, 0); clean();
    });

    await suite.test("native Notion rejection and labelled exact-allowlist injection never admit private suffixes or arbitrary Korean errors", async () => {
      const f = await fixture(), run = await f.seedRun(1, "synthetic-NOTION-import"), before = await f.raw(), p = probe();
      const response = await invoke(f, run.id, p); await failure(response, NOTION); await audit(f, response);
      assert.deepEqual(await f.raw(), before); effects(f, p, run.id, 0, 0);
      // Explicit repository-error injection reaches actual POST catch without the
      // repository's safe-error wrapper; this is not native driver failure evidence.
      for (const message of [NOTION, `${NOTION} ${PRIVATE}`, `미등록 내부 오류: ${PRIVATE}`]) {
        const patch = mock.method(f.scope.importPromotion, "promoteReadyImportRows", async () => { throw new MongoServerError({ message, code: 121 }); });
        const injected = probe();
        try {
          const result = await invoke(f, run.id, injected); assert.equal(patch.mock.callCount(), 1);
          await failure(result, message === NOTION ? NOTION : GENERIC); await audit(f, result);
          assert.deepEqual(await f.raw(), before); effects(f, injected, run.id, 0, 0); clean();
        } finally { patch.mock.restore(); }
      }
    });

    await suite.test("native validation failure after business writes aborts all business/counter/audit data and triggers no effects", async () => {
      const f = await fixture(), run = await f.seedRun(), before = await f.raw(), p = probe();
      const collection = f.store.collection("ActivityChange");
      await f.store.db.command({ collMod: collection.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { action: "impossible-synthetic-action" }] } });
      try {
        const response = await invoke(f, run.id, p); await failure(response); await audit(f, response);
        assert.deepEqual(await f.raw(), before); effects(f, p, run.id, 0, 0); clean();
      } finally { await f.store.db.command({ collMod: collection.collectionName, validator: operationMongoValidator("ActivityChange") }); }
    });

    for (const mode of ["callback-retry", "commit-ACK-retry", "unresolved-ACK"] as const) {
      await suite.test(`labelled driver ${mode} injection: Calendar stays outside callback/commit retries`, async () => {
        const f = await fixture(), run = await f.seedRun(), p = probe();
        const insert = Collection.prototype.insertOne, commit = ClientSession.prototype.commitTransaction;
        let inserts = 0, commits = 0;
        const during: number[] = [];
        const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const result = await insert.apply(this, args);
          if (this.collectionName === f.store.collection("OperationSession").collectionName) {
            inserts++; during.push(f.calls.length);
            if (mode === "callback-retry" && inserts === 1) {
              const error = new MongoServerError({ code: 112, message: PRIVATE }); error.addErrorLabel("TransientTransactionError"); throw error;
            }
          }
          return result;
        });
        const commitPatch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
          const result = await commit.apply(this, args);
          if (probes.getStore() === p) {
            commits++; during.push(f.calls.length);
            if (mode !== "callback-retry" && commits === 1) {
              // Native server committed; only the application-visible acknowledgement
              // is injected as lost. Code 50 stops driver retries for unresolved ACK.
              const error = new MongoServerError({ code: mode === "unresolved-ACK" ? 50 : 91, message: PRIVATE });
              error.addErrorLabel("UnknownTransactionCommitResult"); throw error;
            }
          }
          return result;
        });
        try {
          const response = await invoke(f, run.id, p);
          if (mode === "unresolved-ACK") await failure(response); else await success(response, created);
          const requestId = await audit(f, response); await committed(f, run.sources[0].id, requestId);
          assert.equal(inserts, mode === "callback-retry" ? 2 : 1);
          assert.equal(commits, mode === "commit-ACK-retry" ? 2 : 1);
          assert.ok(during.length > 0); assert.ok(during.every(count => count === 0));
          effects(f, p, run.id, mode === "unresolved-ACK" ? 0 : 1, mode === "unresolved-ACK" ? 0 : 4);
          assert.equal(await f.store.collection("OperationSession").countDocuments(), 1); clean();
        } finally { insertPatch.mock.restore(); commitPatch.mock.restore(); }
      });
    }

    // Native Company race, ordinary-first, matching the storage suite's barriers.
    // These are Mongo API/effect assertions, not a resolution of the independent
    // natural-key PG-parity review. No fabricated duplicate/write-conflict errors.
    for (const dates of ["same", "different"] as const) {
      await suite.test(`native Company insert race (${dates} dates, ordinary first): actual POST retries with Calendar once`, async () => {
        const f = await fixture();
        await prepareMongoOperationStore({ ...f.options, processSequenceHighWater: 0 });
        const ordinary = await MongoOperationRepository.open(f.options), run = await f.seedRun();
        const source = run.sources[0], fields = source.mappedFields as Record<string, string>;
        const input: CreateOperationInput = {
          companyName: fields.companyName, courseName: fields.courseName, courseId: fields.courseId,
          startDate: "2099-12-01", endDate: "2099-12-02", educationDates: ["2099-12-01", "2099-12-02"],
          archiveStatus: "아카이빙전", operationStatus: "배정필요", operationType: "단기", educationFormat: "오프라인",
          onsiteRequired: "N", revenue: null, totalCost: null, instructorCost: null, operationCost: null,
          coach: "", companyWikiLink: "", costRaw: "", driveLink: "", educationDays: "2", instructorWikiLink: "",
          instructors: "", ld: fields.ld, lectureManagementLink: "", om: fields.om, operationDetail: "", operationIssue: "",
          padletLink: "", region: "", resultReportLink: "", roundNo: "1", specialNotes: PRIVATE, timeText: "", createdBy: other.user.email
        };
        const startDate = dates === "same" ? "2099-12-01" : "2099-12-05";
        const endDate = dates === "same" ? "2099-12-02" : "2099-12-06";
        await f.store.collection("OperationSourceRecord").replaceOne({ _id: String(source.id) },
          encodeMongoRuntimeDocument("OperationSourceRecord", { ...source, mappedFields: { ...fields, startDate, endDate } }));
        const p = probe(), ordinaryId = randomUUID();
        const ordinaryHeld = signal(), promotionHeld = signal(), releaseOrdinary = signal(), releasePromotion = signal();
        const insert = Collection.prototype.insertOne, findOne = Collection.prototype.findOne;
        let ordinaryPaused = false, promotionPaused = false, runReads = 0;
        let promotionRequestId: string | undefined;
        const conflicts: number[] = [], during: number[] = [];
        const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const company = this.collectionName === f.store.collection("Company").collectionName;
          const promotion = probes.getStore() === p;
          if (company && activityContext.getStore()?.requestId === ordinaryId && !ordinaryPaused) {
            ordinaryPaused = true; ordinaryHeld.resolve(); await bounded(releaseOrdinary.promise);
          }
          if (company && promotion && !promotionPaused) {
            promotionPaused = true; promotionHeld.resolve(); await bounded(releasePromotion.promise);
          }
          if (company && promotion) during.push(f.calls.length);
          try { return await insert.apply(this, args); }
          catch (error) {
            if (company && promotion && error instanceof MongoServerError && [11000, 112].includes(Number(error.code))) {
              conflicts.push(Number(error.code)); during.push(f.calls.length);
            }
            throw error;
          }
        });
        const readPatch = mock.method(Collection.prototype, "findOne", async function (this: Collection, ...args: Parameters<Collection["findOne"]>) {
          if (probes.getStore() === p && this.collectionName === f.store.collection("DataImportRun").collectionName) {
            runReads++; during.push(f.calls.length);
            const requestId = activityContext.getStore()?.requestId; assert.ok(requestId);
            if (promotionRequestId) assert.equal(requestId, promotionRequestId);
            promotionRequestId = requestId;
          }
          return Reflect.apply(findOne, this, args);
        });
        const winner = runWithDataRepositories(f.scope, () => activityContext.run({ requestId: ordinaryId,
          actorEmail: other.user.email, actorName: other.user.name, actorType: "user", route: "/synthetic/manual-create", method: "POST"
        }, () => ordinary.createOperation(input)));
        void winner.catch(() => {});
        let pending: Promise<Response> | undefined;
        try {
          await arrived(ordinaryHeld, winner);
          pending = invoke(f, run.id, p); void pending.catch(() => {});
          await arrived(promotionHeld, pending);
          releaseOrdinary.resolve(); const manual = await winner;
          assert.equal(f.calls.length, 0);
          releasePromotion.resolve(); const response = await pending;
          await success(response, { ...empty, sourceRows: 1, eligible: 1,
            created: dates === "same" ? 0 : 1, linkedExisting: dates === "same" ? 1 : 0 });
          const requestId = await audit(f, response); assert.equal(requestId, promotionRequestId);
          assert.ok(conflicts.length >= 1, "Require a native 11000/112 from Company insert, not sequential success");
          assert.ok(runReads >= 2, "Actual POST must re-read its run in the retried transaction");
          assert.ok(during.length > 0 && during.every(count => count === 0));
          effects(f, p, run.id); assert.equal(f.calls.length, 1);
          assert.equal(f.calls[0].actor, member.user.email);
          assert.equal(await f.store.collection("Company").countDocuments(), 1);
          assert.equal(await f.store.collection("Course").countDocuments(), 1);
          assert.equal(await f.store.collection("OperationSession").countDocuments(), dates === "same" ? 1 : 2);
          assert.equal((await f.store.collection("__counter").findOne({ _id: "Course.processSeq" }))?.value, 1);
          const manualRow = await f.store.one("OperationSession", { operationId: manual.operationId }); assert.ok(manualRow);
          const linked = await f.store.one("OperationSourceRecord", { _id: String(source.id) }); assert.ok(linked?.operationSessionId);
          const promoted = await f.store.one("OperationSession", { _id: String(linked.operationSessionId) }); assert.ok(promoted);
          if (dates === "same") assert.equal(promoted.id, manualRow.id);
          else assert.notEqual(promoted.id, manualRow.id);
          assert.equal(promoted.courseRecordId, manualRow.courseRecordId);
          assert.equal((promoted.startDate as Date).toISOString().slice(0, 10), startDate);
          assert.equal((promoted.endDate as Date).toISOString().slice(0, 10), endDate);
          const course = await f.store.one("Course", { _id: String(promoted.courseRecordId) }); assert.ok(course);
          assert.equal(course.name, input.courseName); assert.equal(course.courseId, input.courseId);
          assert.equal((await f.store.one("Company", { _id: String(course.companyId) }))?.name, input.companyName);
          assert.deepEqual(f.calls[0].sourceLinks, [promoted.id]);
          await committed(f, source.id);
          const changes = await f.store.scan("ActivityChange", { requestId });
          if (dates === "same") assert.deepEqual(changes, []);
          else {
            assert.equal(changes.filter(row => row.targetType === "operation_sessions" && row.action === "create").length, 1);
            assert.ok(changes.every(row => row.actorEmail === member.user.email));
          }
          // The shared lock nonce and request audit may change on a new request;
          // exact business/source/counter/creation/audit documents must not.
          const business = () => Promise.all([...IMPORT_PROMOTION_MODELS, "__counter", "__creation"].map(async model =>
            [model, await f.store.collection(model).find({}).sort({ _id: 1 }).toArray()]));
          const before = await business(), again = probe(), replay = await invoke(f, run.id, again);
          await success(replay, empty);
          const replayId = await audit(f, replay); assert.notEqual(replayId, requestId);
          assert.deepEqual(await business(), before);
          assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId: replayId }), 0);
          effects(f, again, run.id); assert.equal(f.calls.length, 2);
          assert.deepEqual(f.calls[1].sourceLinks, [promoted.id]);
          assert.equal(await f.store.collection("ActivityRequest").countDocuments(), 2); clean();
        } finally {
          releaseOrdinary.resolve(); releasePromotion.resolve();
          await Promise.allSettled(pending ? [winner, pending] : [winner]);
          readPatch.mock.restore(); insertPatch.mock.restore();
        }
      });
    }

    await suite.test("Calendar errors retain committed success, omit calendar and log only a fixed string", async () => {
      let fixed: unknown[][] | undefined;
      for (const message of [`${PRIVATE}-calendar-one`, `${PRIVATE}-calendar-two`]) {
        const f = await fixture(), run = await f.seedRun(), p = probe({ calendarFailure: new Error(message) }), start = logs.length;
        const response = await invoke(f, run.id, p); await success(response, created, null);
        await committed(f, run.sources[0].id, await audit(f, response)); effects(f, p, run.id);
        const emitted = logs.slice(start); assert.equal(emitted.length, 1); assert.equal(emitted[0].length, 1);
        assert.equal(typeof emitted[0][0], "string");
        if (fixed) assert.deepEqual(emitted, fixed); else fixed = emitted;
        clean();
      }
    });

    await suite.test("each revalidation failure preserves native commit and original HTTP400 with only the attempted path prefix", async () => {
      for (const nth of [1, 2, 3, 4]) {
        const f = await fixture(), run = await f.seedRun(), p = probe({ revalidateFailure: nth });
        const response = await invoke(f, run.id, p); await failure(response);
        await committed(f, run.sources[0].id, await audit(f, response)); effects(f, p, run.id, 1, nth); clean();
      }
    });

    await suite.test("native request audit failure is best-effort and neither undoes commit nor repeats effects", async () => {
      const f = await fixture(), run = await f.seedRun(), p = probe(), start = logs.length;
      const collection = f.store.collection("ActivityRequest");
      await f.store.db.command({ collMod: collection.collectionName, validator: { $and: [operationMongoValidator("ActivityRequest"), { status: { $lt: 0 } }] } });
      try {
        const response = await invoke(f, run.id, p); await success(response, created);
        const id = response.headers.get("X-Request-Id"); assert.ok(id);
        assert.equal(await collection.countDocuments({ _id: id }), 0); await committed(f, run.sources[0].id, id); effects(f, p, run.id);
        assert.deepEqual(logs.slice(start), [["[activity] API request log write failed"]]); clean();
      } finally { await f.store.db.command({ collMod: collection.collectionName, validator: operationMongoValidator("ActivityRequest") }); }
    });

    await suite.test("overlapping explicit scopes isolate native storage, Calendar effects, identities and revalidation", async () => {
      const a = await fixture(), b = await fixture(), ar = await a.seedRun(), br = await b.seedRun();
      const pa = probe(), pb = probe();
      let release!: () => void;
      const gate = new Promise<void>(done => { release = done; });
      const start = (f: Fixture, id: string, p: Probe, actor: Session) => runWithDataRepositories(f.scope,
        () => actors.run(actor, () => probes.run(p, async () => { await gate; return POST(request(id), context(id)); })));
      const pending = [start(a, ar.id, pa, member), start(b, br.id, pb, other)]; release();
      const results = await Promise.allSettled(pending);
      const [ra, rb] = results.map(result => { assert.equal(result.status, "fulfilled"); return result.value; });
      await success(ra, created); await success(rb, created);
      await audit(a, ra); await audit(b, rb, other); effects(a, pa, ar.id); effects(b, pb, br.id);
      assert.equal(a.calls[0].actor, member.user.email); assert.equal(b.calls[0].actor, other.user.email);
      assert.equal(await a.store.one("DataImportRun", { _id: br.id }), null);
      assert.equal(await b.store.one("DataImportRun", { _id: ar.id }), null);
      assert.equal(await a.store.one("ActivityRequest", { _id: rb.headers.get("X-Request-Id")! }), null);
      assert.equal(await b.store.one("ActivityRequest", { _id: ra.headers.get("X-Request-Id")! }), null);
      await committed(a, ar.sources[0].id); await committed(b, br.sources[0].id); clean();
    });

    await suite.test("all native raw data and new-route logs redact private markers; source models have no mutation audits", async () => {
      for (const { name } of await client.db(databaseName).listCollections({}, { nameOnly: true }).toArray()) {
        const raw = JSON.stringify(await client.db(databaseName).collection(name).find({}).toArray());
        for (const value of [PRIVATE, member.user.email, other.user.email]) assert.ok(!raw.includes(value));
        if (name.endsWith("_ActivityChange")) assert.equal(await client.db(databaseName).collection(name).countDocuments({ targetType: { $in: ["data_import_runs", "operation_source_records"] } }), 0);
      }
      clean();
    });
  } finally {
    try { if (owned) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await client.close(); }
      finally {
        transactionProbe.mock.restore(); external.mock.restore(); for (const logger of loggers) logger.mock.restore();
        if (savedPrisma === undefined) delete globals.prisma; else globals.prisma = savedPrisma;
        if (savedOracle === undefined) delete oracleGlobal.hubOmPromotionRouteOracle; else oracleGlobal.hubOmPromotionRouteOracle = savedOracle;
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    }
  }
});
