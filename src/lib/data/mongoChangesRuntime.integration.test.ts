/** Opt-in actual Mongo validation for the /changes API composition. */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { BSON, MongoClient, type CommandStartedEvent, type Db } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MONGO_CHANGES_RUNTIME_MODELS, openMongoChangesRuntime, prepareMongoChangesRuntime } from "./mongoChangesRuntime";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "changes-admin@day1company.co.kr", name: "Synthetic changes admin" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL access"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const activity = await import("../../app/api/admin/activity/route");
const feed = await import("../../app/api/admin/content-entries/route");
const note = await import("../../app/api/coaches/[id]/notes/[noteId]/route");
const review = await import("../../app/api/engagements/[id]/review/route");
hooks.deregister();

const uri = process.env.MONGODB_CHANGES_RUNTIME_URI;
const json = (url: string, method: string, body?: unknown) => new Request(`https://example.invalid${url}`, {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
});

test("changes runtime composes activity, content, review and request audit in one namespace", { skip: !uri, timeout: 180_000 }, async () => {
  const parsed = new URL(uri!);
  assert.equal(parsed.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.ok(parsed.port); assert.equal(parsed.username, ""); assert.equal(parsed.password, ""); assert.ok(parsed.pathname === "" || parsed.pathname === "/");
  const envNames = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DATABASE_URL", "DEV_AUTH_BYPASS"] as const;
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "changes-fixture";
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ "changes-fixture": randomBytes(32).toString("base64") });
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  process.env.ADMIN_EMAILS = admin.user.email; delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const databaseName = `hub_om_shadow_changes_${randomBytes(10).toString("hex")}`;
  const client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const writes: CommandStartedEvent[] = [], mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection", "convertToCapped", "emptycapped", "mapReduce"]);
  client.on("commandStarted", event => {
    const outputAggregate = event.commandName === "aggregate" && Array.isArray(event.command.pipeline)
      && event.command.pipeline.some((stage: unknown) => stage !== null && typeof stage === "object" && (Object.hasOwn(stage, "$out") || Object.hasOwn(stage, "$merge")));
    if (mutating.has(event.commandName) || outputAggregate) writes.push(event);
  });
  const realClose = client.close.bind(client); let closeCalls = 0, connected = false, ownsDatabase = false;
  Object.defineProperty(client, "close", { configurable: true, value: async (...args: Parameters<MongoClient["close"]>) => { closeCalls++; return realClose(...args); } });
  const namespace = "shadow_changes", options = { client, databaseName, namespace, allowShadowWrites: true as const };
  const expectedNames = (value: string) => new Set([...MONGO_CHANGES_RUNTIME_MODELS.map(model => `${value}_${model}`), `${value}_CoachSchedulingGuard`, `${value}_CoachCatalogGuard`]);
  async function snapshot(value: string) {
    const names = expectedNames(value), infos = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).filter(info => names.has(info.name)).sort((a,b) => a.name.localeCompare(b.name));
    return BSON.EJSON.stringify(await Promise.all(infos.map(async info => ({ info, indexes: await client.db(databaseName).collection(info.name).listIndexes().toArray(), documents: await client.db(databaseName).collection(info.name).find({}).sort({ _id: 1 }).toArray() }))), { relaxed: false });
  }
  try {
    await client.connect(); connected = true;
    const databases = await client.db("admin").admin().listDatabases({ nameOnly: true });
    assert.equal(databases.databases.some(database => database.name === databaseName), false); ownsDatabase = true;
    const second = await prepareMongoChangesRuntime({ ...options, namespace: "shadow_peer_changes" });
    const runtime = await prepareMongoChangesRuntime(options), store = new MongoOperationStore(options, MONGO_CHANGES_RUNTIME_MODELS);
    const beforeReady = await snapshot(namespace); writes.length = 0;
    await prepareMongoChangesRuntime(options); await openMongoChangesRuntime(options);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.equal(await snapshot(namespace), beforeReady);
    let nested = 0; assert.throws(() => runtime.run(() => second.run(() => { nested++; })), /CALENDAR_SCOPE_MISMATCH/); assert.equal(nested, 0);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial = { ...runtime.repositories }; delete partial[key]; let callbacks = 0; const before = writes.length;
      assert.throws(() => runWithDataRepositories(partial, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
      assert.equal(callbacks, 0); assert.equal(writes.length, before);
    }
    let replaced = 0; const beforeReplace = writes.length;
    assert.throws(() => runWithDataRepositories({ ...runtime.repositories, coachContent: second.repositories.coachContent }, () => { replaced++; }), /CALENDAR_SCOPE_MISMATCH/);
    assert.equal(replaced, 0); assert.equal(writes.length, beforeReplace);

    const failedNamespace = "shadow_changes_failed", originalDb = client.db.bind(client); let interrupted = false;
    Object.defineProperty(client, "db", { configurable: true, value: (name?: string, settings?: Parameters<MongoClient["db"]>[1]) => {
      const db = originalDb(name, settings), create = db.createCollection.bind(db);
      Object.defineProperty(db, "createCollection", { configurable: true, value: async (...args: Parameters<Db["createCollection"]>) => {
        if (args[0] === `${failedNamespace}_CoachCatalogGuard`) { interrupted = true; throw new Error("synthetic changes prepare interruption"); }
        return create(...args);
      } }); return db;
    } });
    try { await assert.rejects(prepareMongoChangesRuntime({ ...options, namespace: failedNamespace }), /^Error: MONGO_CHANGES_RUNTIME_FAILED$/); }
    finally { Object.defineProperty(client, "db", { configurable: true, value: originalDb }); }
    assert.equal(interrupted, true); const failed = await snapshot(failedNamespace); assert.ok(failed.includes(`${failedNamespace}_CoachSchedulingGuard`));
    writes.length = 0; await assert.rejects(prepareMongoChangesRuntime({ ...options, namespace: failedNamespace }), /^Error: MONGO_CHANGES_RUNTIME_FAILED$/);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.equal(await snapshot(failedNamespace), failed); assert.equal(closeCalls, 0);

    const seed = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, { id: randomUUID(), ...values }); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    const coach = await seed("Coach", { name: "Synthetic changes coach", normalizedName: "synthetic changes coach", status: "ACTIVE", isActive: true });
    const entry = await seed("CoachContentEntry", { coachId: coach.id, kind: "NOTE", content: "Synthetic private note", authorEmail: admin.user.email, authorName: admin.user.name, createdAt: new Date() });
    const engagementDate = new Date("2026-10-01T00:00:00.000Z");
    const engagement = await seed("CoachEngagement", { coachId: coach.id, courseName: "Synthetic course", status: "COMPLETED", source: "MANUAL", startDate: engagementDate, endDate: engagementDate, rating: 3, feedback: "Synthetic old feedback", createdAt: new Date() });
    const run = <T>(work: () => Promise<T>) => runtime.run(() => actors.run(admin, work));
    const feedResponse = await run(() => feed.GET()); assert.equal(feedResponse.status, 200);
    const feedBody = await feedResponse.json(); assert.ok(feedBody.entries.some((row: { id: string }) => row.id === entry.id)); assert.ok(feedBody.entries.some((row: { id: string }) => row.id === engagement.id));
    const noteResponse = await run(() => note.PATCH(json("/api/coaches/x/notes/y", "PATCH", { content: "Synthetic changed note" }), { params: Promise.resolve({ id: String(coach.id), noteId: String(entry.id) }) }));
    assert.equal(noteResponse.status, 200); assert.equal((await noteResponse.clone().json()).note.content, "Synthetic changed note");
    const reviewResponse = await run(() => review.PATCH(json("/api/engagements/x/review", "PATCH", { rating: 5, feedback: "Synthetic changed feedback" }), { params: Promise.resolve({ id: String(engagement.id) }) }));
    assert.equal(reviewResponse.status, 200); const reviewBody = await reviewResponse.clone().json(); assert.equal(reviewBody.engagement.rating, 5); assert.equal(reviewBody.engagement.feedback, "Synthetic changed feedback");
    const noteRequestId = noteResponse.headers.get("X-Request-Id"), reviewRequestId = reviewResponse.headers.get("X-Request-Id"), feedRequestId = feedResponse.headers.get("X-Request-Id");
    assert.ok(noteRequestId && reviewRequestId && feedRequestId);
    for (const [id, route] of [[feedRequestId, "/api/admin/content-entries"], [noteRequestId, "/api/coaches/[id]/notes/[noteId]"], [reviewRequestId, "/api/engagements/[id]/review"]] as const) {
      const requestRow = await store.one("ActivityRequest", { _id: id }); assert.equal(requestRow?.route, route); assert.equal(requestRow?.status, 200); assert.equal(requestRow?.actorEmail, admin.user.email);
    }
    assert.equal((await store.one("CoachContentEntry", { _id: String(entry.id) }))?.content, "Synthetic changed note");
    const storedEngagement = await store.one("CoachEngagement", { _id: String(engagement.id) }); assert.equal(storedEngagement?.rating, 5); assert.equal(storedEngagement?.feedback, "Synthetic changed feedback");
    assert.equal(await store.collection("ActivityChange").countDocuments({ requestId: noteRequestId, targetId: entry.id }), 1);
    assert.equal(await store.collection("ActivityChange").countDocuments({ requestId: reviewRequestId, targetId: engagement.id }), 1);
    const activityResponse = await run(() => activity.GET(json("/api/admin/activity", "GET"))); assert.equal(activityResponse.status, 200);
    const activityBody = await activityResponse.json(); assert.ok(activityBody.entries.length >= 2);
    assert.equal(await store.collection("ActivityRequest").countDocuments(), 3);
    const raw = JSON.stringify(await Promise.all(MONGO_CHANGES_RUNTIME_MODELS.map(model => store.collection(model).find({}).toArray())));
    for (const marker of ["Synthetic private note", "Synthetic changed note", "Synthetic old feedback", "Synthetic changed feedback", admin.user.email, admin.user.name]) assert.ok(!raw.includes(marker));
    assert.equal(pgCalls, 0); assert.equal(closeCalls, 0); await client.db("admin").command({ ping: 1 });
  } finally {
    try { if (connected && ownsDatabase) await client.db(databaseName).dropDatabase(); }
    finally { try { if (connected) await realClose(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
