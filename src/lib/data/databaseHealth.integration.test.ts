/** Parent-run only: real GET/native driver, exact disposable loopback replica, no env-file loading. */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { inspect } from "node:util";
import { Db, MongoClient, type CommandStartedEvent, type Document } from "mongodb";
import { MongoDatabaseHealthRepository } from "./mongoDatabaseHealthRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { DatabaseHealthRepository } from "./databaseHealthRepository";

const URI = "mongodb://127.0.0.1:27854/?replicaSet=health20260930";
const CODE = "DATABASE_HEALTH_CHECK_FAILED";
const CANARY = "synthetic-private-health-error";
const PRIVATE_URI = "mongodb://synthetic-user:synthetic-secret@private.invalid/health";
const OK = { ok: true, database: "connected" };
const UNAVAILABLE = { ok: false, database: "unavailable", error: "Health check failed" };
function newTrace() {
  return { calls: [] as Array<{ databaseName: string; command: Document; options: unknown }>,
    wire: [] as CommandStartedEvent[], dbSelections: [] as Array<string | undefined>, closes: 0,
    errors: [] as unknown[], logs: [] as string[], from: 0, to: 0,
    injected: undefined as { error: unknown } | undefined };
}
type Trace = ReturnType<typeof newTrace>;
const traces = new AsyncLocalStorage<Trace>();
async function captured<T>(trace: Trace, work: () => Promise<T>): Promise<T> {
  trace.from = performance.now();
  try { return await traces.run(trace, work); } finally { trace.to = performance.now(); }
}
async function response(response: Response, success: boolean) {
  assert.equal(response.status, success ? 200 : 503);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  assert.deepEqual(await response.json(), success ? OK : UNAVAILABLE);
}
function fixed(error: unknown): boolean {
  assert.ok(error instanceof Error); assert.equal(error.message, CODE); assert.equal(error.cause, undefined);
  const rendered = inspect(error, { depth: null, showHidden: true });
  assert.ok(!rendered.includes(CANARY) && !rendered.includes(PRIVATE_URI)); return true;
}
function pingOnly(trace: Trace, databaseName: string, wireCount = 1) {
  assert.deepEqual(trace.dbSelections, [databaseName]); assert.equal(trace.closes, 0);
  assert.deepEqual(trace.calls, [{ databaseName, command: { ping: 1 }, options: { timeoutMS: 5000 } }]);
  const business = trace.wire.filter(event => !["hello", "ismaster", "endSessions"].includes(event.commandName));
  assert.equal(business.length, wireCount);
  for (const event of business) {
    assert.equal(event.commandName, "ping"); assert.equal(event.databaseName, databaseName);
    assert.equal(event.command.ping, 1);
  }
}
function noIO(trace: Trace) {
  assert.deepEqual(trace.calls, []); assert.deepEqual(trace.wire, []); assert.deepEqual(trace.dbSelections, []); assert.equal(trace.closes, 0);
}

