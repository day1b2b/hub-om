/** V7 actual reader -> actual page, in THREE separate parent-run Node processes.
 * DRIVE_HISTORY_PAGE_BACKEND=original-pg | current-pg | native.
 * Parent prepares/migrates the dedicated PG database; this suite performs no DDL.
 * PG gate/other workers must finish first. No dotenv, external fetch or default URI.
 * This file + its page-only fixtures are not a full reader/collation/lease oracle.
 * Auth platform input is synthetic; actual workspace guard, Next redirect/Link,
 * SessionProvider, sidebar, page and every local presenter execute unchanged.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { mock, test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionProvider } from "next-auth/react";
import type { PrismaClient } from "@prisma/client";
import pg from "pg";
import { BSON, Collection, MongoClient } from "mongodb";
import ts from "typescript";
import { ACTOR, MEMBERS, PAGE_RUN_ID, OLD_RUN_ID, EMPTY_RUN_ID, RESULT_SEEDS, RUN_SEED,
  expectedView, assertPageMarkup, assertEmptyMarkup } from "./driveImportHistoryPage.fixture";
import { installFrozenPageLoader } from "./driveImportHistoryPageFrozen.fixture";

const backend = process.env.DRIVE_HISTORY_PAGE_BACKEND;
const pgURL = "postgresql://synthetic@127.0.0.1:56750/drive_history_test";
const mongoURI = "mongodb://127.0.0.1:27850/?replicaSet=drivehistory20260930";
type Actor = typeof ACTOR | null;
// createElement supplies children separately; retain the actual provider identity.
const SessionProviderWithOptionalChildren = SessionProvider as (
  props: Omit<Parameters<typeof SessionProvider>[0], "children"> & { children?: ReactNode }
) => ReturnType<typeof SessionProvider>;
type Page = (props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) => Promise<ReactNode>;
type History = { readLatestDriveImportRun(limit?: number): Promise<unknown>; readLatestDriveImportResult(id: string): Promise<unknown> };
type Team = { listResourceOwners(): Promise<unknown>; listRoleRosters(): Promise<unknown> };
type Scope = { driveImportHistory?: History; teamMembers?: Team };
type ContextModule = { runWithDataRepositories<T>(scope: Scope, work: () => T): T };
const actorContext = new AsyncLocalStorage<{ actor: Actor; events: string[]; wait?: Promise<void> }>();
const calls = new AsyncLocalStorage<string[]>();
const auth = async () => {
  const context = actorContext.getStore(); assert.ok(context, "auth platform input required");
  context.events.push("auth:start"); await context.wait; context.events.push("auth:done"); return context.actor;
};
const authGlobal = globalThis as unknown as { __drivePageSyntheticAuth?: typeof auth };
const authURL = `data:text/javascript,export const auth=()=>globalThis.__drivePageSyntheticAuth();`;
function barrier() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; }
function redirected(error: unknown) {
  assert.ok(error instanceof Error);
  assert.equal((error as Error & { digest?: string }).digest, "NEXT_REDIRECT;replace;/sign-in;307;"); return true;
}

// No default mode: an unconfigured invocation skips, never substitutes fake data.
test("Drive V7 actual page: explicit original-PG/current-PG/native worker", { skip: !backend, timeout: 240_000 }, async suite => {
  assert.ok(["original-pg", "current-pg", "native"].includes(backend!));
  const native = backend === "native", original = backend === "original-pg";
  const names = ["DATABASE_URL", "DIRECT_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DEV_AUTH_BYPASS", "DEV_AUTH_EMAIL", "ADMIN_EMAILS", "TZ"];
  const saved = new Map(names.map(key => [key, process.env[key]]));
  // Parent must launch a sanitized worker, never inherit production credentials.
  for (const name of ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY"]) assert.ok(process.env[name] === undefined, `Unexpected inherited ${name}`);
  if (native) assert.equal(process.env.MONGODB_DRIVE_HISTORY_TEST_URI, mongoURI);
  else assert.equal(process.env.PG_DRIVE_HISTORY_TEST_DATABASE_URL, pgURL);
  Object.assign(process.env, { OPERATION_DATA_SOURCE: "postgres", DEV_AUTH_BYPASS: "false", ADMIN_EMAILS: "", TZ: "UTC",
    PII_ENCRYPTION_KEYS: JSON.stringify({ page: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "page",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  if (!native) process.env.DATABASE_URL = pgURL;
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  assert.equal(globals.prisma, undefined, "isolated process/module cache required");
  assert.equal(authGlobal.__drivePageSyntheticAuth, undefined); authGlobal.__drivePageSyntheticAuth = auth;
  const logs: unknown[][] = [];
  const loggers = (["error", "warn", "log", "info", "debug"] as const).map(level => mock.method(console, level, (...args: unknown[]) => { logs.push(args); }));
  let fetchCalls = 0;
  const fetchMock = mock.method(globalThis, "fetch", async (): Promise<Response> => {
    fetchCalls++; throw new Error("DRIVE_PAGE_EXTERNAL_FETCH_FORBIDDEN");
  });
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      return next(["next/navigation", "next/link", "next/cache", "next/server"].includes(specifier) ? `${specifier}.js` : specifier, context);
    },
    load(url, context, next) {
      // Frozen data URLs may end in #page.tsx; their source is already transpiled.
      if (url.startsWith("file:") && url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        fileName: fileURLToPath(url), compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText, shortCircuit: true };
      return next(url, context);
    }
  });
  const moduleMocks: Array<{ restore(): void }> = [];
  const originalQuery = pg.Client.prototype.query;
  const queryObserver = mock.method(pg.Client.prototype, "query", function (this: pg.Client, ...args: unknown[]) {
    calls.getStore()?.push("db:pg:query");
    return Reflect.apply(originalQuery, this, args);
  });
  const originalFind = Collection.prototype.find;
  const findObserver = mock.method(Collection.prototype, "find", function (this: Collection, ...args: unknown[]) {
    calls.getStore()?.push("db:mongo:find");
    return Reflect.apply(originalFind, this, args);
  });
  if (native) moduleMocks.push(mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
    constructor() { throw new Error("PAGE_NATIVE_PG_ADAPTER_FORBIDDEN"); }
  } } }));
  const frozen = original ? installFrozenPageLoader(authURL) : undefined;
  let sql: pg.Client | undefined, prisma: PrismaClient | undefined, client: MongoClient | undefined;
  let sqlConnected = false, seededPg = false, mongoOwned = false;
  const databaseName = `hub_om_shadow_drive_page_${randomBytes(8).toString("hex")}`;
  const namespace = `shadow_page_${randomBytes(6).toString("hex")}`;
  const allIds = [PAGE_RUN_ID, OLD_RUN_ID, EMPTY_RUN_ID, ...MEMBERS.map(row => row.id), ...RESULT_SEEDS.map(row => row.id)];
  try {
    let context: ContextModule;
    let reader: History;
    let page: Page;
    let scope: Scope | undefined;
    let team!: Team;
    let snapshot: () => Promise<string>;
    let replaceCandidates: (value: unknown) => Promise<void>;
    let createEmptyRun: () => Promise<void>;
    let deleteEmptyRun: () => Promise<void>;
    let eraseRuns: () => Promise<void>;
    const observed = new WeakMap<object, object>();
    // Transparent observation only: actual selected port methods receive unchanged args/results.
    function observe<T extends object>(kind: string, repository: T): T {
      const cached = observed.get(repository); if (cached) return cached as T;
      const proxy = new Proxy(repository, { get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => { calls.getStore()?.push(`read:${kind}:${String(key)}`); return Reflect.apply(value, target, args); };
      } });
      observed.set(repository, proxy); return proxy;
    }
    if (original) {
      context = await frozen!.load<ContextModule>("src/lib/data/dataRepositoryContext.ts");
      reader = await frozen!.load<History>("src/lib/driveImports/driveImportResults.ts");
      prisma = (await frozen!.load<{ getPrismaClient(): PrismaClient }>("src/lib/data/prisma.ts")).getPrismaClient();
      team = (await frozen!.load<{ getStoredTeamMemberRepository(): Team }>("src/lib/data/teamMemberRepositoryFactory.ts")).getStoredTeamMemberRepository();
      page = (await frozen!.load<{ default: Page }>("src/app/drive-import-runs/page.tsx")).default;
    } else {
      moduleMocks.push(mock.module("@/auth", { namedExports: { auth } }));
      context = await import("./dataRepositoryContext") as unknown as ContextModule;
      // Product module contract agreed with coordinator. Imported before page, never replaced with a fake reader.
      const historyFactoryPath = "../driveImports/driveImportResults";
      const historyFactory = await import(historyFactoryPath) as History & { getDriveImportHistoryRepository(): History };
      const teamFactory = await import("./teamMemberRepositoryFactory");
      moduleMocks.push(mock.module(historyFactoryPath, { namedExports: { ...historyFactory, getDriveImportHistoryRepository: () => {
        const repository = historyFactory.getDriveImportHistoryRepository(); calls.getStore()?.push("select:history"); return observe("history", repository);
      } } }));
      moduleMocks.push(mock.module("./teamMemberRepositoryFactory", { namedExports: { ...teamFactory, getStoredTeamMemberRepository: () => {
        const repository = teamFactory.getStoredTeamMemberRepository(); calls.getStore()?.push("select:team"); return observe("team", repository);
      } } }));
      reader = historyFactory;
      page = (await import("../../app/drive-import-runs/page")).default;
      if (native) {
        client = new MongoClient(mongoURI, { directConnection: true, serverSelectionTimeoutMS: 5_000 }); await client.connect();
        assert.equal((await client.db("admin").command({ hello: 1 })).setName, "drivehistory20260930");
        assert.equal((await client.db(databaseName).listCollections().toArray()).length, 0); mongoOwned = true;
        const options = { client, databaseName, namespace, allowShadowWrites: true as const };
        const { prepareMongoReadStore } = await import("./mongoReadStore");
        const { MongoOperationStore } = await import("./mongoOperationStore");
        const { encodeMongoRuntimeDocument } = await import("./mongoRuntimeCodec");
        const { coachFixtureRow } = await import("./mongoCoachFixtures");
        const models = ["DriveImportRun", "DriveImportResult", "OperationSession", "Member", "TeamUser", "ActivityChange"];
        await prepareMongoReadStore(options, models);
        const store = new MongoOperationStore(options, models);
        const seed = async (model: string, rows: Array<Record<string, unknown>>) => {
          await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, coachFixtureRow(model, row))));
        };
        await seed("Member", MEMBERS);
        await seed("DriveImportRun", [RUN_SEED, { ...RUN_SEED, id: OLD_RUN_ID, status: "COMPLETED", startedAt: new Date("2031-01-01T00:00:00Z"), finishedAt: new Date("2031-01-01T01:00:00Z") }]);
        await seed("DriveImportResult", RESULT_SEEDS);
        const nativePath = "./mongoDriveImportHistoryRepository";
        const nativeModule = await import(nativePath) as { MongoDriveImportHistoryRepository: { open(input: typeof options): Promise<History> } };
        const history = await nativeModule.MongoDriveImportHistoryRepository.open(options);
        const { MongoTeamMemberRepository } = await import("./mongoTeamMemberRepository");
        team = await MongoTeamMemberRepository.open(options);
        scope = { driveImportHistory: history, teamMembers: team };
        snapshot = async () => {
          const rows = await Promise.all(models.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray()));
          return createHash("sha256").update(BSON.serialize({ rows })).digest("hex");
        };
        replaceCandidates = async value => {
          await store.collection("DriveImportResult").replaceOne({ _id: RESULT_SEEDS[0].id },
            encodeMongoRuntimeDocument("DriveImportResult", coachFixtureRow("DriveImportResult", { ...RESULT_SEEDS[0], keyCandidates: value })));
        };
        createEmptyRun = () => seed("DriveImportRun", [{ ...RUN_SEED, id: EMPTY_RUN_ID, startedAt: new Date("2031-01-03T03:04:05Z") }]);
        deleteEmptyRun = async () => { await store.collection("DriveImportRun").deleteOne({ _id: EMPTY_RUN_ID }); };
        eraseRuns = async () => { await store.collection("DriveImportResult").deleteMany({}); await store.collection("DriveImportRun").deleteMany({}); };
      } else {
        prisma = (await import("./prisma")).getPrismaClient(); team = teamFactory.getStoredTeamMemberRepository();
      }
    }
    if (!native) {
      sql = new pg.Client({ connectionString: pgURL, connectionTimeoutMillis: 5_000, query_timeout: 15_000, options: "-c timezone=UTC -c statement_timeout=15000" });
      await sql.connect(); sqlConnected = true;
      assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port")).rows, [{ db: "drive_history_test", usr: "synthetic", port: 56750 }]);
      const directory = process.env.PG_DRIVE_HISTORY_TEST_DATA_DIRECTORY;
      assert.ok(directory?.startsWith("/private/tmp/hub-om-drive-import-history-20260930/") && !directory.includes(".."));
      assert.equal((await sql.query("SHOW data_directory")).rows[0].data_directory, directory);
      assert.equal((await sql.query("SELECT pg_try_advisory_lock(73137056750::bigint) AS owned")).rows[0].owned, true);
      // Parent applies baseline migrations. Never drop/create/alter any schema here.
      for (const table of ["drive_import_results", "drive_import_runs", "members", "activity_changes"]) {
        assert.equal((await sql.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, `Parent must provide empty isolated ${table}`);
      }
      seededPg = true;
      await prisma!.member.createMany({ data: MEMBERS as never });
      await prisma!.driveImportRun.createMany({ data: [RUN_SEED, { ...RUN_SEED, id: OLD_RUN_ID, status: "COMPLETED", startedAt: new Date("2031-01-01T00:00:00Z"), finishedAt: new Date("2031-01-01T01:00:00Z") }] as never });
      await prisma!.driveImportResult.createMany({ data: RESULT_SEEDS as never });
      snapshot = async () => {
        const rows = [];
        for (const table of ["drive_import_results", "drive_import_runs", "members", "activity_changes"]) rows.push((await sql!.query(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY id`)).rows);
        return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
      };
      replaceCandidates = async value => { await prisma!.driveImportResult.update({ where: { id: RESULT_SEEDS[0].id }, data: { keyCandidates: value as never } }); };
      createEmptyRun = async () => { await prisma!.driveImportRun.create({ data: { ...RUN_SEED, id: EMPTY_RUN_ID, startedAt: new Date("2031-01-03T03:04:05Z") } as never }); };
      deleteEmptyRun = async () => { await prisma!.driveImportRun.delete({ where: { id: EMPTY_RUN_ID } }); };
      eraseRuns = async () => {
        await prisma!.driveImportResult.deleteMany({ where: { id: { in: RESULT_SEEDS.map(row => row.id) } } });
        await prisma!.driveImportRun.deleteMany({ where: { id: { in: [PAGE_RUN_ID, OLD_RUN_ID, EMPTY_RUN_ID] } } });
      };
    }
    const inScope = <T>(work: () => T, override = scope): T => override ? context.runWithDataRepositories(override, work) : work();
    const render = async (actor: Actor = ACTOR, params: Record<string, string | string[] | undefined> = {}, override = scope, events: string[] = [], wait?: Promise<void>) => {
      return calls.run(events, () => actorContext.run({ actor, events, wait }, () => inScope(async () => {
        const element = await page({ searchParams: Promise.resolve(params) });
        return renderToStaticMarkup(createElement(SessionProviderWithOptionalChildren, { session: actor }, element));
      }, override)));
    };
    await suite.test("actual reader full DTO and native/stored team roster", async () => {
      const before = await snapshot!();
      assert.deepEqual(await inScope(() => reader.readLatestDriveImportRun()), expectedView());
      assert.deepEqual(await inScope(() => team.listResourceOwners()), { "1팀": ["가상페이지1팀"], "2팀": ["가상페이지2팀"] });
      assert.equal(await snapshot!(), before);
    });
    await suite.test("actual workspace guard rejects anonymous/outside domain before any scoped data read", async () => {
      let reads = 0;
      const forbidden = async () => { reads++; throw new Error("AUTH_READ_FORBIDDEN"); };
      // Original has no history scope yet. The team trap + actual default DB byte
      // snapshot complements current/native two-port traps without changing guard.
      const probes: Scope = { teamMembers: { listResourceOwners: forbidden, listRoleRosters: forbidden },
        ...(!original ? { driveImportHistory: { readLatestDriveImportRun: forbidden, readLatestDriveImportResult: forbidden } } : {}) };
      const before = await snapshot!();
      for (const actor of [null, { ...ACTOR, user: { ...ACTOR.user, email: "outside@example.invalid" } }]) {
        const events: string[] = [];
        await assert.rejects(render(actor, {}, probes, events), redirected);
        assert.deepEqual(events, ["auth:start", "auth:done"]);
      }
      assert.equal(reads, 0); assert.equal(await snapshot!(), before);
    });
    if (!original) await suite.test("auth resolves before both port selections; incomplete scope performs zero reads", async () => {
      let reads = 0;
      const forbidden = async () => { reads++; throw new Error("PARTIAL_SCOPE_READ_FORBIDDEN"); };
      const fakeTeam: Team = { listResourceOwners: forbidden, listRoleRosters: forbidden };
      const fakeHistory: History = { readLatestDriveImportRun: forbidden, readLatestDriveImportResult: forbidden };
      for (const partial of [{}, { teamMembers: fakeTeam }, { driveImportHistory: fakeHistory }]) {
        const events: string[] = [];
        await assert.rejects(render(ACTOR, {}, partial, events), /DATA_REPOSITORY_NOT_CONFIGURED: (teamMembers|driveImportHistory)/);
        assert.deepEqual(events.slice(0, 2), ["auth:start", "auth:done"]);
        assert.ok(events.every(event => !event.startsWith("read:") && !event.startsWith("db:"))); assert.equal(reads, 0);
      }
      const gate = barrier(), events: string[] = [];
      const pending = render(ACTOR, {}, scope, events, gate.promise);
      try { assert.deepEqual(events, ["auth:start"]); } finally { gate.resolve(); }
      await pending;
      const firstRead = events.findIndex(event => event.startsWith("read:")); assert.ok(firstRead >= 0);
      for (const selected of ["select:history", "select:team"]) assert.ok(events.indexOf(selected) > events.indexOf("auth:done") && events.indexOf(selected) < firstRead, `${selected} must finish before either read`);
      assert.ok(events.includes("read:history:readLatestDriveImportRun")); assert.ok(events.includes("read:team:listResourceOwners"));
    });
    await suite.test("all 250 rows, six stored metrics, navigation and 6/4/3/error priorities", async () => {
      const before = await snapshot!();
      for (const [params, query] of [[{}, ""], [{ team: "team_1" }, "?team=team_1"], [{ team: "team_2" }, "?team=team_2"]] as const) {
        const events: string[] = [];
        assertPageMarkup(await render(ACTOR, params, scope, events), query);
        assert.ok(events.includes(native ? "db:mongo:find" : "db:pg:query"), "positive control: actual reader traffic must be observed");
        if (native) assert.ok(!events.includes("db:pg:query"));
      }
      assert.equal(await snapshot!(), before);
    });
    await suite.test("latest run with zero results remains visible instead of borrowing older rows", async () => {
      await createEmptyRun!();
      try {
        const before = await snapshot!();
        assert.deepEqual(await inScope(() => reader.readLatestDriveImportRun()), { ...expectedView(), id: EMPTY_RUN_ID, startedAt: "2031-01-03T03:04:05.000Z", results: [] });
        assertEmptyMarkup(await render(), true); assert.equal(await snapshot!(), before);
      } finally { await deleteEmptyRun!(); }
    });
    await suite.test("legacy object candidate survives reader but actual React render throws", async () => {
      const malformed = [{ field: "instructors", value: { synthetic: "LEGACY_OBJECT_CHILD" } }];
      await replaceCandidates!(malformed);
      try {
        const expected = expectedView() as unknown as { results: Array<Record<string, unknown>> };
        expected.results[0].keyCandidates = malformed;
        assert.deepEqual(await inScope(() => reader.readLatestDriveImportRun()), expected);
        const before = await snapshot!();
        await assert.rejects(render(), /Objects are not valid as a React child/);
        assert.equal(await snapshot!(), before);
      } finally { await replaceCandidates!(RESULT_SEEDS[0].keyCandidates); }
    });
    await suite.test("no stored run renders the original empty state", async () => {
      await eraseRuns!();
      const before = await snapshot!();
      assert.equal(await inScope(() => reader.readLatestDriveImportRun()), null);
      assertEmptyMarkup(await render(), false); assert.equal(await snapshot!(), before);
    });
    suite.diagnostic(`backend=${backend}; actual page/guard/reader executed; setup/cleanup owned by this worker, server lifetime by parent`);
    assert.equal(fetchCalls, 0);
    assert.ok(!JSON.stringify(logs).includes("synthetic-not-returned-"));
    if (frozen) {
      assert.deepEqual(frozen.violations, []);
      for (const path of ["src/app/drive-import-runs/page.tsx", "src/lib/auth/requireWorkspaceSession.ts", "src/lib/driveImports/driveImportResults.ts", "src/components/AppSidebar.tsx"]) assert.ok(frozen.loaded.has(path), path);
      assert.ok(frozen.seamEdges.some(edge => edge.startsWith("src/lib/auth/requireWorkspaceSession.ts -> ")));
    }
  } finally {
    try {
      if (seededPg && sqlConnected) {
        // Delete only IDs this worker seeded, including its setup/cleanup audit rows.
        await sql!.query("DELETE FROM drive_import_results WHERE id=ANY($1::uuid[])", [RESULT_SEEDS.map(row => row.id)]);
        await sql!.query("DELETE FROM drive_import_runs WHERE id=ANY($1::uuid[])", [[PAGE_RUN_ID, OLD_RUN_ID, EMPTY_RUN_ID]]);
        await sql!.query("DELETE FROM members WHERE id=ANY($1::uuid[])", [MEMBERS.map(row => row.id)]);
        await sql!.query("DELETE FROM activity_changes WHERE target_id=ANY($1::text[])", [allIds]);
        for (const table of ["drive_import_results", "drive_import_runs", "members", "activity_changes"]) assert.equal((await sql!.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
      }
    } finally {
      try { await prisma?.$disconnect(); if (sqlConnected) await sql!.end(); }
      finally {
        try { if (mongoOwned) await client!.db(databaseName).dropDatabase(); }
        finally {
          await client?.close(); frozen?.close(); hooks.deregister();
          for (const moduleMock of moduleMocks.reverse()) moduleMock.restore();
          queryObserver.mock.restore(); findObserver.mock.restore();
          fetchMock.mock.restore(); for (const logger of loggers) logger.mock.restore();
          delete authGlobal.__drivePageSyntheticAuth; delete globals.prisma;
          for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        }
      }
    }
  }
});
