/** Opt-in actual Mongo validation for user administration APIs composed in one runtime. */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { BSON, MongoClient, type CommandStartedEvent, type Db } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MONGO_USER_ADMIN_RUNTIME_MODELS, openMongoUserAdminRuntime, prepareMongoUserAdminRuntime } from "./mongoUserAdminRuntime";
import { MongoOperationStore } from "./mongoOperationStore";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "user-admin@day1company.co.kr", name: "Synthetic user admin" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL access"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const users = await import("../../app/api/admin/users/route");
const deletion = await import("../../app/api/admin/users/delete/route");
const team = await import("../../app/api/admin/users/team/route");
const role = await import("../../app/api/admin/users/role/route");
const lookup = await import("../../app/api/team-users/lookup/route");
hooks.deregister();

const uri = process.env.MONGODB_USER_ADMIN_RUNTIME_URI;
const request = (url: string, method = "GET", body?: unknown, headers?: HeadersInit) => new Request(`https://example.invalid${url}`, {
  method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("user admin runtime composes roster writes, token lookup, deletion policy and request audit", { skip: !uri, timeout: 180_000 }, async () => {
  const parsed = new URL(uri!);
  assert.equal(parsed.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.ok(parsed.port); assert.equal(parsed.username, ""); assert.equal(parsed.password, "");
  const envNames = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "COURSE_LOOKUP_TOKEN", "DATABASE_URL", "DEV_AUTH_BYPASS"] as const;
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "user-admin-runtime";
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ "user-admin-runtime": randomBytes(32).toString("base64") });
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  process.env.ADMIN_EMAILS = admin.user.email;
  process.env.COURSE_LOOKUP_TOKEN = "synthetic-user-lookup-token";
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const databaseName = `hub_om_shadow_user_admin_${randomBytes(8).toString("hex")}`, namespace = "shadow_user_admin";
  const client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const writes: CommandStartedEvent[] = [];
  const mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => {
    const output = event.commandName === "aggregate" && Array.isArray(event.command.pipeline) && event.command.pipeline.some((stage: unknown) => stage && typeof stage === "object" && (Object.hasOwn(stage, "$out") || Object.hasOwn(stage, "$merge")));
    if (mutating.has(event.commandName) || output) writes.push(event);
  });
  const realClose = client.close.bind(client); let closeCalls = 0, connected = false, ownsDatabase = false;
  Object.defineProperty(client, "close", { configurable: true, value: async (...args: Parameters<MongoClient["close"]>) => { closeCalls++; return realClose(...args); } });
  const options = { client, databaseName, namespace, allowShadowWrites: true as const };
  const names = (value: string) => new Set([...MONGO_USER_ADMIN_RUNTIME_MODELS.map(model => `${value}_${model}`), `${value}_CoachSchedulingGuard`, `${value}___teamUserWriteGuard`]);
  async function snapshot(value: string) {
    const infos = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).filter(info => names(value).has(info.name)).sort((a, b) => a.name.localeCompare(b.name));
    return BSON.EJSON.stringify(await Promise.all(infos.map(async info => ({ info, indexes: await client.db(databaseName).collection(info.name).listIndexes().toArray(), documents: await client.db(databaseName).collection(info.name).find({}).sort({ _id: 1 }).toArray() }))), { relaxed: false });
  }
  try {
    await client.connect(); connected = true;
    const databases = await client.db("admin").admin().listDatabases({ nameOnly: true });
    assert.equal(databases.databases.some(row => row.name === databaseName), false); ownsDatabase = true;
    const second = await prepareMongoUserAdminRuntime({ ...options, namespace: "shadow_user_admin_second" });
    const runtime = await prepareMongoUserAdminRuntime(options), store = new MongoOperationStore(options, MONGO_USER_ADMIN_RUNTIME_MODELS);
    const ready = await snapshot(namespace); writes.length = 0;
    await prepareMongoUserAdminRuntime(options); await openMongoUserAdminRuntime(options);
    assert.deepEqual(writes.map(row => row.commandName), []); assert.equal(await snapshot(namespace), ready);
    let nested = 0;
    assert.throws(() => runtime.run(() => second.run(() => { nested++; })), /CALENDAR_SCOPE_MISMATCH/); assert.equal(nested, 0);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial: Partial<typeof runtime.repositories> = { ...runtime.repositories }; delete partial[key];
      assert.throws(() => runWithDataRepositories(partial, () => {}), /CALENDAR_SCOPE_MISMATCH/);
    }
    const failedNamespace = "shadow_user_admin_failed", originalDb = client.db.bind(client); let interrupted = false;
    Object.defineProperty(client, "db", { configurable: true, value: (name?: string, settings?: Parameters<MongoClient["db"]>[1]) => {
      const db = originalDb(name, settings), create = db.createCollection.bind(db);
      Object.defineProperty(db, "createCollection", { configurable: true, value: async (...args: Parameters<Db["createCollection"]>) => {
        if (args[0] === `${failedNamespace}___teamUserWriteGuard`) { interrupted = true; throw new Error("synthetic user admin prepare interruption"); }
        return create(...args);
      } }); return db;
    } });
    try { await assert.rejects(prepareMongoUserAdminRuntime({ ...options, namespace: failedNamespace }), /^Error: MONGO_USER_ADMIN_RUNTIME_FAILED$/); }
    finally { Object.defineProperty(client, "db", { configurable: true, value: originalDb }); }
    assert.equal(interrupted, true); const failed = await snapshot(failedNamespace); writes.length = 0;
    await assert.rejects(prepareMongoUserAdminRuntime({ ...options, namespace: failedNamespace }), /^Error: MONGO_USER_ADMIN_RUNTIME_FAILED$/);
    assert.deepEqual(writes.map(row => row.commandName), []); assert.equal(await snapshot(failedNamespace), failed);

    const run = <T>(work: () => Promise<T>) => runtime.run(() => actors.run(admin, work));
    const responses: Response[] = [];
    responses.push(await run(() => users.GET())); assert.deepEqual(await responses.at(-1)!.clone().json(), []);
    const createdResponse = await run(() => users.POST(request("/api/admin/users", "POST", { name: " Synthetic private member ", email: " PRIVATE.Member@Example.invalid ", slackId: "private-slack-marker", team: "AX 1파트", role: "om" })));
    responses.push(createdResponse); assert.equal(createdResponse.status, 201);
    const created = await createdResponse.clone().json() as { id: string; email: string };
    const duplicate = await run(() => users.POST(request("/api/admin/users", "POST", { name: "Duplicate marker", email: "private.member@example.invalid", slackId: "duplicate-slack" })));
    responses.push(duplicate); assert.equal(duplicate.status, 409); assert.ok(!(await duplicate.clone().text()).includes("Synthetic private member"));
    responses.push(await run(() => team.POST(request("/api/admin/users/team", "POST", { id: created.id, team: "AX 2파트" })))); assert.equal(responses.at(-1)!.status, 200);
    responses.push(await run(() => role.POST(request("/api/admin/users/role", "POST", { ids: [created.id], role: "ld" })))); assert.deepEqual(await responses.at(-1)!.clone().json(), { count: 1 });
    const unauthorized = await runtime.run(() => actors.run(null, () => users.GET()));
    responses.push(unauthorized); assert.equal(unauthorized.status, 403);
    const tokenDenied = await runtime.run(() => actors.run(null, () => lookup.GET(request("/api/team-users/lookup"))));
    responses.push(tokenDenied); assert.equal(tokenDenied.status, 401);
    const tokenResponse = await runtime.run(() => actors.run(null, () => lookup.GET(request("/api/team-users/lookup", "GET", undefined, { authorization: "Bearer synthetic-user-lookup-token" }))));
    responses.push(tokenResponse); assert.deepEqual(await tokenResponse.clone().json(), { ok: true, count: 1, members: [{ email: created.email.trim().toLowerCase(), name: "Synthetic private member" }] });
    const tokenBody = await tokenResponse.clone().text(); assert.ok(!tokenBody.includes("private-slack-marker")); assert.ok(!tokenBody.includes("AX 2파트")); assert.ok(!tokenBody.includes("ld"));
    const deleteResponse = await run(() => deletion.POST(request("/api/admin/users/delete", "POST", { ids: [created.id] })));
    responses.push(deleteResponse); assert.equal(deleteResponse.status, 500);
    const afterDelete = await run(() => users.GET()); responses.push(afterDelete); assert.equal((await afterDelete.clone().json() as unknown[]).length, 1);
    for (const response of responses) {
      const id = response.headers.get("X-Request-Id"); assert.ok(id);
      const row = await store.one("ActivityRequest", { _id: id }); assert.equal(row?.status, response.status);
      if (response === tokenDenied || response === tokenResponse) { assert.equal(row?.actorType, "token_request"); assert.equal(row?.actorEmail, null); }
    }
    const changes = await store.scan("ActivityChange"); assert.equal(changes.length, 3);
    const raw = JSON.stringify(await Promise.all(MONGO_USER_ADMIN_RUNTIME_MODELS.map(model => store.collection(model).find({}).toArray())));
    for (const marker of [admin.user.email, admin.user.name, "Synthetic private member", "PRIVATE.Member@Example.invalid", "private-slack-marker", "Duplicate marker", "duplicate-slack"]) assert.ok(!raw.includes(marker), marker);
    assert.equal(pgCalls, 0); assert.equal(closeCalls, 0); await client.db("admin").command({ ping: 1 });
  } finally {
    try { if (connected && ownsDatabase) await client.db(databaseName).dropDatabase(); }
    finally { try { if (connected) await realClose(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