test("database health native GET: owned replica, no writes, isolated ping and real CSOT", {
  skip: process.env.HEALTH_DATABASE_TESTS !== "1", timeout: 90_000
}, async root => {
  assert.equal(process.env.HEALTH_TEST_MONGO_URI, URI, "exact owned endpoint only; no URI fallback");
  const keys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS",
    "MONGODB_URI", "MONGODB_SHADOW_DATABASE", "DATABASE_URL"];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  const encryptionKey = randomBytes(32).toString("base64"), indexKey = randomBytes(32).toString("base64");
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ healthfixture: encryptionKey }), PII_ACTIVE_KEY_ID: "healthfixture",
    PII_INDEX_KEY: indexKey, PII_ALLOW_PLAINTEXT_READS: "false", MONGODB_URI: PRIVATE_URI,
    MONGODB_SHADOW_DATABASE: "hub_om_shadow_health_env_trap", DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/health_trap" });
  const suffix = randomBytes(8).toString("hex");
  const names = [`hub_om_shadow_health_${suffix}_a`, `hub_om_shadow_health_${suffix}_b`];
  const appA = `synthetic-health-a-${suffix}`, appB = `synthetic-health-b-${suffix}`;
  const options = { directConnection: true, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, monitorCommands: true };
  const a = new MongoClient(URI, { ...options, appName: appA });
  const b = new MongoClient(URI, { ...options, appName: appB });
  const disconnected = new MongoClient(URI, { ...options, appName: `synthetic-health-disconnected-${suffix}` });
  const observer = new MongoClient(URI, { ...options, appName: `synthetic-health-observer-${suffix}`, monitorCommands: false });
  const restores: Array<() => void> = [], allTraces: Trace[] = [];
  let claimed = false, resetNeeded = false, pgCalls = 0, externalCalls = 0;
  const observed = () => { const trace = newTrace(); allTraces.push(trace); return trace; };
  const event = (value: CommandStartedEvent) => traces.getStore()?.wire.push(value);
  for (const client of [a, b, disconnected]) client.on("commandStarted", event);
  async function absent() {
    const result = await observer.db("admin").admin().listDatabases({ nameOnly: true, filter: { name: { $in: names } }, timeoutMS: 5000 });
    assert.deepEqual(result.databases, [], "ping must leave both freshly absent databases absent");
  }
  async function resetFailpoint() {
    // Disabling failCommand can wait for the 15s blockConnection invocation to leave.
    // This fixture cleanup budget is separate from the unchanged 5s product CSOT.
    const result = await observer.db("admin").command({ configureFailPoint: "failCommand", mode: "off" }, { timeoutMS: 20_000 });
    assert.equal(result.ok, 1); resetNeeded = false;
  }
  async function noPending(appName: string) {
    const deadline = performance.now() + 20_000;
    while (true) {
      const left = Math.floor(deadline - performance.now()); assert.ok(left > 0, "owned native ping still active after bounded cleanup");
      const result = await observer.db("admin").command({ currentOp: 1, active: true, "command.ping": 1,
        $or: [{ appName }, { "clientMetadata.application.name": appName }] }, { timeoutMS: Math.min(left, 2000) });
      assert.ok(Array.isArray(result.inprog)); if (!result.inprog.length) return;
      await new Promise(resolve => setTimeout(resolve, Math.min(100, left)));
    }
  }
  try {
    await observer.connect();
    const hello = await observer.db("admin").command({ hello: 1 }, { timeoutMS: 5000 });
    assert.equal(hello.setName, "health20260930"); assert.ok(hello.logicalSessionTimeoutMinutes > 0);
    assert.ok(Array.isArray(hello.hosts) && hello.hosts.length === 1); assert.match(hello.hosts[0], /^(127\.0\.0\.1|localhost):27854$/);
    const server = await observer.db("admin").command({ getCmdLineOpts: 1 }, { timeoutMS: 5000 });
    assert.equal(server.parsed?.storage?.dbPath, "/private/tmp/hub-om-health-20260930/mongo");
    const parameters = await observer.db("admin").command({ getParameter: 1, enableTestCommands: 1 }, { timeoutMS: 5000 });
    assert.ok(parameters.enableTestCommands === true || parameters.enableTestCommands === 1);
    await absent(); claimed = true;
    console.info(`[health-native] freshly absent owned names: ${names.join(", ")}`);
    await Promise.all([a.connect(), b.connect(), disconnected.connect()]);
    await disconnected.close(); // actual closed client; never substitute a mocked connection error

    const pg = mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
      constructor() { pgCalls++; throw new Error("SYNTHETIC_HEALTH_PG_TRIPWIRE"); }
    } } }); restores.push(() => pg.restore());
    const fetch = mock.method(globalThis, "fetch", async () => { externalCalls++; throw new Error("SYNTHETIC_HEALTH_EXTERNAL_TRIPWIRE"); });
    restores.push(() => fetch.mock.restore());
    for (const level of ["error", "warn", "log", "info", "debug"] as const) {
      const original = console[level];
      const hook = mock.method(console, level, (...args: unknown[]) => {
        const trace = traces.getStore(); if (trace) trace.logs.push(inspect(args, { depth: null, showHidden: true })); else original.apply(console, args);
      }); restores.push(() => hook.mock.restore());
    }
    const db = MongoClient.prototype.db;
    const dbHook = mock.method(MongoClient.prototype, "db", function(this: MongoClient, ...args: Parameters<MongoClient["db"]>) {
      traces.getStore()?.dbSelections.push(args[0]); return db.apply(this, args);
    }); restores.push(() => dbHook.mock.restore());
    const close = MongoClient.prototype.close;
    const closeHook = mock.method(MongoClient.prototype, "close", function(this: MongoClient, ...args: Parameters<MongoClient["close"]>) {
      const trace = traces.getStore(); if (trace) trace.closes++; return close.apply(this, args);
    }); restores.push(() => closeHook.mock.restore());
    const command = Db.prototype.command;
    const commandHook = mock.method(Db.prototype, "command", async function(this: Db, ...args: Parameters<Db["command"]>) {
      const trace = traces.getStore();
      if (trace) trace.calls.push({ databaseName: this.databaseName, command: { ...args[0] }, options: args[1] ? { ...args[1] } : undefined });
      try {
        if (trace?.injected) throw trace.injected.error; // explicitly synthetic lane, separately asserted from native failures
        return await command.apply(this, args);
      } catch (error) { trace?.errors.push(error); throw error; }
    }); restores.push(() => commandHook.mock.restore());
    const resolver = registerHooks({ resolve(specifier, context, next) {
      return next(specifier === "next/server" ? "next/server.js" : specifier, context);
    } });
    let route: typeof import("../../app/api/health/route");
    const importTrace = observed();
    try { route = await captured(importTrace, () => import("../../app/api/health/route")); }
    finally { resolver.deregister(); }
    noIO(importTrace); assert.equal(route.dynamic, "force-dynamic");
    const GET = route.GET, repoA = new MongoDatabaseHealthRepository(a, names[0]), repoB = new MongoDatabaseHealthRepository(b, names[1]);
    const get = (repo: DatabaseHealthRepository, trace: Trace) => captured(trace, () => runWithDataRepositories({ databaseHealth: repo }, GET));

    await root.test("negative controls reject wrong response and unexpected business command", async () => {
      await assert.rejects(response(Response.json({ ok: true, database: "wrong" }), true));
      const wrong = newTrace(); wrong.dbSelections.push(names[0]);
      wrong.calls.push({ databaseName: names[0], command: { find: "private_model" }, options: { timeoutMS: 5000 } });
      assert.throws(() => pingOnly(wrong, names[0], 0));
    });
    await root.test("actual GET pings uncreated DB, no DDL/business reads and borrowed client remains alive", async () => {
      const trace = observed(); await response(await get(repoA, trace), true); pingOnly(trace, names[0]);
      await absent(); assert.equal((await a.db(names[0]).command({ ping: 1 }, { timeoutMS: 5000 })).ok, 1);
    });
    await root.test("invalid names reject before client.db; explicit name never falls back to valid env name", async () => {
      for (const name of ["production", "admin", "config", "local", "hub_om_shadow_", "hub_om_shadow_a.$", "", undefined]) {
        const trace = observed();
        await assert.rejects(captured(trace, async () => new MongoDatabaseHealthRepository(a, name as string)), fixed);
        noIO(trace);
        const routeTrace = observed();
        await response(await get({ check: async () => new MongoDatabaseHealthRepository(a, name as string).check() }, routeTrace), false);
        noIO(routeTrace);
      }
    });
    await root.test("invalid key formats fail before IO; well-formed different key still passes connection health", async () => {
      for (const [key, value] of [["PII_ENCRYPTION_KEYS", "{"], ["PII_ACTIVE_KEY_ID", ""], ["PII_INDEX_KEY", "invalid-key"]]) {
        const before = process.env[key]; process.env[key] = value;
        try {
          const direct = observed(); await assert.rejects(captured(direct, () => repoA.check()), fixed); noIO(direct);
          const trace = observed(); await response(await get(repoA, trace), false); noIO(trace);
        } finally { if (before === undefined) delete process.env[key]; else process.env[key] = before; }
      }
      const before = process.env.PII_ENCRYPTION_KEYS;
      try {
        process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ healthfixture: randomBytes(32).toString("base64") });
        const trace = observed(); await response(await get(repoA, trace), true); pingOnly(trace, names[0]);
      } finally { if (before === undefined) delete process.env.PII_ENCRYPTION_KEYS; else process.env.PII_ENCRYPTION_KEYS = before; }
    });
    await root.test("explicit missing/nested scope does not fall back to PG or inherit outer health", async () => {
      const missing = observed(); await response(await captured(missing, () => runWithDataRepositories({}, GET)), false); noIO(missing);
      const nested = observed();
      await runWithDataRepositories({ databaseHealth: repoA }, async () => {
        await response(await captured(nested, () => runWithDataRepositories({}, GET)), false); noIO(nested);
        const restored = observed(); await response(await captured(restored, GET), true); pingOnly(restored, names[0]);
      });
    });
    await root.test("actual disconnected client failure is separate from timeout/injected faults", async () => {
      const repo = new MongoDatabaseHealthRepository(disconnected, names[0]);
      const trace = observed(); await response(await get(repo, trace), false); pingOnly(trace, names[0], 0);
      assert.equal(trace.errors.length, 1); assert.ok(trace.errors[0] instanceof Error); assert.equal(trace.errors[0].name, "MongoNotConnectedError");
      const direct = observed(); await assert.rejects(captured(direct, () => repo.check()), fixed); pingOnly(direct, names[0], 0);
      assert.equal((await a.db(names[0]).command({ ping: 1 }, { timeoutMS: 5000 })).ok, 1);
    });
    await root.test("explicit injected Error/non-Error/cause: fixed repository/GET failures and no application logging", async () => {
      for (const error of [new Error(`${CANARY} ${PRIVATE_URI}`, { cause: new Error(encryptionKey) }), { privateMarker: CANARY, uri: PRIVATE_URI }, PRIVATE_URI]) {
        const direct = observed(); direct.injected = { error };
        await assert.rejects(captured(direct, () => repoA.check()), fixed); pingOnly(direct, names[0], 0);
        const trace = observed(); trace.injected = { error };
        await response(await get(repoA, trace), false); pingOnly(trace, names[0], 0);
      }
      assert.equal((await a.db(names[0]).command({ ping: 1 }, { timeoutMS: 5000 })).ok, 1);
    });
    await root.test("actual 5s CSOT: app-targeted server delay, concurrent B unaffected, reset and both recover", async () => {
      const ta = observed(), tb = observed(); let pending: Promise<Response> | undefined, settled = false;
      try {
        resetNeeded = true; // reset also after an ambiguous configure ACK
        const enabled = await observer.db("admin").command({ configureFailPoint: "failCommand", mode: { times: 1 },
          data: { failCommands: ["ping"], appName: appA, blockConnection: true, blockTimeMS: 15_000 } }, { timeoutMS: 5000 });
        assert.equal(enabled.ok, 1); assert.equal(typeof enabled.count, "number");
        pending = get(repoA, ta).finally(() => { settled = true; });
        // Actual server entry, not merely seeing a commandStarted event before a local timer.
        const entered = await observer.db("admin").command({ waitForFailPoint: "failCommand", timesEntered: enabled.count + 1,
          maxTimeMS: 2500 }, { timeoutMS: 3000 });
        assert.equal(entered.ok, 1); assert.equal(settled, false);
        await response(await get(repoB, tb), true); pingOnly(tb, names[1]);
        assert.equal(settled, false, "B must finish while A's server-blocked ping is still pending");
        await response(await pending, false); pingOnly(ta, names[0]);
        const elapsed = ta.to - ta.from;
        // From entering actual GET until response: 5s CSOT with 0.5s lower and 5s scheduler margin.
        assert.ok(elapsed >= 4500 && elapsed <= 10_000, `native GET timeout elapsed ${elapsed}ms`);
        assert.equal(ta.errors.length, 1);
        const raw = ta.errors[0] as { name?: string; code?: number };
        assert.ok(raw.name === "MongoOperationTimeoutError" || raw.code === 50, "must be native timeout, not an arbitrary MongoServerError");
        console.info(`[health-native] GET timeout assertions passed before cleanup: elapsed=${Math.round(elapsed)}ms; concurrent B=200`);
      } finally {
        try { if (resetNeeded) await resetFailpoint(); }
        finally { if (pending) await pending; await noPending(appA); }
      }
      // A driver timeout alone does not prove server cancellation; noPending above observes eventual absence separately.
      const recoveredA = observed(), recoveredB = observed();
      const recovered = await Promise.all([get(repoA, recoveredA), get(repoB, recoveredB)]);
      await response(recovered[0], true); await response(recovered[1], true);
      pingOnly(recoveredA, names[0]); pingOnly(recoveredB, names[1]); await absent();
    });
    assert.equal(pgCalls, 0); assert.equal(externalCalls, 0);
    for (const trace of allTraces) {
      const output = trace.logs.join("\n");
      for (const secret of [CANARY, PRIVATE_URI, encryptionKey, indexKey]) assert.ok(!output.includes(secret), "application logged private error material");
      assert.equal(trace.closes, 0);
    }
  } finally {
    try {
      if (resetNeeded) await resetFailpoint();
      if (claimed) {
        await noPending(appA); await noPending(appB);
        try { await absent(); }
        catch (error) {
          // Only freshly absent random owned names may be cleaned if a regression unexpectedly created them.
          for (const name of names) await observer.db(name).dropDatabase({ timeoutMS: 10_000 });
          await absent(); throw error;
        }
        console.info(`[health-native] owned names remain absent; ping operations=0: ${names.join(", ")}`);
      }
    } finally {
      try {
        const closed = await Promise.allSettled([a.close(), b.close(), disconnected.close(), observer.close()]);
        for (const result of closed) if (result.status === "rejected") throw result.reason;
      } finally {
        for (const restore of restores.reverse()) restore();
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    }
  }
});
