import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { runCoachSyncRequest, type CoachSyncCompositionDependencies } from "./coachSyncComposition";
import { MONGO_COACH_SYNC_RUNTIME_MODELS, openMongoCoachSyncRuntime, prepareMongoCoachSyncRuntime } from "./mongoCoachSyncRuntime";
import { MongoOperationStore } from "./mongoOperationStore";

mock.module("@/auth", { namedExports: { auth: async () => null } });
let pgCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const allRoute = await import("../../app/api/sync/all/route");
hooks.deregister();

const uri = process.env.MONGODB_COACH_SYNC_RUNTIME_TEST_URI;
async function snapshot(store: MongoOperationStore) {
  const result: Record<string, unknown> = {};
  for (const item of (await store.db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = store.db.collection(item.name);
    result[item.name] = { definition: item, indexes: (await collection.indexes()).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")), documents: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return result;
}

test("all-sync handler uses one prepared and locked Mongo runtime", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const env = { AUTH_SECRET: randomBytes(32).toString("base64"), DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden",
    DEV_AUTH_BYPASS: "false", ADMIN_EMAILS: "synthetic.sync.admin@day1company.co.kr", SYNC_API_SECRET: "synthetic-sync-secret",
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [], mutations = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "findAndModify", "bulkWrite"]);
  client.on("commandStarted", event => { if (mutations.has(event.commandName)) writes.push(event); });
  const databaseName = `hub_om_shadow_sync_runtime_${randomBytes(8).toString("hex")}`, namespace = `shadow_sync_runtime_${randomBytes(6).toString("hex")}`;
  let notionReads = 0, contractReads = 0, samsungReads = 0, fetchCalls = 0;
  const options = { client, databaseName, namespace, allowShadowWrites: true as const,
    coachNotionSource: { async readPages() { notionReads++; return []; } },
    coachSheetSource: {
      async readContract() { contractReads++; return { values: [["header"]], struckCells: new Set<string>() }; },
      async readSamsung() { samsungReads++; return { rows: [["header"]], contractRows: [] }; }
    } };
  let fetchMock = mock.method(globalThis, "fetch", async () => { fetchCalls++; throw new Error("EXTERNAL_FETCH_TRIPWIRE"); });
  try {
    await client.connect();
    const runtime = await prepareMongoCoachSyncRuntime(options), store = new MongoOperationStore(options, MONGO_COACH_SYNC_RUNTIME_MODELS);
    const ready = await snapshot(store); writes.length = 0;
    await prepareMongoCoachSyncRuntime(options); await openMongoCoachSyncRuntime(options);
    assert.deepEqual(writes.map(item => item.commandName), []); assert.deepEqual(await snapshot(store), ready);
    const second = await prepareMongoCoachSyncRuntime({ ...options, namespace: `shadow_sync_second_${randomBytes(6).toString("hex")}` });
    let callbacks = 0;
    assert.throws(() => runtime.run(() => second.run(() => { callbacks++; })), /CALENDAR_SCOPE_MISMATCH/);

    const request = new Request("https://example.invalid/api/sync/all", { method: "POST", headers: { Authorization: "Bearer synthetic-sync-secret" } });
    const response = await runtime.run(() => allRoute.POST(request)); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.ok, true); assert.deepEqual(body.result, { totalRows: 0, created: 0, updated: 0, skipped: 0, errors: 0, errorDetail: [] });
    assert.deepEqual([notionReads, contractReads, samsungReads], [1, 1, 1]);
    assert.equal(await store.collection("CoachSyncLog").countDocuments({ type: "all", status: "completed" }), 1);
    const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
    const audit = await store.one("ActivityRequest", { _id: requestId }); assert.equal(audit?.route, "/api/sync/all"); assert.equal(audit?.actorType, "token_request");
    assert.equal(pgCalls, 0); assert.equal(fetchCalls, 0);

    const compositionNamespace = `shadow_sync_composition_${randomBytes(6).toString("hex")}`;
    await prepareMongoCoachSyncRuntime({ ...options, namespace: compositionNamespace });
    const compositionStore = new MongoOperationStore({ ...options, namespace: compositionNamespace }, MONGO_COACH_SYNC_RUNTIME_MODELS);
    const compositionReady = await snapshot(compositionStore), compositionWrites: string[] = [];
    const dependencies: CoachSyncCompositionDependencies = {
      createClient() {
        const value = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
        value.on("commandStarted", event => { if (mutations.has(event.commandName)) compositionWrites.push(event.commandName); });
        return value;
      },
      notionSource: options.coachNotionSource,
      sheetSource: options.coachSheetSource,
      openRuntime: input => openMongoCoachSyncRuntime({ ...input, client: input.client as MongoClient })
    };
    const compositionEnvironment = { ...env, COACH_SYNC_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: compositionNamespace };
    assert.equal(await runCoachSyncRequest(async () => "ready", compositionEnvironment, dependencies), "ready");
    assert.equal(compositionWrites.length, 0); assert.deepEqual(await snapshot(compositionStore), compositionReady);
    compositionWrites.length = 0;
    fetchMock.mock.restore(); fetchCalls = 0;
    const sourceUrls: string[] = [];
    fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input); sourceUrls.push(url); fetchCalls++;
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "synthetic-google-token", expires_in: 3600 });
      if (url.startsWith("https://sheets.googleapis.com/")) return Response.json({ values: [["header"]] });
      if (url.startsWith("https://api.notion.com/")) return Response.json({ results: [], has_more: false, next_cursor: null });
      throw new Error("EXTERNAL_FETCH_TRIPWIRE");
    });
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const routeEnvironment = { ...compositionEnvironment, COACH_NOTION_DATABASE_ID: "synthetic-notion-database", NOTION_TOKEN: "synthetic-notion-token", COACH_CONTRACT_SHEET_ID: "synthetic-contract-sheet", GOOGLE_SERVICE_ACCOUNT_EMAIL: "synthetic-sync@invalid.example", GOOGLE_PRIVATE_KEY: privateKey };
    const routeSaved = new Map(Object.keys(routeEnvironment).map(name => [name, process.env[name]])); Object.assign(process.env, routeEnvironment);
    let compositionResponse: Response;
    try {
      compositionResponse = await allRoute.POST(new Request("https://example.invalid/api/sync/all", { method: "POST", headers: { Authorization: "Bearer synthetic-sync-secret" } }));
    } finally {
      for (const [name, value] of routeSaved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
    assert.equal(compositionResponse.status, 200); assert.equal((await compositionResponse.json()).ok, true);
    assert.deepEqual([notionReads, contractReads, samsungReads], [1, 1, 1]);
    assert.equal(sourceUrls.filter(url => url.startsWith("https://api.notion.com/")).length, 1);
    assert.equal(sourceUrls.filter(url => url.startsWith("https://sheets.googleapis.com/")).length, 3);
    assert.equal(sourceUrls.every(url => url.startsWith("https://api.notion.com/") || url.startsWith("https://oauth2.googleapis.com/") || url.startsWith("https://sheets.googleapis.com/")), true);
    assert.equal(await compositionStore.collection("CoachSyncLog").countDocuments({ type: "all", status: "completed" }), 1);
    const compositionRequestId = compositionResponse.headers.get("X-Request-Id"); assert.ok(compositionRequestId);
    assert.equal((await compositionStore.one("ActivityRequest", { _id: compositionRequestId }))?.actorType, "token_request");
    assert.equal(pgCalls, 0); assert.equal(fetchCalls, sourceUrls.length); assert.ok(fetchCalls >= 4);

    const compositionPartialNamespace = `shadow_sync_composition_partial_${randomBytes(6).toString("hex")}`;
    const compositionPartial = new MongoOperationStore({ ...options, namespace: compositionPartialNamespace });
    await compositionPartial.db.createCollection(`${compositionPartialNamespace}_LegacyOnly`);
    await compositionPartial.db.collection(`${compositionPartialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const compositionPartialBefore = await snapshot(compositionPartial); compositionWrites.length = 0;
    let partialWorkCalls = 0;
    await assert.rejects(runCoachSyncRequest(async () => { partialWorkCalls++; return "unexpected"; }, { ...compositionEnvironment, MONGODB_SHADOW_NAMESPACE: compositionPartialNamespace }, dependencies), /COACH_SYNC_COMPOSITION_FAILED/);
    assert.equal(partialWorkCalls, 0);
    assert.equal(compositionWrites.length, 0); assert.deepEqual(await snapshot(compositionPartial), compositionPartialBefore);

    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial = { ...runtime.repositories }; delete partial[key];
      assert.throws(() => runWithDataRepositories(partial, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
    }
    assert.equal(callbacks, 0);

    const partialNamespace = `shadow_sync_partial_${randomBytes(6).toString("hex")}`, partialStore = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partialStore.db.createCollection(`${partialNamespace}_LegacyOnly`); await partialStore.db.collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const partialBefore = await snapshot(partialStore); writes.length = 0;
    await assert.rejects(prepareMongoCoachSyncRuntime({ ...options, namespace: partialNamespace }), /MONGO_COACH_SYNC_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(item => item.commandName), []); assert.deepEqual(await snapshot(partialStore), partialBefore);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); fetchMock.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
