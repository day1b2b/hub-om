/** Opt-in actual Mongo validation for admin maintenance APIs composed in one runtime. */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { BSON, MongoClient, type CommandStartedEvent, type Db } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS, openMongoAdminMaintenanceRuntime, prepareMongoAdminMaintenanceRuntime } from "./mongoAdminMaintenanceRuntime";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "maintenance-admin@day1company.co.kr", name: "Synthetic maintenance admin" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL access"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const lookup = await import("../../app/api/admin/courses/lookup/route");
const course = await import("../../app/api/admin/courses/[courseId]/route");
const deleted = await import("../../app/api/admin/deleted-operations/route");
const onsite = await import("../../app/api/admin/onsite-required-backfill/route");
const om = await import("../../app/api/admin/om-assignment-status-backfill/route");
hooks.deregister();
const uri = process.env.MONGODB_ADMIN_MAINTENANCE_RUNTIME_URI;
const request = (url: string, method = "GET", body?: unknown) => new Request(`https://example.invalid${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });

test("admin maintenance runtime composes course, restore, backfill and request audit APIs", { skip: !uri, timeout: 180_000 }, async () => {
  const parsed = new URL(uri!); assert.equal(parsed.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)); assert.ok(parsed.port); assert.equal(parsed.username, ""); assert.equal(parsed.password, "");
  const envNames = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DATABASE_URL", "DEV_AUTH_BYPASS"] as const;
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "maintenance-runtime"; process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ "maintenance-runtime": randomBytes(32).toString("base64") }); process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false"; process.env.ADMIN_EMAILS = admin.user.email; delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const databaseName = `hub_om_shadow_maintenance_${randomBytes(8).toString("hex")}`, namespace = "shadow_maintenance";
  const client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const writes: CommandStartedEvent[] = [], mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { const output = event.commandName === "aggregate" && Array.isArray(event.command.pipeline) && event.command.pipeline.some((stage: unknown) => stage && typeof stage === "object" && (Object.hasOwn(stage, "$out") || Object.hasOwn(stage, "$merge"))); if (mutating.has(event.commandName) || output) writes.push(event); });
  const realClose = client.close.bind(client); let closeCalls = 0, connected = false, ownsDatabase = false;
  Object.defineProperty(client, "close", { configurable: true, value: async (...args: Parameters<MongoClient["close"]>) => { closeCalls++; return realClose(...args); } });
  const options = { client, databaseName, namespace, allowShadowWrites: true as const };
  const names = (value: string) => new Set([...MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS.map(model => `${value}_${model}`), `${value}_CoachSchedulingGuard`]);
  async function snapshot(value: string) { const infos = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).filter(info => names(value).has(info.name)).sort((a,b) => a.name.localeCompare(b.name)); return BSON.EJSON.stringify(await Promise.all(infos.map(async info => ({ info, indexes: await client.db(databaseName).collection(info.name).listIndexes().toArray(), documents: await client.db(databaseName).collection(info.name).find({}).sort({ _id: 1 }).toArray() }))), { relaxed: false }); }
  try {
    await client.connect(); connected = true; const databases = await client.db("admin").admin().listDatabases({ nameOnly: true }); assert.equal(databases.databases.some(row => row.name === databaseName), false); ownsDatabase = true;
    const second = await prepareMongoAdminMaintenanceRuntime({ ...options, namespace: "shadow_peer_maintenance" });
    const runtime = await prepareMongoAdminMaintenanceRuntime(options), store = new MongoOperationStore(options, MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS);
    const ready = await snapshot(namespace); writes.length = 0; await prepareMongoAdminMaintenanceRuntime(options); await openMongoAdminMaintenanceRuntime(options); assert.deepEqual(writes.map(row => row.commandName), []); assert.equal(await snapshot(namespace), ready);
    let nested = 0; assert.throws(() => runtime.run(() => second.run(() => { nested++; })), /CALENDAR_SCOPE_MISMATCH/); assert.equal(nested, 0);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) { const partial: Partial<typeof runtime.repositories> = { ...runtime.repositories }; delete partial[key]; assert.throws(() => runWithDataRepositories(partial, () => {}), /CALENDAR_SCOPE_MISMATCH/); }
    const failedNamespace = "shadow_maintenance_failed", originalDb = client.db.bind(client); let interrupted = false;
    Object.defineProperty(client, "db", { configurable: true, value: (name?: string, settings?: Parameters<MongoClient["db"]>[1]) => { const db = originalDb(name, settings), create = db.createCollection.bind(db); Object.defineProperty(db, "createCollection", { configurable: true, value: async (...args: Parameters<Db["createCollection"]>) => { if (args[0] === `${failedNamespace}_Course`) { interrupted = true; throw new Error("synthetic maintenance prepare interruption"); } return create(...args); } }); return db; } });
    try { await assert.rejects(prepareMongoAdminMaintenanceRuntime({ ...options, namespace: failedNamespace }), /^Error: MONGO_ADMIN_MAINTENANCE_RUNTIME_FAILED$/); } finally { Object.defineProperty(client, "db", { configurable: true, value: originalDb }); }
    assert.equal(interrupted, true); const failed = await snapshot(failedNamespace); writes.length = 0; await assert.rejects(prepareMongoAdminMaintenanceRuntime({ ...options, namespace: failedNamespace }), /^Error: MONGO_ADMIN_MAINTENANCE_RUNTIME_FAILED$/); assert.deepEqual(writes.map(row => row.commandName), []); assert.equal(await snapshot(failedNamespace), failed);
    const seed = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, { id: randomUUID(), ...values }); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    const company = await seed("Company", { name: "Synthetic maintenance company", normalizedName: "synthetic maintenance company" });
    const courseRow = await seed("Course", { companyId: company.id, name: "Synthetic maintenance course", processSeq: 812 });
    const operation = await seed("OperationSession", { courseRecordId: courseRow.id, operationId: "synthetic-maintenance-operation", onsiteRequired: "N", operationStatus: "ASSIGNMENT_NEEDED", omName: "Synthetic private owner", specialNotes: "Synthetic private note" });
    const run = <T>(work: () => Promise<T>) => runtime.run(() => actors.run(admin, work));
    const responses: Response[] = [];
    responses.push(await run(() => lookup.GET(request("/api/admin/courses/lookup?processId=PRC-000812")))); assert.equal(responses.at(-1)!.status, 200);
    responses.push(await run(() => course.DELETE(request("/api/admin/courses/x", "DELETE"), { params: Promise.resolve({ courseId: String(courseRow.id) }) }))); assert.deepEqual(await responses.at(-1)!.clone().json(), { ok: true, deletedCount: 1 });
    responses.push(await run(() => deleted.GET())); assert.equal((await responses.at(-1)!.clone().json()).operations.length, 1);
    responses.push(await run(() => deleted.PUT(request("/api/admin/deleted-operations", "PUT", { operationId: operation.operationId })))); assert.equal(responses.at(-1)!.status, 200);
    responses.push(await run(() => onsite.POST())); assert.deepEqual(await responses.at(-1)!.clone().json(), { ok: true, updatedCount: 1 });
    responses.push(await run(() => om.POST())); assert.deepEqual(await responses.at(-1)!.clone().json(), { ok: true, updatedCount: 1 });
    for (const response of responses) { const id = response.headers.get("X-Request-Id"); assert.ok(id); const row = await store.one("ActivityRequest", { _id: id }); assert.equal(row?.status, response.status); assert.equal(row?.actorEmail, admin.user.email); }
    const restored = await store.one("OperationSession", { _id: String(operation.id) }); assert.equal(restored?.deletedAt, null); assert.equal(restored?.onsiteRequired, "Y"); assert.equal(restored?.operationStatus, "ASSIGNMENT_PLANNED");
    const raw = JSON.stringify(await Promise.all(MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS.map(model => store.collection(model).find({}).toArray()))); for (const marker of [admin.user.email, admin.user.name, "Synthetic private owner", "Synthetic private note"]) assert.ok(!raw.includes(marker));
    assert.equal(pgCalls, 0); assert.equal(closeCalls, 0); await client.db("admin").command({ ping: 1 });
  } finally { try { if (connected && ownsDatabase) await client.db(databaseName).dropDatabase(); } finally { try { if (connected) await realClose(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } } }
});
