/** Actual handlers with native shadow storage; no facade/route/repo mocks.
 * Auth is the only behavior module mock. PG/fetch are forbidden-call sentinels.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoSalesRevenueSyncRepository, prepareMongoSalesRevenueSyncStore, SALES_REVENUE_MODELS } from "./mongoSalesRevenueSyncRepository";
import type { SalesRevenueSource, SalesRevenueNotifier } from "./salesRevenueSyncRepository";
import type { SalesRevenueSyncResult } from "./salesRevenueSync";
import type { SalesRecord, SourceReadResult } from "../sourceReads/sourceReadTypes";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, completeMongoRow, operationMongoValidator } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { runWithDataRepositories, type DataRepositories } from "./dataRepositoryContext";

type Session = { user: { email: string; name: string }; expires: string };
type Method = "GET" | "POST";
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "sales-admin@day1company.co.kr", name: "Synthetic private sales admin" }, expires: "" };
const staff: Session = { user: { email: "sales-staff@day1company.co.kr", name: "Synthetic staff" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PG fallback"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const { GET, POST } = await import("../../app/api/admin/sales-revenue/route");
hooks.deregister();

const uri = process.env.MONGODB_SALES_REVENUE_TEST_URI;
const PARTIAL_BANNER = "세일즈맵 딜을 일부만 읽어(partial) 반영을 막았습니다. SALESMAP_MAX_PAGES를 올린 뒤 다시 시도하세요.";
const DISABLED = "세일즈맵 토큰(SALESMAP_API_TOKEN)이 설정되지 않았습니다.";
const COMPANY = "Synthetic visible sales company";
const COURSE = "Synthetic visible sales course";
const CODE = "SYNTHETIC-SALES-COURSE";
function request(method: Method, authorization?: string, body?: string) {
  return new Request("https://example.invalid/api/admin/sales-revenue", {
    method, headers: { ...(authorization === undefined ? {} : { authorization }), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(method === "POST" && body !== undefined ? { body } : {})
  });
}
async function success(response: Response, method: Method): Promise<SalesRevenueSyncResult> {
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["dryRun", "ok", "result"]);
  assert.equal(body.ok, true); assert.equal(body.dryRun, method === "GET");
  return body.result as SalesRevenueSyncResult;
}
async function fixedError(response: Response) {
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, error: "SALES_REVENUE_SYNC_FAILED" });
}

test("sales revenue actual GET/POST: native Mongo, scope, auth, notifications and audit boundaries", { skip: !uri, timeout: 300_000 }, async suite => {
  // Strict allowlist before any connection. Never accept credentials, remote seeds or existing DB names.
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/"); assert.equal(url.hash, "");
  for (const [key, value] of url.searchParams) {
    assert.ok(["replicaSet", "directConnection"].includes(key), `Unsupported test URI option: ${key}`);
    if (key === "directConnection") assert.equal(value, "true");
  }
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DEV_AUTH_BYPASS", "DATABASE_URL", "SYNC_API_SECRET", "SALES_SYNC_ALERT_EMAILS"];
  const saved = new Map(envNames.map(key => [key, process.env[key]]));
  const secret = randomBytes(24).toString("hex");
  const rawError = `SYNTHETIC-PRIVATE-ERROR-${randomBytes(16).toString("hex")} private-source@example.invalid`;
  Object.assign(process.env, {
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email,
    SYNC_API_SECRET: secret,
    // A configured synthetic target prevents an empty-env no-op from looking like isolation.
    SALES_SYNC_ALERT_EMAILS: "synthetic-alert@example.invalid"
  });
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const databaseName = `hub_om_shadow_sales_handlers_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const commands: Array<{ name: string; command: Record<string, unknown> }> = [];
  client.on("commandStarted", event => { commands.push({ name: event.commandName, command: event.command }); });
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external fetch"); });
  const consoleLines: unknown[][] = [];
  const captures = (["error", "warn", "log", "info", "debug"] as const).map(level => mock.method(console, level, (...values: unknown[]) => { consoleLines.push([level, ...values]); }));
  const responses: string[] = [], notifications: string[] = [];
  let connected = false;
  try {
    await client.connect(); connected = true;
    const options = { client, databaseName, namespace: "shadow_sales_handlers", allowShadowWrites: true as const };
    await prepareMongoSalesRevenueSyncStore(options); await prepareMongoRequestAuditStore(options);
    const repository = await MongoSalesRevenueSyncRepository.open(options);
    const requestActivity = await MongoRequestAuditRepository.open(options);
    const store = new MongoOperationStore(options, [...new Set([...SALES_REVENUE_MODELS, ...REQUEST_AUDIT_MODELS])]);
    let configured = true, sourceCalls = 0, configCalls = 0, sourceError: Error | undefined, notifierError: Error | undefined;
    let read: SourceReadResult<SalesRecord>;
    const source: SalesRevenueSource = {
      isConfigured: () => { configCalls++; return configured; },
      readSalesRecords: async () => { sourceCalls++; if (sourceError) throw sourceError; return read; }
    };
    const notifier: SalesRevenueNotifier = { notifyFailure: async text => { notifications.push(text); if (notifierError) throw notifierError; } };
    const scope = { salesRevenueSync: repository, salesRevenueSource: source, salesRevenueNotifier: notifier, requestActivity } satisfies Partial<DataRepositories>;
    const invoke = async (method: Method, authorization?: string, actor: Session | null = admin, body?: string, overrides: Partial<DataRepositories> = scope) => {
      const response = await runWithDataRepositories(overrides, () => actors.run(actor, () => (method === "GET" ? GET : POST)(request(method, authorization, body))));
      responses.push(await response.clone().text());
      assert.equal(pgCalls, 0); assert.equal(external.mock.callCount(), 0);
      return response;
    };
    const business = async () => {
      const rows: unknown[] = [];
      for (const model of SALES_REVENUE_MODELS) rows.push([model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()]);
      return rows;
    };
    const requestRow = async (response: Response) => {
      const id = response.headers.get("X-Request-Id"); assert.ok(id);
      const row = await store.one("ActivityRequest", { _id: id }); assert.ok(row); return row;
    };
    let courseId = "";
    const course = async () => { const row = await store.one("Course", { _id: courseId }); assert.ok(row); return row; };
    const revenue = async () => (await course()).revenue;
    const syncCount = () => store.collection("SalesRevenueSyncLog").countDocuments();
    const auditRows = (response: Response) => store.scan("ActivityChange", { requestId: response.headers.get("X-Request-Id")! });
    const coreCommands = (start: number, end: number) => {
      const names = ["Company", "Course", "SalesRevenueSyncLog"].map(model => store.collection(model).collectionName);
      return commands.slice(start, end).filter(({ command }) => names.some(name => Object.values(command).includes(name)));
    };
    const reset = async () => {
      // Only our randomly named synthetic database; request logs stay for whole-suite privacy checks.
      for (const model of SALES_REVENUE_MODELS) await store.collection(model).deleteMany({});
      configured = true; sourceError = undefined; notifierError = undefined;
      const now = new Date(), companyId = randomUUID(); courseId = randomUUID();
      const company = completeMongoRow("Company", { id: companyId, name: COMPANY, normalizedName: COMPANY.toLowerCase(), createdAt: now, updatedAt: now });
      const row = completeMongoRow("Course", { id: courseId, processSeq: 1, companyId, courseId: CODE, name: COURSE,
        operationType: "NEEDS_REVIEW", revenue: "10.00", revenueRaw: "10", tools: "Synthetic preserved tools", createdAt: now, updatedAt: now });
      await store.collection("Company").insertOne(encodeMongoRuntimeDocument("Company", company));
      await store.collection("Course").insertOne(encodeMongoRuntimeDocument("Course", row));
      read = { source: "sales", status: "ok", readAt: now.toISOString(), items: [{ sourceRecordId: "synthetic-sale", courseId: CODE, revenue: 125 }], issues: [] };
    };
    const scenario = async (name: string, work: () => Promise<void>) => suite.test(name, async () => {
      await reset();
      try {
        await work();
        // Inspect before the next scenario clears business rows: partial/failure logs must
        // not escape the privacy assertion just because a later fixture replaces them.
        const raw = JSON.stringify([await business(), await store.collection("ActivityRequest").find({}).toArray()]);
        for (const value of [admin.user.email, admin.user.name, rawError, secret]) assert.ok(!raw.includes(value), "Sensitive fixture leaked to raw storage");
        const outward = JSON.stringify([responses, notifications, consoleLines]);
        for (const value of [rawError, secret, admin.user.email, admin.user.name]) assert.ok(!outward.includes(value), "Sensitive fixture leaked to public error channels");
      }
      finally { assert.equal(pgCalls, 0, "No PG fallback attempts"); assert.equal(external.mock.callCount(), 0, "No fetch attempts, including failed attempts"); }
    });

    await scenario("anonymous/non-admin/external and wrong bearer are 403 before source/business", async () => {
      const before = await business(), reads = sourceCalls, checks = configCalls, notes = notifications.length;
      for (const method of ["GET", "POST"] as const) for (const actor of [null, staff, { user: { email: "outside@example.invalid", name: "Outside" }, expires: "" }]) {
        for (const authorization of [undefined, "Bearer wrong"]) {
          const response = await invoke(method, authorization, actor);
          assert.equal(response.status, 403); assert.deepEqual(await response.json(), { ok: false, error: "admin 권한이 필요합니다." });
          assert.equal((await requestRow(response)).status, 403);
        }
      }
      assert.equal(sourceCalls, reads); assert.equal(configCalls, checks); assert.equal(notifications.length, notes); assert.deepEqual(await business(), before);
    });

    await scenario("secret/admin/wrong-secret admin fallback use actual guards and request actor semantics", async () => {
      for (const method of ["GET", "POST"] as const) for (const [authorization, actor, actorType] of [[undefined, admin, "user"], [`Bearer ${secret}`, null, "token_request"], ["Bearer wrong", admin, "token_request"]] as const) {
        await reset(); const notes = notifications.length;
        const response = await invoke(method, authorization, actor), result = await success(response, method);
        assert.equal(result.applied, method === "POST"); assert.equal(result.updatedRows, method === "POST" ? 1 : 0);
        assert.equal(await revenue(), method === "POST" ? "125.00" : "10.00");
        const audit = await requestRow(response); assert.equal(audit.actorType, actorType);
        assert.equal(audit.actorEmail, actorType === "user" ? admin.user.email : null);
        if (method === "POST") {
          const logs = await store.scan("SalesRevenueSyncLog"); assert.equal(logs.length, 1);
          assert.equal(logs[0].triggeredBy, authorization === `Bearer ${secret}` ? "sync-api-secret" : admin.user.email);
        }
        assert.equal(notifications.length, notes);
      }
    });

    await scenario("GET preserves all business bytes and legitimate names; POST writes native decimal/raw and atomic audit", async () => {
      const before = await business(), n = await store.collection("ActivityRequest").countDocuments();
      const preview = await invoke("GET"), result = await success(preview, "GET");
      assert.deepEqual(result, { configured: true, readStatus: "ok", readCount: 1, matchedCourseIds: 1, filled: 0, changed: 1, unchanged: 0,
        updatedRows: 0, unmatchedCourseIds: [], multiCourseIds: [], multiDealCourseIds: [], excludedCourseIds: [], dedupedCourseIds: [], applied: false,
        changes: [{ courseId: CODE, companyName: COMPANY, courseName: COURSE, before: 10, after: 125, action: "change" }], issues: [] });
      assert.deepEqual(await business(), before); assert.equal(await store.collection("ActivityRequest").countDocuments(), n + 1);
      const applied = await invoke("POST"), after = await success(applied, "POST");
      assert.deepEqual(after, { ...result, updatedRows: 1, applied: true });
      assert.equal(await revenue(), "125.00"); assert.equal((await course()).revenueRaw, "125"); assert.equal((await course()).tools, "Synthetic preserved tools");
      const audits = await auditRows(applied); assert.equal(audits.length, 1); assert.equal(audits[0].actorEmail, admin.user.email);
      const changes = audits[0].changes as Record<string, unknown>;
      assert.deepEqual(changes.revenue, { before: 10, after: 125 }); assert.deepEqual(changes.revenue_raw, { redacted: true });
      const reapply = await invoke("POST"), repeated = await success(reapply, "POST");
      assert.equal(repeated.updatedRows, 0); assert.equal(repeated.unchanged, 1); assert.equal((await auditRows(reapply)).length, 0); assert.equal(await syncCount(), 2);
    });

    await scenario("each of four missing scopes fails before source/config checks and native core access", async () => {
      const before = await business(), reads = sourceCalls, checks = configCalls, notes = notifications.length;
      for (const method of ["GET", "POST"] as const) for (const key of ["salesRevenueSync", "salesRevenueSource", "salesRevenueNotifier", "requestActivity"] as const) {
        const partial: Partial<DataRepositories> = { ...scope }; delete partial[key];
        const start = commands.length;
        if (key === "requestActivity") {
          await assert.rejects(invoke(method, `Bearer ${secret}`, null, undefined, partial), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
        } else await fixedError(await invoke(method, `Bearer ${secret}`, null, undefined, partial));
        const end = commands.length;
        assert.deepEqual(coreCommands(start, end), []);
      }
      assert.equal(sourceCalls, reads); assert.equal(configCalls, checks); assert.equal(notifications.length, notes); assert.deepEqual(await business(), before);
    });

    await scenario("unconfigured is 400 without source reads or native core access; only cron POST notifies", async () => {
      configured = false; const before = await business(), reads = sourceCalls;
      for (const method of ["GET", "POST"] as const) for (const authorization of [undefined, `Bearer ${secret}`]) {
        const notes = notifications.length, start = commands.length;
        const response = await invoke(method, authorization); const end = commands.length;
        assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: DISABLED });
        assert.deepEqual(coreCommands(start, end), []);
        assert.equal(notifications.length - notes, method === "POST" && authorization !== undefined ? 1 : 0);
      }
      assert.equal(sourceCalls, reads); assert.deepEqual(await business(), before);
    });

    await scenario("configured reader-disabled is not unconfigured and follows original apply path", async () => {
      read.status = "disabled";
      const result = await success(await invoke("POST"), "POST");
      assert.equal(result.configured, true); assert.equal(result.readStatus, "disabled"); assert.equal(result.applied, true);
      assert.equal(result.updatedRows, 1); assert.equal(await revenue(), "125.00");
    });

    await scenario("failed stays 200/no core reads; known issue code with arbitrary raw text is sanitized", async () => {
      read.status = "failed";
      read.issues = [{ code: "salesmap_read_failed", message: rawError, recoverable: true }];
      const before = await business();
      for (const method of ["GET", "POST"] as const) for (const authorization of [undefined, `Bearer ${secret}`]) {
        const notes = notifications.length, start = commands.length;
        const response = await invoke(method, authorization); const end = commands.length;
        const result = await success(response, method);
        assert.equal(result.configured, true); assert.equal(result.readStatus, "failed"); assert.equal(result.applied, false);
        assert.equal(result.updatedRows, 0); assert.deepEqual(result.changes, []); assert.deepEqual(result.issues, ["세일즈맵 딜을 읽지 못했습니다."]);
        assert.deepEqual(coreCommands(start, end), []);
        assert.equal(notifications.length - notes, method === "POST" && authorization !== undefined ? 1 : 0);
      }
      assert.deepEqual(await business(), before);
    });

    await scenario("partial remains 200: exact banner only on POST, no revenue/audit writes, separate sync log", async () => {
      read.status = "partial";
      read.issues = [{ code: "salesmap_deal_missing_amount", message: rawError, recoverable: true }, { code: "synthetic_unknown", message: rawError, recoverable: true }];
      const before = await store.collection("Course").findOne({ _id: courseId });
      const preview = await success(await invoke("GET", `Bearer ${secret}`, null), "GET");
      assert.deepEqual(preview.issues, ["SALES_REVENUE_SOURCE_ISSUE", "SALES_REVENUE_SOURCE_ISSUE"]); assert.equal(await syncCount(), 0);
      for (const authorization of [undefined, `Bearer ${secret}`, "Bearer wrong"]) {
        const notes = notifications.length, response = await invoke("POST", authorization);
        const result = await success(response, "POST");
        assert.deepEqual(result, { ...preview, issues: [...preview.issues, PARTIAL_BANNER] });
        assert.equal((await auditRows(response)).length, 0);
        assert.equal(notifications.length - notes, authorization === `Bearer ${secret}` ? 1 : 0);
        if (authorization === `Bearer ${secret}`) assert.ok(notifications.at(-1)?.includes(PARTIAL_BANNER));
      }
      assert.equal(await syncCount(), 3); assert.deepEqual(await store.collection("Course").findOne({ _id: courseId }), before);
      const logs = await store.scan("SalesRevenueSyncLog");
      for (const log of logs) { assert.equal(log.applied, false); assert.equal(log.updatedRows, 0); assert.ok(JSON.stringify(log.detail).includes("SALES_REVENUE_SOURCE_ISSUE")); }
    });

    await scenario("valid standard source issue is preserved rather than blanket-redacted", async () => {
      const text = "금액이 없는 딜 2건을 건너뛰었습니다.";
      read.issues = [{ code: "salesmap_deal_missing_amount", message: text, recoverable: true }];
      assert.deepEqual((await success(await invoke("GET"), "GET")).issues, [text]);
    });

    await scenario("source throw is fixed 500; only failed cron POST notifies; notifier throw is best effort", async () => {
      const before = await business(); sourceError = new Error(rawError);
      for (const fails of [false, true]) {
        notifierError = fails ? new Error(rawError) : undefined;
        for (const method of ["GET", "POST"] as const) for (const authorization of [undefined, `Bearer ${secret}`, "Bearer wrong"]) {
          const notes = notifications.length;
          await fixedError(await invoke(method, authorization));
          assert.equal(notifications.length - notes, method === "POST" && authorization === `Bearer ${secret}` ? 1 : 0);
        }
      }
      assert.deepEqual(await business(), before);
    });

    await scenario("throwing notifier does not turn cron disabled400 or partial200 into 500", async () => {
      notifierError = new Error(rawError); configured = false;
      let notes = notifications.length;
      const disabled = await invoke("POST", `Bearer ${secret}`, null); assert.equal(disabled.status, 400);
      assert.equal(notifications.length, notes + 1);
      configured = true; read.status = "partial"; notes = notifications.length;
      const partial = await success(await invoke("POST", `Bearer ${secret}`, null), "POST");
      assert.equal(partial.applied, false); assert.deepEqual(partial.issues, [PARTIAL_BANNER]); assert.equal(notifications.length, notes + 1);
      assert.equal(await revenue(), "10.00");
    });

    await scenario("valid resolutions and normalized keys work; invalid modes and malformed bodies retain defaults", async () => {
      const cases: Array<[string | undefined, string, number | null]> = [
        [JSON.stringify({ multiDealResolutions: { [CODE]: "sum" } }), "sum", 300],
        [JSON.stringify({ multiDealResolutions: { [` \u200b${CODE} `]: "max" } }), "max", 200],
        [JSON.stringify({ multiDealResolutions: { [CODE]: "min" } }), "min", 100],
        [JSON.stringify({ multiDealResolutions: { [CODE]: "exclude" } }), "exclude", null],
        [JSON.stringify({ multiDealResolutions: { [CODE]: "invalid" } }), "sum", 300],
        [JSON.stringify({ multiDealResolutions: { [CODE]: 1 } }), "sum", 300],
        [JSON.stringify({ multiDealResolutions: { [CODE]: { mode: "max" } } }), "sum", 300],
        ['{"multiDealResolutions":', "sum", 300], ["null", "sum", 300],
        [JSON.stringify({ multiDealResolutions: "max" }), "sum", 300], [undefined, "sum", 300]
      ];
      for (const [body, mode, expected] of cases) {
        await reset(); read.items = [{ sourceRecordId: "synthetic-multi", courseId: CODE, revenue: 300, dealCount: 2, dealsSameAmount: false, maxAmount: 200, minAmount: 100 }];
        const result = await success(await invoke("POST", undefined, admin, body), "POST");
        assert.equal(result.multiDealCourseIds[0].mode, mode); assert.equal(result.multiDealCourseIds[0].appliedAmount, expected ?? 0);
        assert.equal(result.updatedRows, expected === null ? 0 : 1); assert.equal(result.applied, true);
        assert.deepEqual(result.excludedCourseIds, expected === null ? [CODE] : []);
        assert.equal(await revenue(), expected === null ? "10.00" : `${expected}.00`);
      }
    });

    await scenario("sync log native insert rejection keeps business and change audit; request log succeeds", async () => {
      const collection = store.collection("SalesRevenueSyncLog");
      await store.db.command({ collMod: collection.collectionName, validator: { $and: [operationMongoValidator("SalesRevenueSyncLog"), { _id: { $exists: false } }] } });
      try {
        const response = await invoke("POST"), result = await success(response, "POST");
        assert.equal(result.applied, true); assert.equal(result.updatedRows, 1); assert.equal(await revenue(), "125.00");
        assert.equal(await syncCount(), 0); assert.equal((await auditRows(response)).length, 1); assert.equal((await requestRow(response)).status, 200);
      } finally { await store.db.command({ collMod: collection.collectionName, validator: operationMongoValidator("SalesRevenueSyncLog") }); }
    });

    await scenario("request activity native insert rejection preserves HTTP/business/sync/change audit", async () => {
      const collection = store.collection("ActivityRequest"), start = consoleLines.length;
      await store.db.command({ collMod: collection.collectionName, validator: { $and: [operationMongoValidator("ActivityRequest"), { status: { $lt: 0 } }] } });
      try {
        const response = await invoke("POST"), result = await success(response, "POST");
        assert.equal(result.updatedRows, 1); assert.equal(await revenue(), "125.00"); assert.equal(await syncCount(), 1);
        assert.equal((await auditRows(response)).length, 1); assert.equal(await collection.countDocuments({ _id: response.headers.get("X-Request-Id")! }), 0);
        assert.deepEqual(consoleLines.slice(start), [["error", "[activity] API request log write failed"]]);
      } finally { await store.db.command({ collMod: collection.collectionName, validator: operationMongoValidator("ActivityRequest") }); }
    });

    await scenario("native change audit failure rolls back course, emits fixed500, skips sync log and safely notifies cron", async () => {
      const collection = store.collection("ActivityChange"), before = await business(), notes = notifications.length;
      await store.db.command({ collMod: collection.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { _id: { $exists: false } }] } });
      try {
        const response = await invoke("POST", `Bearer ${secret}`, null); await fixedError(response);
        assert.deepEqual(await business(), before); assert.equal(await syncCount(), 0); assert.equal((await requestRow(response)).status, 500);
        assert.equal(notifications.length, notes + 1); assert.ok(notifications.at(-1)?.includes("SALES_REVENUE_SYNC_FAILED"));
      } finally { await store.db.command({ collMod: collection.collectionName, validator: operationMongoValidator("ActivityChange") }); }
    });

    await scenario("raw persistence hides actor/error seeds while authorized decoded preview retains legitimate names", async () => {
      read.issues = [{ code: "salesmap_deal_missing_amount", message: rawError, recoverable: true }];
      const response = await invoke("POST"), result = await success(response, "POST");
      assert.equal(result.changes[0].companyName, COMPANY); assert.equal(result.changes[0].courseName, COURSE);
      assert.deepEqual(result.issues, ["SALES_REVENUE_SOURCE_ISSUE"]);
      const log = (await store.scan("SalesRevenueSyncLog"))[0]; assert.equal(log.triggeredBy, admin.user.email);
      const raw = JSON.stringify([await business(), await store.collection("ActivityRequest").find({}).toArray()]);
      for (const value of [admin.user.email, admin.user.name, rawError, secret]) assert.ok(!raw.includes(value), "Sensitive fixture leaked to raw storage");
      const outward = JSON.stringify([responses, notifications, consoleLines]);
      for (const value of [rawError, secret, admin.user.email, admin.user.name]) assert.ok(!outward.includes(value), "Sensitive fixture leaked to response/notification/console");
      for (const line of consoleLines) assert.deepEqual(line, ["error", "[activity] API request log write failed"], "Unexpected console output");
    });
    assert.equal(pgCalls, 0); assert.equal(external.mock.callCount(), 0);
  } finally {
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await client.close(); }
      finally {
        for (const capture of captures) capture.mock.restore(); external.mock.restore();
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    }
  }
});
