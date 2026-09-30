/** Opt-in actual Mongo validation for the coach-admin API and page composition. */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { BSON, MongoClient, type CommandStartedEvent, type Db } from "mongodb";
import ts from "typescript";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MONGO_COACH_ADMIN_RUNTIME_MODELS, openMongoCoachAdminRuntime, prepareMongoCoachAdminRuntime } from "./mongoCoachAdminRuntime";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "runtime-admin@day1company.co.kr", name: "Synthetic runtime admin" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL access"); } } });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/features/coaches/CoachAdminPage") return { url: "data:text/javascript,export const CoachAdminPage = () => null;", shortCircuit: true };
    return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    return next(url, context);
  }
});
const fields = await import("../../app/api/master/fields/route");
const deleted = await import("../../app/api/admin/deleted-coaches/route");
const { default: page } = await import("../../app/coaches/admin/page");
hooks.deregister();

const uri = process.env.MONGODB_COACH_ADMIN_RUNTIME_URI;
const request = (method: string, body?: unknown) => new Request("https://example.invalid/api/runtime", { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });

test("coach-admin runtime composes page, masters, deleted coaches and request audit", { skip: !uri, timeout: 180_000 }, async () => {
  const parsed = new URL(uri!);
  assert.equal(parsed.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)); assert.ok(parsed.port);
  assert.equal(parsed.username, ""); assert.equal(parsed.password, ""); assert.ok(parsed.pathname === "" || parsed.pathname === "/");
  const envNames = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DATABASE_URL", "DEV_AUTH_BYPASS"] as const;
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "coach-admin-runtime";
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ "coach-admin-runtime": randomBytes(32).toString("base64") });
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  process.env.ADMIN_EMAILS = admin.user.email; delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const databaseName = `hub_om_shadow_coach_admin_runtime_${randomBytes(8).toString("hex")}`, namespace = "shadow_coach_admin_runtime";
  const client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const writes: CommandStartedEvent[] = [], mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => {
    const outputAggregate = event.commandName === "aggregate" && Array.isArray(event.command.pipeline)
      && event.command.pipeline.some((stage: unknown) => stage !== null && typeof stage === "object" && (Object.hasOwn(stage, "$out") || Object.hasOwn(stage, "$merge")));
    if (mutating.has(event.commandName) || outputAggregate) writes.push(event);
  });
  const realClose = client.close.bind(client); let closeCalls = 0, connected = false, ownsDatabase = false;
  Object.defineProperty(client, "close", { configurable: true, value: async (...args: Parameters<MongoClient["close"]>) => { closeCalls++; return realClose(...args); } });
  const options = { client, databaseName, namespace, allowShadowWrites: true as const };
  const expectedNames = (value: string) => new Set([...MONGO_COACH_ADMIN_RUNTIME_MODELS.map(model => `${value}_${model}`), `${value}_CoachSchedulingGuard`, `${value}_CoachCatalogGuard`]);
  async function snapshot(value = namespace) {
    const names = expectedNames(value), infos = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).filter(info => names.has(info.name)).sort((a,b) => a.name.localeCompare(b.name));
    return BSON.EJSON.stringify(await Promise.all(infos.map(async info => ({ info, indexes: await client.db(databaseName).collection(info.name).listIndexes().toArray(), documents: await client.db(databaseName).collection(info.name).find({}).sort({ _id: 1 }).toArray() }))), { relaxed: false });
  }
  try {
    await client.connect(); connected = true;
    const databases = await client.db("admin").admin().listDatabases({ nameOnly: true }); assert.equal(databases.databases.some(row => row.name === databaseName), false); ownsDatabase = true;
    const second = await prepareMongoCoachAdminRuntime({ ...options, namespace: "shadow_coach_admin_runtime_second" });
    const runtime = await prepareMongoCoachAdminRuntime(options), store = new MongoOperationStore(options, MONGO_COACH_ADMIN_RUNTIME_MODELS);
    const ready = await snapshot(); writes.length = 0; await prepareMongoCoachAdminRuntime(options); await openMongoCoachAdminRuntime(options);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.equal(await snapshot(), ready);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial: Partial<typeof runtime.repositories> = { ...runtime.repositories }; delete partial[key]; let callbacks = 0; const before = writes.length;
      assert.throws(() => runWithDataRepositories(partial, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/); assert.equal(callbacks, 0); assert.equal(writes.length, before);
    }
    let nested = 0; const beforeNested = writes.length;
    assert.throws(() => runtime.run(() => second.run(() => { nested++; })), /CALENDAR_SCOPE_MISMATCH/); assert.equal(nested, 0); assert.equal(writes.length, beforeNested);

    const failedNamespace = "shadow_coach_admin_runtime_failed", originalDb = client.db.bind(client); let interrupted = false;
    Object.defineProperty(client, "db", { configurable: true, value: (name?: string, settings?: Parameters<MongoClient["db"]>[1]) => {
      const db = originalDb(name, settings), create = db.createCollection.bind(db);
      Object.defineProperty(db, "createCollection", { configurable: true, value: async (...args: Parameters<Db["createCollection"]>) => {
        if (args[0] === `${failedNamespace}_CoachCatalogGuard`) { interrupted = true; throw new Error("synthetic coach-admin prepare interruption"); }
        return create(...args);
      } }); return db;
    } });
    try { await assert.rejects(prepareMongoCoachAdminRuntime({ ...options, namespace: failedNamespace }), /^Error: MONGO_COACH_ADMIN_RUNTIME_FAILED$/); }
    finally { Object.defineProperty(client, "db", { configurable: true, value: originalDb }); }
    assert.equal(interrupted, true); const failed = await snapshot(failedNamespace); assert.ok(failed.includes(`${failedNamespace}_CoachSchedulingGuard`));
    writes.length = 0; await assert.rejects(prepareMongoCoachAdminRuntime({ ...options, namespace: failedNamespace }), /^Error: MONGO_COACH_ADMIN_RUNTIME_FAILED$/);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.equal(await snapshot(failedNamespace), failed); assert.equal(closeCalls, 0);
    const seed = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, { id: randomUUID(), ...values }); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    await seed("CoachFieldMaster", { name: "Synthetic existing field" });
    const restorable = await seed("Coach", { name: "Synthetic restorable coach", normalizedName: "synthetic restorable coach", status: "INACTIVE", isActive: false, deletedAt: new Date("2026-10-01T00:00:00.000Z"), deletedBy: admin.user.email });
    const purgeable = await seed("Coach", { name: "Synthetic purgeable coach", normalizedName: "synthetic purgeable coach", status: "INACTIVE", isActive: false, deletedAt: new Date("2026-09-30T00:00:00.000Z"), deletedBy: admin.user.email });
    const run = <T>(work: () => Promise<T>) => runtime.run(() => actors.run(admin, work));
    const rendered = await run(() => page({ searchParams: Promise.resolve({ tab: "deleted" }) })); assert.equal(rendered.props.deletedCount, 2); assert.equal(rendered.props.selectedTab, "deleted");
    const list = await run(() => fields.GET()); assert.equal(list.status, 200); assert.ok(list.headers.get("X-Request-Id"));
    const created = await run(() => fields.POST(request("POST", { name: " Synthetic new field " }))); assert.equal(created.status, 201);
    const deletedList = await run(() => deleted.GET()); assert.equal(deletedList.status, 200); assert.equal((await deletedList.clone().json()).coaches.length, 2);
    const restored = await run(() => deleted.PUT(request("PUT", { id: String(restorable.id).toUpperCase() }))); assert.equal(restored.status, 200);
    const purged = await run(() => deleted.DELETE(request("DELETE", { id: purgeable.id }))); assert.equal(purged.status, 200);
    const responses = [list, created, deletedList, restored, purged];
    for (const response of responses) {
      const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
      const row = await store.one("ActivityRequest", { _id: requestId }); assert.equal(row?.status, response.status); assert.equal(row?.actorEmail, admin.user.email);
    }
    assert.equal(await store.collection("ActivityRequest").countDocuments(), 5);
    assert.equal((await store.one("Coach", { _id: String(restorable.id) }))?.deletedAt, null); assert.equal(await store.collection("Coach").countDocuments({ _id: String(purgeable.id) }), 0);
    assert.equal(await store.collection("CoachFieldMaster").countDocuments({ name: "Synthetic new field" }), 1);
    const changes = await store.scan("ActivityChange", {}); assert.ok(changes.some(row => row.targetId === restorable.id && row.action === "restore")); assert.ok(changes.some(row => row.targetId === purgeable.id && row.action === "delete"));
    const raw = JSON.stringify(await Promise.all(MONGO_COACH_ADMIN_RUNTIME_MODELS.map(model => store.collection(model).find({}).toArray())));
    for (const marker of ["Synthetic restorable coach", "Synthetic purgeable coach", admin.user.email, admin.user.name]) assert.ok(!raw.includes(marker));
    assert.equal(pgCalls, 0); assert.equal(closeCalls, 0); await client.db("admin").command({ ping: 1 });
  } finally {
    try { if (connected && ownsDatabase) await client.db(databaseName).dropDatabase(); }
    finally { try { if (connected) await realClose(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
