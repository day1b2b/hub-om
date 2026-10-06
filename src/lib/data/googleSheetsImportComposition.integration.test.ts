import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { listGoogleSheetTabs, readGoogleSheetRows } from "./googleSheetsImport";
import { MONGO_GOOGLE_SHEETS_IMPORT_MODELS, MONGO_GOOGLE_SHEETS_TABS_MODELS, prepareMongoGoogleSheetsImportRuntime, prepareMongoGoogleSheetsTabsRuntime } from "./mongoGoogleSheetsImportRuntime";
import { MongoOperationStore } from "./mongoOperationStore";

const uri = process.env.MONGODB_GOOGLE_SHEETS_COMPOSITION_TEST_URI;
const user = { email: "synthetic.sheets@day1company.co.kr", name: "Synthetic Sheets" };
mock.module("@/auth", { namedExports: { auth: async () => ({ user, expires: "", googleAccessToken: "synthetic-google-token" }) } });
let pgCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(["next/server", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, context); } });
const tabsRoute = await import("../../app/api/admin/imports/google-sheets/tabs/route");
const importRoute = await import("../../app/api/admin/imports/google-sheets/import/route"); hooks.deregister();

async function snapshot(store: MongoOperationStore) {
  const value: Record<string, unknown> = {};
  for (const item of (await store.db.listCollections({}, { nameOnly: false }).toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = store.db.collection(item.name);
    value[item.name] = { options: item.options, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return value;
}

test("Sheets tabs and import routes select their prepared Mongo scopes", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.protocol, "mongodb:"); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const databaseName = `hub_om_shadow_sheets_composition_${randomBytes(6).toString("hex")}`, namespace = `shadow_sheets_composition_${randomBytes(6).toString("hex")}`;
  const tabsNamespace = `shadow_sheets_tabs_${randomBytes(6).toString("hex")}`;
  const env = { GOOGLE_SHEETS_IMPORT_BACKEND: "mongodb-shadow", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 }); let fetchCalls = 0;
  const writes: CommandStartedEvent[] = [], mutations = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { if (mutations.has(event.commandName)) writes.push(event); });
  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    fetchCalls++; const value = String(input);
    if (value.includes("?fields=")) return Response.json({ sheets: [{ properties: { sheetId: 0, title: "Synthetic Tab", index: 0 } }] });
    return Response.json({ values: [["기업명", "과정명", "시작일", "종료일"], ["Synthetic Company", "Synthetic Course", "2031-03-04", "2031-03-05"]] });
  });
  try {
    await client.connect(); const source = { listTabs: listGoogleSheetTabs, readRows: readGoogleSheetRows };
    const options = { client, databaseName, namespace, allowShadowWrites: true as const, googleSheetsImportSource: source };
    const spreadsheetUrl = "https://docs.google.com/spreadsheets/d/synthetic-sheet-id/edit?gid=0";
    const tabsOptions = { ...options, namespace: tabsNamespace };
    await prepareMongoGoogleSheetsTabsRuntime(tabsOptions); process.env.MONGODB_SHADOW_NAMESPACE = tabsNamespace;
    const tabsStore = new MongoOperationStore(tabsOptions, MONGO_GOOGLE_SHEETS_TABS_MODELS);
    const tabs = await tabsRoute.POST(new Request("https://example.invalid/api/admin/imports/google-sheets/tabs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spreadsheetUrl }) }));
    assert.equal(tabs.status, 200); assert.equal((await tabs.json()).tabs[0].title, "Synthetic Tab"); assert.ok(await tabsStore.one("ActivityRequest", { _id: tabs.headers.get("X-Request-Id")! }));

    process.env.MONGODB_SHADOW_NAMESPACE = namespace; await prepareMongoGoogleSheetsImportRuntime(options);
    const store = new MongoOperationStore(options, MONGO_GOOGLE_SHEETS_IMPORT_MODELS);
    const imported = await importRoute.POST(new Request("https://example.invalid/api/admin/imports/google-sheets/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spreadsheetUrl, tabTitle: "Synthetic Tab", sourceName: "Synthetic Sheets import" }) }));
    assert.equal(imported.status, 200); const body = await imported.json(); assert.equal(body.ok, true); assert.equal(body.storedCount, 1);
    assert.ok(await store.one("ActivityRequest", { _id: imported.headers.get("X-Request-Id")! })); assert.equal(fetchCalls, 2); assert.equal(pgCalls, 0);
    const raw = await store.collection("DataImportRun").findOne({ _id: body.importRunId }); assert.match(String(raw?.sourceName), /^pii:v1:fixture:/); assert.ok(!JSON.stringify(raw).includes("Synthetic Sheets import"));

    const partialNamespace = `${namespace}_partial`;
    await client.db(databaseName).createCollection(`${partialNamespace}_LegacyOnly`, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    await client.db(databaseName).collection(`${partialNamespace}_LegacyOnly`).createIndex({ marker: 1 }, { unique: true, name: "marker_unique" });
    await client.db(databaseName).collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const partial = new MongoOperationStore({ ...options, namespace: partialNamespace }), before = await snapshot(partial); writes.length = 0;
    await assert.rejects(prepareMongoGoogleSheetsTabsRuntime({ ...options, namespace: partialNamespace }), /MONGO_GOOGLE_SHEETS_TABS_RUNTIME_FAILED/);
    await assert.rejects(prepareMongoGoogleSheetsImportRuntime({ ...options, namespace: partialNamespace }), /MONGO_GOOGLE_SHEETS_IMPORT_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(partial), before);
    process.env.MONGODB_SHADOW_NAMESPACE = partialNamespace;
    await assert.rejects(tabsRoute.POST(new Request("https://example.invalid/api/admin/imports/google-sheets/tabs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spreadsheetUrl }) })), /GOOGLE_SHEETS_IMPORT_COMPOSITION_FAILED/);
    await assert.rejects(importRoute.POST(new Request("https://example.invalid/api/admin/imports/google-sheets/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spreadsheetUrl, tabTitle: "Synthetic Tab", sourceName: "Synthetic partial" }) })), /GOOGLE_SHEETS_IMPORT_COMPOSITION_FAILED/);
    assert.deepEqual(await snapshot(partial), before); assert.equal(fetchCalls, 2); assert.equal(pgCalls, 0);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); fetchMock.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
