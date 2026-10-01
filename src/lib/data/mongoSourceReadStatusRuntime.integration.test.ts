import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import type { OperationSourceReader, OperationSourceKind, SourceReadResult } from "../sourceReads/sourceReadTypes";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MONGO_SOURCE_READ_STATUS_RUNTIME_MODELS, openMongoSourceReadStatusRuntime, prepareMongoSourceReadStatusRuntime } from "./mongoSourceReadStatusRuntime";
import { MongoOperationStore } from "./mongoOperationStore";

const user = { email: "synthetic.source.status@day1company.co.kr", name: "Synthetic Source Status" };
mock.module("@/auth", { namedExports: { auth: async () => ({ user, expires: "" }) } });
let pgCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const route = await import("../../app/api/source-reads/status/route");
hooks.deregister();

const uri = process.env.MONGODB_SOURCE_READ_STATUS_RUNTIME_TEST_URI;
const readAt = "2099-12-01T00:00:00.000Z";
function result<T>(source: OperationSourceKind, items: T[], status: SourceReadResult<T>["status"] = "ok"): SourceReadResult<T> {
  return { source, status, readAt, items, issues: [] };
}
async function snapshot(store: MongoOperationStore) {
  const value: Record<string, unknown> = {};
  for (const item of (await store.db.listCollections({}, { nameOnly: false }).toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = store.db.collection(item.name);
    value[item.name] = { options: item.options, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return value;
}

test("source status handler uses one prepared locked Mongo audit and explicit source reader", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!);
  assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const env = { DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", DEV_AUTH_BYPASS: "false",
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [], mutations = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { if (mutations.has(event.commandName)) writes.push(event); });
  const databaseName = `hub_om_shadow_source_status_${randomBytes(8).toString("hex")}`, namespace = `shadow_source_status_${randomBytes(6).toString("hex")}`;
  const calls: string[] = []; let fetchCalls = 0;
  const operationSourceReader: OperationSourceReader = {
    async readCourseBoard() { calls.push("course_board"); return result("course_board", [{ sourceRecordId: "synthetic-course", courseName: "Synthetic Course" }]); },
    async readCalendarEvents() { calls.push("calendar"); return result("calendar", [], "disabled"); },
    async readDiscussionReferences() { calls.push("discussion"); return result("discussion", [{ sourceMessageId: "synthetic-message", operationKey: "SYNTHETIC", title: "Synthetic", occurredAt: readAt, sourceUrl: "https://example.invalid/discussion" }], "partial"); },
    async readSalesRecords() { calls.push("sales"); return result("sales", [{ sourceRecordId: "synthetic-sale", revenue: 100 }]); }
  };
  const options = { client, databaseName, namespace, allowShadowWrites: true as const, operationSourceReader };
  const fetchMock = mock.method(globalThis, "fetch", async () => { fetchCalls++; throw new Error("FETCH_TRIPWIRE"); });
  try {
    await client.connect();
    const runtime = await prepareMongoSourceReadStatusRuntime(options), store = new MongoOperationStore(options, MONGO_SOURCE_READ_STATUS_RUNTIME_MODELS);
    const ready = await snapshot(store); writes.length = 0;
    await prepareMongoSourceReadStatusRuntime(options); await openMongoSourceReadStatusRuntime(options);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(store), ready);

    const response = await runtime.run(() => route.GET());
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.ok, true);
    assert.deepEqual(body.sources.map((item: { source: string; status: string; itemCount: number }) => [item.source, item.status, item.itemCount]), [
      ["course_board", "ok", 1], ["calendar", "disabled", 0], ["discussion", "partial", 1], ["sales", "ok", 1]
    ]);
    assert.deepEqual(calls.sort(), ["calendar", "course_board", "discussion", "sales"]); assert.equal(fetchCalls, 0); assert.equal(pgCalls, 0);
    const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
    const audit = await store.one("ActivityRequest", { _id: requestId }); assert.ok(audit); assert.equal(audit.route, "/api/source-reads/status"); assert.equal(audit.status, 200);

    const second = await prepareMongoSourceReadStatusRuntime({ ...options, namespace: `shadow_source_status_second_${randomBytes(6).toString("hex")}` });
    let callbacks = 0; assert.throws(() => runtime.run(() => second.run(() => { callbacks++; })), /CALENDAR_SCOPE_MISMATCH/);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial = { ...runtime.repositories }; delete partial[key];
      assert.throws(() => runWithDataRepositories(partial, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
    }
    assert.equal(callbacks, 0);

    const partialNamespace = `shadow_source_status_partial_${randomBytes(6).toString("hex")}`, partial = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partial.db.createCollection(`${partialNamespace}_LegacyOnly`, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    await partial.db.collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const before = await snapshot(partial); writes.length = 0;
    await assert.rejects(prepareMongoSourceReadStatusRuntime({ ...options, namespace: partialNamespace }), /MONGO_SOURCE_READ_STATUS_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(partial), before);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close(); fetchMock.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
