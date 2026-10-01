import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { runSalesSyncRequest, type SalesSyncCompositionDependencies } from "./salesSyncComposition";
import { MONGO_SALES_REVENUE_SYNC_RUNTIME_MODELS, openMongoSalesRevenueSyncRuntime, prepareMongoSalesRevenueSyncRuntime } from "./mongoSalesRevenueSyncRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { MongoTeamUserRepository } from "./teamUsers/mongoTeamUserRepository";

mock.module("@/auth", { namedExports: { auth: async () => null } });
let pgCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
const slackSends: Array<[string, string]> = [];
mock.module("@/lib/slack/notifySlack", { namedExports: { sendSlackDirectMessage: async (slackId: string, text: string) => { slackSends.push([slackId, text]); return true; } } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const route = await import("../../app/api/admin/sales-revenue/route");
hooks.deregister();

const uri = process.env.MONGODB_SALES_REVENUE_RUNTIME_TEST_URI;
async function snapshot(store: MongoOperationStore) {
  const result: Record<string, unknown> = {};
  for (const item of (await store.db.listCollections({}, { nameOnly: false }).toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = store.db.collection(item.name);
    result[item.name] = { options: item.options, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return result;
}

test("sales revenue handler uses one prepared locked Mongo runtime", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const env = { DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", DEV_AUTH_BYPASS: "false", SYNC_API_SECRET: "synthetic-sales-secret",
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [], mutations = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { if (mutations.has(event.commandName)) writes.push(event); });
  const databaseName = `hub_om_shadow_sales_runtime_${randomBytes(8).toString("hex")}`, namespace = `shadow_sales_${randomBytes(6).toString("hex")}`;
  let configuredChecks = 0, reads = 0, notifications = 0, fetchCalls = 0;
  const options = { client, databaseName, namespace, allowShadowWrites: true as const,
    salesRevenueSource: {
      isConfigured() { configuredChecks++; return true; },
      async readSalesRecords() { reads++; return { source: "sales" as const, status: "ok" as const, readAt: new Date().toISOString(), items: [], issues: [] }; }
    },
    salesRevenueNotifier: { async notifyFailure() { notifications++; } }
  };
  const fetchMock = mock.method(globalThis, "fetch", async () => { fetchCalls++; throw new Error("FETCH_TRIPWIRE"); });
  try {
    await client.connect();
    const runtime = await prepareMongoSalesRevenueSyncRuntime(options);
    const store = new MongoOperationStore(options, MONGO_SALES_REVENUE_SYNC_RUNTIME_MODELS);
    const ready = await snapshot(store); writes.length = 0;
    await prepareMongoSalesRevenueSyncRuntime(options); await openMongoSalesRevenueSyncRuntime(options);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(store), ready);

    const request = () => new Request("https://example.invalid/api/admin/sales-revenue", {
      method: "POST", headers: { Authorization: "Bearer synthetic-sales-secret", "content-type": "application/json" }, body: "{}"
    });
    const response = await runtime.run(() => route.POST(request())); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.ok, true); assert.equal(body.result.applied, true); assert.equal(body.result.readCount, 0);
    assert.equal(configuredChecks, 1); assert.equal(reads, 1); assert.equal(notifications, 0); assert.equal(pgCalls, 0); assert.equal(fetchCalls, 0);
    const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId); assert.ok(await store.one("ActivityRequest", { _id: requestId }));
    const logs = await store.scan("SalesRevenueSyncLog"); assert.equal(logs.length, 1); assert.equal(logs[0].triggeredBy, "sync-api-secret");

    const compositionNamespace = `shadow_sales_composition_${randomBytes(6).toString("hex")}`;
    await prepareMongoSalesRevenueSyncRuntime({ ...options, namespace: compositionNamespace });
    const compositionStore = new MongoOperationStore({ ...options, namespace: compositionNamespace }, MONGO_SALES_REVENUE_SYNC_RUNTIME_MODELS);
    const compositionTeamUsers = await MongoTeamUserRepository.open({ ...options, namespace: compositionNamespace });
    await compositionTeamUsers.createTeamUser({ name: "Synthetic sales alert", email: "synthetic-sales-alert@example.invalid", slackId: "SYNTHETIC-SALES-ALERT", team: "AX", role: "om" });
    const compositionEnvironment = { ...env, SALES_SYNC_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: compositionNamespace,
      SALESMAP_API_KEY: "", SALESMAP_API_TOKEN: "", SALES_SYNC_ALERT_EMAILS: "synthetic-sales-alert@example.invalid" };
    const routeSaved = new Map(Object.keys(compositionEnvironment).map(name => [name, process.env[name]])); Object.assign(process.env, compositionEnvironment);
    let compositionResponse: Response;
    try { compositionResponse = await route.POST(request()); }
    finally { for (const [name, value] of routeSaved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
    assert.equal(compositionResponse.status, 400); assert.equal((await compositionResponse.json()).ok, false);
    const compositionRequestId = compositionResponse.headers.get("X-Request-Id"); assert.ok(compositionRequestId); assert.ok(await compositionStore.one("ActivityRequest", { _id: compositionRequestId }));
    assert.equal((await compositionStore.scan("SalesRevenueSyncLog")).length, 0); assert.deepEqual(slackSends.map(([id]) => id), ["SYNTHETIC-SALES-ALERT"]); assert.equal(pgCalls, 0); assert.equal(fetchCalls, 0);

    const dependencies: SalesSyncCompositionDependencies = {
      createClient() { return new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 }); },
      source: options.salesRevenueSource, notifier: options.salesRevenueNotifier,
      openRuntime: input => openMongoSalesRevenueSyncRuntime({ ...input, client: input.client as MongoClient })
    };
    const compositionPartialNamespace = `shadow_sales_composition_partial_${randomBytes(6).toString("hex")}`;
    const compositionPartial = new MongoOperationStore({ ...options, namespace: compositionPartialNamespace });
    await compositionPartial.db.createCollection(`${compositionPartialNamespace}_LegacyOnly`, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    await compositionPartial.db.collection(`${compositionPartialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const compositionPartialBefore = await snapshot(compositionPartial); let partialWorkCalls = 0;
    await assert.rejects(runSalesSyncRequest(async () => { partialWorkCalls++; return "unexpected"; }, { ...compositionEnvironment, MONGODB_SHADOW_NAMESPACE: compositionPartialNamespace }, dependencies), /SALES_SYNC_COMPOSITION_FAILED/);
    assert.equal(partialWorkCalls, 0); assert.deepEqual(await snapshot(compositionPartial), compositionPartialBefore);

    const second = await prepareMongoSalesRevenueSyncRuntime({ ...options, namespace: `shadow_sales_second_${randomBytes(6).toString("hex")}` });
    let callbacks = 0;
    assert.throws(() => runtime.run(() => second.run(() => { callbacks++; })), /CALENDAR_SCOPE_MISMATCH/);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial = { ...runtime.repositories }; delete partial[key];
      assert.throws(() => runWithDataRepositories(partial, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
    }
    assert.equal(callbacks, 0);

    const partialNamespace = `shadow_sales_partial_${randomBytes(6).toString("hex")}`;
    const partialStore = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partialStore.db.createCollection(`${partialNamespace}_LegacyOnly`, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    await partialStore.db.collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const partialBefore = await snapshot(partialStore); writes.length = 0;
    await assert.rejects(prepareMongoSalesRevenueSyncRuntime({ ...options, namespace: partialNamespace }), /MONGO_SALES_REVENUE_SYNC_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(partialStore), partialBefore);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); fetchMock.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
