/** Health V1/V2/V4 unit and actual-route boundaries, no database connections.
 * The real context, factory, Prisma repository, getter guards and GET are used.
 * Only the cached Prisma query result and explicit health ports are synthetic.
 * Actual PG/native connections and the frozen baseline belong to other suites.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { inspect, isDeepStrictEqual } from "node:util";
import { mock, test } from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { DatabaseHealthRepository } from "./databaseHealthRepository";

const SUCCESS = { ok: true, database: "connected" };
const FAILURE = { ok: false, database: "unavailable", error: "Health check failed" };
const PRIVATE = "synthetic-health-private@example.invalid";
const URI = `mongodb://synthetic:${PRIVATE}@127.0.0.1:1/synthetic_health`;
const KEY = "synthetic-health-private-key-material";
const envNames = ["NODE_ENV", "DATABASE_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function assertNoUnexpected(values: readonly string[]) { assert.deepEqual(values, [], "HEALTH_UNEXPECTED_BACKEND_OR_EFFECT"); }

test("Health actual GET and repository unit boundaries (synthetic query/ports, no DB)", { timeout: 30_000 }, async suite => {
  const env = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const globalClient = globalThis as typeof globalThis & { prisma?: unknown };
  const previousClient = globalClient.prisma;
  const unexpected: string[] = [], logs: unknown[][] = [];
  const queries: Array<{ parts: string[]; raw: string[] | null; values: unknown[] }> = [];
  let queryFailure: { value: unknown } | undefined;
  const rejectEffect = (kind: string): never => { unexpected.push(kind); throw new Error("SYNTHETIC_HEALTH_FORBIDDEN_EFFECT"); };
  const client = new Proxy({
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      // Capture before validating: GET's catch must not hide a bad query oracle.
      const query = { parts: Array.from(parts), raw: parts.raw ? Array.from(parts.raw) : null, values };
      queries.push(query);
      if (JSON.stringify(query) !== JSON.stringify({ parts: ["SELECT 1"], raw: ["SELECT 1"], values: [] })) unexpected.push("pg-query-contract");
      if (queryFailure) throw queryFailure.value;
      return [{ synthetic_connection_result: 1 }];
    }
  }, {
    get(target, name, receiver) {
      if (name === "$queryRaw") return Reflect.get(target, name, receiver);
      return rejectEffect("unexpected-prisma-member");
    }
  });
  function configure() {
    Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/health_unit_forbidden",
      PII_ENCRYPTION_KEYS: JSON.stringify({ health: Buffer.alloc(32, 17).toString("base64") }), PII_ACTIVE_KEY_ID: "health",
      PII_INDEX_KEY: Buffer.alloc(32, 34).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
    delete process.env.MONGODB_URI;
    globalClient.prisma = client;
    queryFailure = undefined;
    queries.length = 0;
  }
  configure();
  const captures = (["log", "info", "warn", "error", "debug"] as const).map(name => mock.method(console, name, (...values: unknown[]) => { logs.push(values); }));
  const fetchTrap = mock.method(globalThis, "fetch", async () => rejectEffect("fetch"));
  // These traps replace only forbidden paths, never the selected health implementation.
  const modules = [
    mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { rejectEffect("pg-connect"); } } } }),
    mock.module("mongodb", { namedExports: { MongoClient: class { constructor() { rejectEffect("mongo-connect"); } } } }),
    mock.module("../../auth", { namedExports: { auth: () => rejectEffect("auth") } }),
    mock.module("../auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: () => rejectEffect("workspace-auth") } }),
    mock.module("../activity/request", { namedExports: { withActivity: () => rejectEffect("activity-wrapper") } })
  ];
  const hooks = registerHooks({ resolve(specifier, context, next) {
    // Resolve the actual NextResponse implementation; no fake response class.
    return next(specifier === "next/server" ? "next/server.js" : specifier, context);
  } });
  try {
    const { NextResponse } = await import("next/server.js");
    const { GET, dynamic } = await import("../../app/api/health/route");
    const { getDatabaseHealthRepository } = await import("./databaseHealthFactory");
    const { PrismaDatabaseHealthRepository } = await import("./prismaDatabaseHealthRepository");
    const { getPrismaClient } = await import("./prisma");
    const { config } = await import("../../proxy");
    async function response(response: Response, connected: boolean) {
      assert.ok(response instanceof NextResponse);
      assert.equal(response.status, connected ? 200 : 503);
      assert.deepEqual([...response.headers], [["content-type", "application/json"]]);
      const text = await response.text();
      for (const marker of [PRIVATE, URI, KEY, "pii:v1:"]) assert.ok(!text.includes(marker), "HEALTH_PRIVATE_RESPONSE");
      assert.ok(isDeepStrictEqual(JSON.parse(text), connected ? SUCCESS : FAILURE), "HEALTH_RESPONSE_BODY_MISMATCH");
      assertNoUnexpected(unexpected);
      assert.ok(logs.length === 0, "HEALTH_APPLICATION_OUTPUT");
    }
    const assertQuery = () => assert.deepEqual(queries, [{ parts: ["SELECT 1"], raw: ["SELECT 1"], values: [] }]);

    await suite.test("module imports perform no query, connection, ping, close, auth, audit or HTTP", async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(dynamic, "force-dynamic");
      assert.deepEqual(queries, []); assertNoUnexpected(unexpected); assert.ok(logs.length === 0, "HEALTH_APPLICATION_OUTPUT");
      assert.equal(globalClient.prisma, client);
    });

    await suite.test("default factory retains PG with absent, valid-looking and malformed MONGODB_URI; tagged SELECT 1 delegates once", async () => {
      for (const mongoURI of [undefined, "mongodb://127.0.0.1:1/synthetic_health", `not-a-uri:${PRIVATE}`]) {
        configure();
        if (mongoURI !== undefined) process.env.MONGODB_URI = mongoURI;
        const repository = getDatabaseHealthRepository();
        assert.ok(repository instanceof PrismaDatabaseHealthRepository);
        assert.deepEqual(queries, [], "FACTORY_MUST_BE_LAZY");
        assert.equal(await repository.check(), undefined); assertQuery();
        queries.length = 0;
        await response(await GET(), true); assertQuery();
      }
    });

    await suite.test("real getter privacy/default-access guards execute before the synthetic query, without fallback", async () => {
      configure();
      await runWithDataRepositories({}, async () => {
        assert.throws(() => getPrismaClient(), { message: "DEFAULT_DATABASE_ACCESS_BLOCKED" });
        await assert.rejects(new PrismaDatabaseHealthRepository().check(), { message: "DATABASE_HEALTH_CHECK_FAILED" });
      });
      assert.deepEqual(queries, []);
      process.env.PII_INDEX_KEY = "invalid-synthetic-key";
      await response(await GET(), false); assert.deepEqual(queries, []);
      configure(); delete process.env.DATABASE_URL;
      await response(await GET(), false); assert.deepEqual(queries, []);
      configure();
    });

    await suite.test("empty and unrelated scopes reject synchronously at factory and return fixed503 at GET, PG0", async () => {
      configure();
      const requestActivity = { async recordRequest() { rejectEffect("request-audit"); } };
      for (const scope of [{}, { requestActivity }]) {
        await runWithDataRepositories(scope, async () => {
          assert.throws(() => getDatabaseHealthRepository(), { message: "DATA_REPOSITORY_NOT_CONFIGURED: databaseHealth" });
          await response(await GET(), false);
        });
      }
      assert.deepEqual(queries, []);
    });

    await suite.test("explicit port is used without env fallback; inner empty scope does not inherit and outer restores", async () => {
      configure(); delete process.env.DATABASE_URL; process.env.MONGODB_URI = URI;
      let checks = 0;
      const repository: DatabaseHealthRepository = { async check() { checks++; } };
      await runWithDataRepositories({ databaseHealth: repository }, async () => {
        assert.equal(getDatabaseHealthRepository(), repository);
        await response(await GET(), true);
        await runWithDataRepositories({}, async () => { await response(await GET(), false); });
        assert.equal(checks, 1);
        await Promise.resolve();
        assert.equal(getDatabaseHealthRepository(), repository);
        await response(await GET(), true);
      });
      assert.equal(checks, 2); assert.deepEqual(queries, []);
      assert.ok(getDatabaseHealthRepository() instanceof PrismaDatabaseHealthRepository);
      configure();
    });

    await suite.test("concurrent A success/B failure keep their own ports across a two-party barrier", { timeout: 5000 }, async () => {
      configure();
      const both = gate(); let entered = 0;
      const observations: Array<{ name: string; own: boolean }> = [];
      const calls = { a: 0, b: 0 };
      const a: DatabaseHealthRepository = { async check() {
        calls.a++; if (++entered === 2) both.release();
        await both.promise;
        observations.push({ name: "a", own: getDatabaseHealthRepository() === a });
      } };
      const b: DatabaseHealthRepository = { async check() {
        calls.b++; if (++entered === 2) both.release();
        await both.promise;
        observations.push({ name: "b", own: getDatabaseHealthRepository() === b });
        throw new Error(PRIVATE, { cause: new Error(URI) });
      } };
      const [one, two] = await Promise.all([
        runWithDataRepositories({ databaseHealth: a }, () => GET()),
        runWithDataRepositories({ databaseHealth: b }, () => GET())
      ]);
      await response(one, true); await response(two, false);
      assert.deepEqual(calls, { a: 1, b: 1 });
      // Outside GET's catch: a swallowed scope assertion cannot make expected503 pass.
      assert.deepEqual(observations.sort((x, y) => x.name.localeCompare(y.name)), [{ name: "a", own: true }, { name: "b", own: true }]);
      assert.deepEqual(queries, []);
    });

    await suite.test("all NODE_ENV values publish exact failure for Error/non-Error/cause and never inspect hostile error properties", async () => {
      configure();
      let touched = 0;
      const hostile = {
        get message() { touched++; throw new Error(PRIVATE); },
        get cause() { touched++; throw new Error(KEY); },
        toString() { touched++; throw new Error(URI); }
      };
      const failures: unknown[] = [new Error(`${URI} ${KEY}`, { cause: new Error(PRIVATE) }), PRIVATE, { detail: PRIVATE, cause: URI },
        null, undefined, 17, hostile];
      for (const environment of ["production", "development", "test"] as const) {
        Object.assign(process.env, { NODE_ENV: environment });
        for (const value of failures) {
          let checks = 0;
          const repository: DatabaseHealthRepository = { async check() { checks++; throw value; } };
          await runWithDataRepositories({ databaseHealth: repository }, async () => { await response(await GET(), false); });
          assert.equal(checks, 1);
        }
      }
      assert.equal(touched, 0); assert.deepEqual(queries, []);
      const logText = inspect(logs, { depth: null, maxArrayLength: null, maxStringLength: null });
      for (const marker of [PRIVATE, URI, KEY]) assert.ok(!logText.includes(marker));
      configure();
    });

    await suite.test("PG query rejections are sanitized by repository and actual GET, with exactly one attempt each", async () => {
      for (const value of [new Error(PRIVATE, { cause: new Error(URI) }), { message: KEY }, undefined]) {
        configure(); queryFailure = { value };
        await assert.rejects(new PrismaDatabaseHealthRepository().check(), error => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "DATABASE_HEALTH_CHECK_FAILED");
          assert.equal(error.cause, undefined);
          return true;
        });
        assertQuery(); queries.length = 0;
        await response(await GET(), false); assertQuery();
      }
      configure();
    });

    await suite.test("public proxy and audit exclusion stay at baseline; actual health success needs no auth/audit slot", async () => {
      // Baseline 35104776c1ae4f42696d06e0e836ead29a786fb3; policy-only reuse,
      // not a claim that the Next middleware/deployment pipeline was executed.
      for (const [path, sha] of [
        ["../../proxy.ts", "73c5c6e3a1885521234ec73dfbfa8bd9473d270010b7e470b23f026dd29bade2"],
        ["../activity/route-policy.json", "2d421fc1263724832f3988a49393f3d915f2d61e303132d604bcdad83640d983"]
      ]) assert.equal(createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex"), sha);
      const policy = JSON.parse(readFileSync(new URL("../activity/route-policy.json", import.meta.url), "utf8"));
      assert.equal(policy["GET /api/health"], "excluded: 상태 검사 트래픽은 사용자 활동이 아니므로 제외");
      const matches = (pathname: string) => config.matcher.some(pattern => new RegExp(`^${pattern}$`).test(pathname));
      assert.equal(matches("/api/health"), false); assert.equal(matches("/api/operations"), true);
      let checks = 0;
      await runWithDataRepositories({ databaseHealth: { async check() { checks++; } } }, async () => { await response(await GET(), true); });
      assert.equal(checks, 1); assert.deepEqual(queries, []); assertNoUnexpected(unexpected);
    });

    await suite.test("same response and backend observers reject bad literal and swallowed forbidden-call negative controls", async () => {
      await assert.rejects(response(NextResponse.json({ ok: true, database: "wrong" }), true), { name: "AssertionError" });
      await assert.rejects(response(NextResponse.json(FAILURE, { status: 200 }), false), { name: "AssertionError" });
      const before = unexpected.length;
      await runWithDataRepositories({ databaseHealth: { async check() { rejectEffect("negative-control-wrong-backend"); } } }, async () => {
        const result = await GET();
        assert.equal(result.status, 503); assert.deepEqual(await result.json(), FAILURE);
      });
      assert.throws(() => assertNoUnexpected(unexpected), { name: "AssertionError" });
      assert.deepEqual(unexpected.slice(before), ["negative-control-wrong-backend"]);
      unexpected.splice(before); // Remove ONLY the deliberate observer event after it was rejected.
      assertNoUnexpected(unexpected); assert.deepEqual(queries, []); assert.ok(logs.length === 0, "HEALTH_APPLICATION_OUTPUT");
    });
  } finally {
    hooks.deregister(); modules.forEach(module => module.restore()); fetchTrap.mock.restore(); captures.forEach(capture => capture.mock.restore());
    if (previousClient === undefined) delete globalClient.prisma; else globalClient.prisma = previousClient;
    for (const name of envNames) { if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name]; }
  }
});
