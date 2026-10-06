import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MONGO_HUBBOT_RUNTIME_MODELS, openMongoHubBotRuntime, prepareMongoHubBotRuntime } from "./mongoHubBotRuntime";
import { MongoOperationStore } from "./mongoOperationStore";

const user = { email: "synthetic.hubbot@day1company.co.kr", name: "Synthetic HubBot User" };
mock.module("@/auth", { namedExports: { auth: async () => ({ user, expires: "" }) } });
mock.module("@/lib/auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => ({ user, expires: "" }) } });
let pgCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const route = await import("../../app/api/hubbot/message/route"); hooks.deregister();
const uri = process.env.MONGODB_HUBBOT_RUNTIME_TEST_URI;

async function snapshot(store: MongoOperationStore) {
  const value: Record<string, unknown> = {};
  for (const item of (await store.db.listCollections({}, { nameOnly: false }).toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = store.db.collection(item.name);
    value[item.name] = { options: item.options, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return value;
}

test("HubBot handler uses one prepared locked Mongo audit and explicit responder", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const env = { DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", DEV_AUTH_BYPASS: "false",
    ANTHROPIC_API_KEY: "forbidden-real-adapter", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [], mutations = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { if (mutations.has(event.commandName)) writes.push(event); });
  const databaseName = `hub_om_shadow_hubbot_${randomBytes(8).toString("hex")}`, namespace = `shadow_hubbot_${randomBytes(6).toString("hex")}`;
  let responderCalls = 0, fetchCalls = 0;
  const options = { client, databaseName, namespace, allowShadowWrites: true as const, hubBotResponder: { async reply(question: string, history: Array<{ role: string; content: string }>) {
    responderCalls++; assert.equal(question, "합성 질문"); assert.deepEqual(history, [{ role: "user", content: "이전 질문" }]); return "합성 답변";
  } } };
  const fetchMock = mock.method(globalThis, "fetch", async () => { fetchCalls++; throw new Error("FETCH_TRIPWIRE"); });
  try {
    await client.connect(); const runtime = await prepareMongoHubBotRuntime(options), store = new MongoOperationStore(options, MONGO_HUBBOT_RUNTIME_MODELS);
    const ready = await snapshot(store); writes.length = 0;
    await prepareMongoHubBotRuntime(options); await openMongoHubBotRuntime(options);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(store), ready);
    const response = await runtime.run(() => route.POST(new Request("https://example.invalid/api/hubbot/message", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: " 합성 질문 ", history: [{ role: "user", content: "이전 질문" }, { role: "system", content: "제외" }] }) })));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, reply: "합성 답변" });
    assert.equal(responderCalls, 1); assert.equal(fetchCalls, 0); assert.equal(pgCalls, 0);
    const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId); const audit = await store.one("ActivityRequest", { _id: requestId });
    assert.ok(audit); assert.equal(audit.route, "/api/hubbot/message"); assert.equal(audit.status, 200);
    const second = await prepareMongoHubBotRuntime({ ...options, namespace: `shadow_hubbot_second_${randomBytes(6).toString("hex")}` }); let callbacks = 0;
    assert.throws(() => runtime.run(() => second.run(() => { callbacks++; })), /CALENDAR_SCOPE_MISMATCH/);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial = { ...runtime.repositories }; delete partial[key]; assert.throws(() => runWithDataRepositories(partial, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
    }
    assert.equal(callbacks, 0);
    const partialNamespace = `shadow_hubbot_partial_${randomBytes(6).toString("hex")}`, partial = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partial.db.createCollection(`${partialNamespace}_LegacyOnly`, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    await partial.db.collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" }); const before = await snapshot(partial); writes.length = 0;
    await assert.rejects(prepareMongoHubBotRuntime({ ...options, namespace: partialNamespace }), /MONGO_HUBBOT_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(partial), before);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); fetchMock.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
