import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { prepareMongoActivityReadRuntime } from "./mongoActivityReadRuntime";

const uri = process.env.MONGODB_ACTIVITY_READ_COMPOSITION_TEST_URI;
const admin = { email: "synthetic.activity.admin@day1company.co.kr", name: "Synthetic Activity Admin" };
let actor: typeof admin | null = admin;
let pgCalls = 0;
mock.module("@/auth", { namedExports: { auth: async () => actor ? { user: actor, expires: "" } : null } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("PG_FORBIDDEN"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(["next/server", "next/navigation"].includes(specifier) ? `${specifier}.js` : specifier, context);
} });
const { GET: adminGET } = await import("../../app/api/admin/activity/route");
const { GET: feedGET } = await import("../../app/api/activity-feed/route");
const { GET: usageGET } = await import("../../app/api/admin/activity/usage/route");
hooks.deregister();

async function snapshot(client: MongoClient, databaseName: string) {
  const value: Record<string, unknown> = {};
  const items = await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray();
  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = client.db(databaseName).collection(item.name);
    value[item.name] = { options: item.options, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return value;
}

test("three activity GETs use one prepared Mongo read scope", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const databaseName = `hub_om_shadow_activity_composition_${randomBytes(6).toString("hex")}`;
  const namespace = `shadow_activity_${randomBytes(6).toString("hex")}`;
  const token = randomBytes(32).toString("hex");
  const environment = {
    ACTIVITY_READ_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName,
    MONGODB_SHADOW_NAMESPACE: namespace, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    ADMIN_EMAILS: admin.email, ACTIVITY_FEED_KEY: token, DEV_AUTH_BYPASS: "false", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden"
  };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]])); Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });
  try {
    await client.connect(); await prepareMongoActivityReadRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    const adminResponse = await adminGET(new Request("https://synthetic.invalid/api/admin/activity"));
    const usageResponse = await usageGET(new Request("https://synthetic.invalid/api/admin/activity/usage?date=2026-10-01"));
    const feedResponse = await feedGET(new Request("https://synthetic.invalid/api/activity-feed?period=7", { headers: { authorization: `Bearer ${token}` } }));
    assert.equal(adminResponse.status, 200); assert.equal(usageResponse.status, 200); assert.equal(feedResponse.status, 200);
    assert.equal(pgCalls, 0);

    actor = null;
    assert.equal((await adminGET(new Request("https://synthetic.invalid/api/admin/activity"))).status, 403);
    actor = admin;

    const partial = `shadow_activity_partial_${randomBytes(6).toString("hex")}`;
    process.env.MONGODB_SHADOW_NAMESPACE = partial;
    const legacy = client.db(databaseName).collection(`${partial}_LegacyOnly`);
    await client.db(databaseName).createCollection(legacy.collectionName, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    await legacy.createIndex({ marker: 1 }, { unique: true, name: "marker_unique" }); await legacy.insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName);
    actor = null;
    assert.equal((await adminGET(new Request("https://synthetic.invalid/api/admin/activity"))).status, 403);
    assert.equal((await usageGET(new Request("https://synthetic.invalid/api/admin/activity/usage"))).status, 403);
    actor = admin;
    assert.equal((await adminGET(new Request("https://synthetic.invalid/api/admin/activity?requestId=invalid"))).status, 400);
    assert.equal((await usageGET(new Request("https://synthetic.invalid/api/admin/activity/usage?date=invalid"))).status, 400);
    assert.equal((await feedGET(new Request("https://synthetic.invalid/api/activity-feed?period=invalid", { headers: { authorization: `Bearer ${token}` } }))).status, 400);
    assert.equal((await feedGET(new Request("https://synthetic.invalid/api/activity-feed", { headers: { authorization: "Bearer wrong" } }))).status, 401);
    const failedAdmin = await adminGET(new Request("https://synthetic.invalid/api/admin/activity"));
    assert.equal(failedAdmin.status, 503);
    assert.deepEqual(await failedAdmin.json(), { error: "활동 기록을 불러오지 못했습니다. DB 연결과 마이그레이션 적용 상태를 확인하세요." });
    const failedUsage = await usageGET(new Request("https://synthetic.invalid/api/admin/activity/usage"));
    assert.equal(failedUsage.status, 503);
    const failedFeed = await feedGET(new Request("https://synthetic.invalid/api/activity-feed", { headers: { authorization: `Bearer ${token}` } }));
    assert.equal(failedFeed.status, 503);
    assert.deepEqual(await snapshot(client, databaseName), before); assert.equal(pgCalls, 0);
  } finally {
    actor = admin; try { await client.db(databaseName).dropDatabase(); } catch {} await client.close();
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
