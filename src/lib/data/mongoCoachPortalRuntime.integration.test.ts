/** Opt-in actual Mongo validation for the token-authenticated coach portal runtime. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { BSON, MongoClient, type CommandStartedEvent, type Db } from "mongodb";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MONGO_COACH_PORTAL_RUNTIME_MODELS, openMongoCoachPortalRuntime, prepareMongoCoachPortalRuntime } from "./mongoCoachPortalRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

mock.module("@/auth", { namedExports: { auth: async () => null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL access"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const me = await import("../../app/api/coach/me/route");
const schedule = await import("../../app/api/coach/schedule/[yearMonth]/route");
hooks.deregister();
const uri = process.env.MONGODB_COACH_PORTAL_RUNTIME_URI;
const request = (path: string, method = "GET", token?: string, body?: unknown) => new Request(`https://example.invalid${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

test("coach portal runtime composes token profile, schedule writes and request audit", { skip: !uri, timeout: 180_000 }, async () => {
  const parsed = new URL(uri!); assert.equal(parsed.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)); assert.ok(parsed.port); assert.equal(parsed.username, ""); assert.equal(parsed.password, "");
  const envNames = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL", "DEV_AUTH_BYPASS"] as const;
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "coach-portal-runtime"; process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ "coach-portal-runtime": randomBytes(32).toString("base64") }); process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false"; delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const databaseName = `hub_om_shadow_coach_portal_${randomBytes(8).toString("hex")}`, namespace = "shadow_coach_portal";
  const client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const writes: CommandStartedEvent[] = [], mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { const output = event.commandName === "aggregate" && Array.isArray(event.command.pipeline) && event.command.pipeline.some((stage: unknown) => stage && typeof stage === "object" && (Object.hasOwn(stage, "$out") || Object.hasOwn(stage, "$merge"))); if (mutating.has(event.commandName) || output) writes.push(event); });
  const realClose = client.close.bind(client); let closeCalls = 0, connected = false, ownsDatabase = false;
  Object.defineProperty(client, "close", { configurable: true, value: async (...args: Parameters<MongoClient["close"]>) => { closeCalls++; return realClose(...args); } });
  const options = { client, databaseName, namespace, allowShadowWrites: true as const };
  const names = (value: string) => new Set([...MONGO_COACH_PORTAL_RUNTIME_MODELS.map(model => `${value}_${model}`), `${value}_CoachSchedulingGuard`]);
  const snapshot = async (value: string) => BSON.EJSON.stringify(await Promise.all((await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).filter(info => names(value).has(info.name)).sort((a,b) => a.name.localeCompare(b.name)).map(async info => ({ info, indexes: await client.db(databaseName).collection(info.name).listIndexes().toArray(), documents: await client.db(databaseName).collection(info.name).find({}).sort({ _id: 1 }).toArray() }))), { relaxed: false });
  try {
    await client.connect(); connected = true; assert.equal((await client.db("admin").admin().listDatabases({ nameOnly: true })).databases.some(row => row.name === databaseName), false); ownsDatabase = true;
    const second = await prepareMongoCoachPortalRuntime({ ...options, namespace: "shadow_peer_coach_portal" });
    const runtime = await prepareMongoCoachPortalRuntime(options), store = new MongoOperationStore(options, MONGO_COACH_PORTAL_RUNTIME_MODELS);
    const ready = await snapshot(namespace); writes.length = 0; await prepareMongoCoachPortalRuntime(options); await openMongoCoachPortalRuntime(options); assert.deepEqual(writes.map(row => row.commandName), []); assert.equal(await snapshot(namespace), ready);
    let nested = 0; writes.length = 0;
    assert.throws(() => runtime.run(() => second.run(() => { nested++; })), /CALENDAR_SCOPE_MISMATCH/); assert.equal(nested, 0); assert.deepEqual(writes.map(row => row.commandName), []);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) { const partial: Partial<typeof runtime.repositories> = { ...runtime.repositories }; delete partial[key]; let called = 0; writes.length = 0; assert.throws(() => runWithDataRepositories(partial, () => { called++; }), /CALENDAR_SCOPE_MISMATCH/); assert.equal(called, 0); assert.deepEqual(writes.map(row => row.commandName), []); }
    const failedNamespace = "shadow_coach_portal_failed", originalDb = client.db.bind(client); let interrupted = false;
    Object.defineProperty(client, "db", { configurable: true, value: (name?: string, settings?: Parameters<MongoClient["db"]>[1]) => { const db = originalDb(name, settings), create = db.createCollection.bind(db); Object.defineProperty(db, "createCollection", { configurable: true, value: async (...args: Parameters<Db["createCollection"]>) => { if (args[0] === `${failedNamespace}_CoachFieldMaster`) { interrupted = true; throw new Error("synthetic coach portal prepare interruption"); } return create(...args); } }); return db; } });
    try { await assert.rejects(prepareMongoCoachPortalRuntime({ ...options, namespace: failedNamespace }), /^Error: MONGO_COACH_PORTAL_RUNTIME_FAILED$/); } finally { Object.defineProperty(client, "db", { configurable: true, value: originalDb }); }
    assert.equal(interrupted, true); const failed = await snapshot(failedNamespace); writes.length = 0; await assert.rejects(prepareMongoCoachPortalRuntime({ ...options, namespace: failedNamespace }), /^Error: MONGO_COACH_PORTAL_RUNTIME_FAILED$/); assert.deepEqual(writes.map(row => row.commandName), []); assert.equal(await snapshot(failedNamespace), failed); assert.equal(closeCalls, 0);
    const coach = coachFixtureRow("Coach", { name: "Synthetic private portal coach", normalizedName: "synthetic private portal coach", sourceCoachId: "synthetic:portal", status: "ACTIVE", isActive: true, accessToken: "synthetic-portal-token" });
    await store.collection("Coach").insertOne(encodeMongoRuntimeDocument("Coach", coach));
    const context = { params: Promise.resolve({ yearMonth: "2026-10" }) };
    const responses: Response[] = [];
    responses.push(await runtime.run(() => me.GET(request("/api/coach/me", "GET", "synthetic-portal-token")))); assert.equal(responses.at(-1)!.status, 200); assert.equal(responses.at(-1)!.headers.get("cache-control"), "private, no-store");
    responses.push(await runtime.run(() => schedule.GET(request("/api/coach/schedule/2026-10", "GET", "synthetic-portal-token"), context))); assert.equal(responses.at(-1)!.status, 200);
    responses.push(await runtime.run(() => schedule.PUT(request("/api/coach/schedule/2026-10", "PUT", "synthetic-portal-token", { schedules: [{ date: "2026-10-07", startTime: "09:00", endTime: "12:00" }] }), context))); assert.deepEqual(await responses.at(-1)!.clone().json(), { ok: true, count: 1 });
    const month = await runtime.run(() => schedule.GET(request("/api/coach/schedule/2026-10", "GET", "synthetic-portal-token"), context)); responses.push(month); assert.equal((await month.clone().json() as { schedules: unknown[] }).schedules.length, 1);
    const denied = await runtime.run(() => schedule.GET(request("/api/coach/schedule/2026-10"), context)); responses.push(denied); assert.equal(denied.status, 401);
    for (const response of responses) { const id = response.headers.get("X-Request-Id"); assert.ok(id); const row = await store.one("ActivityRequest", { _id: id }); assert.equal(row?.status, response.status); assert.equal(row?.actorType, "token_request"); assert.equal(row?.actorEmail, null); }
    assert.equal((await store.scan("CoachSchedule")).length, 1); assert.ok((await store.scan("ActivityChange")).length >= 1);
    const raw = JSON.stringify(await Promise.all(MONGO_COACH_PORTAL_RUNTIME_MODELS.map(model => store.collection(model).find({}).toArray()))); for (const marker of ["Synthetic private portal coach", "synthetic-portal-token", "synthetic:portal"]) assert.ok(!raw.includes(marker));
    assert.equal(pgCalls, 0); assert.equal(closeCalls, 0); await client.db("admin").command({ ping: 1 });
  } finally { try { if (connected && ownsDatabase) await client.db(databaseName).dropDatabase(); } finally { try { if (connected) await realClose(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } } }
});
