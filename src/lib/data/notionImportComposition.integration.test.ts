import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { readNotionDatabaseImport } from "./notionImport";
import { MONGO_NOTION_IMPORT_RUNTIME_MODELS, prepareMongoNotionImportRuntime } from "./mongoNotionImportRuntime";
import { MongoOperationStore } from "./mongoOperationStore";

const uri = process.env.MONGODB_NOTION_COMPOSITION_TEST_URI;
const user = { email: "synthetic.notion@day1company.co.kr", name: "Synthetic Notion" };
mock.module("@/auth", { namedExports: { auth: async () => ({ user, expires: "" }) } });
let pgCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(["next/server", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, context);
} });
const route = await import("../../app/api/admin/imports/notion/import/route"); hooks.deregister();

test("Notion route selects one prepared Mongo scope without PostgreSQL fallback", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.password, "");
  const databaseName = `hub_om_shadow_notion_composition_${randomBytes(6).toString("hex")}`;
  const namespace = `shadow_notion_composition_${randomBytes(6).toString("hex")}`;
  const env = { DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", NOTION_IMPORT_BACKEND: "mongodb-shadow", NOTION_TOKEN: "synthetic-token",
    MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", DEV_AUTH_BYPASS: "false" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  let fetchCalls = 0;
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    fetchCalls++;
    return Response.json({ results: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", url: "https://example.invalid/notion", properties: {
      "기업명": { type: "rich_text", rich_text: [{ plain_text: "Synthetic Company" }] },
      "과정명": { type: "rich_text", rich_text: [{ plain_text: "Synthetic Course" }] },
      Date: { type: "date", date: { start: "2031-01-02", end: "2031-01-03" } }
    } }], has_more: false });
  });
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const, notionImportSource: { readDatabase: readNotionDatabaseImport } };
    await prepareMongoNotionImportRuntime(options);
    const store = new MongoOperationStore(options, MONGO_NOTION_IMPORT_RUNTIME_MODELS);
    const response = await route.POST(new Request("https://example.invalid/api/admin/imports/notion/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ databaseUrl: "11111111-1111-4111-8111-111111111111", sourceName: "Synthetic import" }) }));
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.ok, true); assert.equal(body.rowCount, 1); assert.equal(body.storedCount, 1);
    assert.equal(fetchCalls, 1); assert.equal(pgCalls, 0);
    assert.equal(await store.collection("DataImportRun").countDocuments(), 1); assert.equal(await store.collection("OperationSourceRecord").countDocuments(), 1);
    const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId); assert.ok(await store.one("ActivityRequest", { _id: requestId }));
    const raw = await store.collection("DataImportRun").findOne({ _id: body.importRunId });
    assert.match(String(raw?.sourceName), /^pii:v1:fixture:/); assert.ok(!JSON.stringify(raw).includes("Synthetic import"));

    const partialNamespace = `${namespace}_partial`;
    await client.db(databaseName).createCollection(`${partialNamespace}_LegacyOnly`);
    process.env.MONGODB_SHADOW_NAMESPACE = partialNamespace;
    await assert.rejects(route.POST(new Request("https://example.invalid/api/admin/imports/notion/import", { method: "POST", body: "{}" })), /NOTION_IMPORT_COMPOSITION_FAILED/);
    assert.equal(await client.db(databaseName).collection(`${partialNamespace}_LegacyOnly`).countDocuments(), 0);
    assert.equal(fetchCalls, 1); assert.equal(pgCalls, 0);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close(); fetchMock.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
