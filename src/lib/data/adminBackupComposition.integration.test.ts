import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { prepareMongoAdminBackupStore } from "./mongoAdminBackupRepository";
import { prepareMongoRequestAuditStore } from "./mongoRequestAuditRepository";

const uri = process.env.MONGODB_ADMIN_BACKUP_COMPOSITION_TEST_URI;
let pgCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_FORBIDDEN"); } } } });
mock.module("@/auth", { namedExports: { auth: async () => { throw new Error("AUTH_FORBIDDEN"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(["next/server", "next/navigation"].includes(specifier) ? `${specifier}.js` : specifier, context);
} });
const { POST } = await import("../../app/api/admin/backup/route");
hooks.deregister();

async function snapshot(client: MongoClient, databaseName: string) {
  const value: Record<string, unknown> = {};
  const items = await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray();
  for (const item of items.sort((left, right) => left.name.localeCompare(right.name))) {
    const collection = client.db(databaseName).collection(item.name);
    value[item.name] = {
      options: item.options,
      indexes: await collection.listIndexes().toArray(),
      rows: await collection.find({}).sort({ _id: 1 }).toArray()
    };
  }
  return value;
}

test("admin backup route uses one prepared Mongo backup and audit scope", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const databaseName = `hub_om_shadow_backup_composition_${randomBytes(6).toString("hex")}`;
  const namespace = `shadow_backup_${randomBytes(6).toString("hex")}`;
  const secret = "synthetic-composition-secret";
  const environment = {
    ADMIN_BACKUP_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName,
    MONGODB_SHADOW_NAMESPACE: namespace, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    BACKUP_API_SECRET: secret, DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden"
  };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]])); Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoAdminBackupStore(options); await prepareMongoRequestAuditStore(options);
    const response = await POST(new Request("http://synthetic.invalid/api/admin/backup", {
      method: "POST", headers: { authorization: `Bearer ${secret}` }
    }));
    assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition") ?? "", /hub_om_coach_backup_/);
    const body = await response.json() as { counts: Record<string, number>; data: Record<string, unknown[]> };
    assert.ok(Object.values(body.counts).every(value => value === 0));
    assert.ok(Object.values(body.data).every(value => Array.isArray(value) && value.length === 0));
    assert.equal(await client.db(databaseName).collection(`${namespace}_ActivityRequest`).countDocuments(), 1);
    assert.equal(pgCalls, 0);

    const partial = `shadow_backup_partial_${randomBytes(6).toString("hex")}`;
    process.env.MONGODB_SHADOW_NAMESPACE = partial;
    const legacy = client.db(databaseName).collection(`${partial}_LegacyOnly`);
    await client.db(databaseName).createCollection(legacy.collectionName, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    await legacy.createIndex({ marker: 1 }, { unique: true, name: "marker_unique" }); await legacy.insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName);
    await assert.rejects(POST(new Request("http://synthetic.invalid/api/admin/backup", {
      method: "POST", headers: { authorization: `Bearer ${secret}` }
    })), /^Error: ADMIN_BACKUP_COMPOSITION_FAILED$/);
    assert.deepEqual(await snapshot(client, databaseName), before);
    assert.equal(pgCalls, 0);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close();
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
