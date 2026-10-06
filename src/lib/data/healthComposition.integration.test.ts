import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_HEALTH_COMPOSITION_TEST_URI;
let pgCalls = 0;
mock.module("@prisma/adapter-pg", {
  namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_FORBIDDEN"); } } }
});
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier === "next/server" ? "next/server.js" : specifier, context);
  }
});
const { GET } = await import("../../app/api/health/route");
hooks.deregister();

test("health route selects Mongo ping without creating collections", { skip: !uri, timeout: 30_000 }, async () => {
  const target = new URL(uri!);
  assert.equal(target.hostname, "127.0.0.1");
  assert.ok(target.port);
  const databaseName = `hub_om_shadow_health_${randomBytes(6).toString("hex")}`;
  const environment = {
    HEALTH_BACKEND: "mongodb-shadow",
    MONGODB_URI: uri!,
    MONGODB_SHADOW_DATABASE: databaseName,
    MONGODB_SHADOW_NAMESPACE: `shadow_health_${randomBytes(6).toString("hex")}`,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ALLOW_PLAINTEXT_READS: "false"
  };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });
  try {
    await client.connect();
    const response = await GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, database: "connected" });
    assert.equal(pgCalls, 0);
    assert.deepEqual(await client.db(databaseName).listCollections().toArray(), []);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
