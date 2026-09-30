import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { runActivityPruneCli } from "./activityPruneCliRuntime";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MONGO_OPERATIONAL_RUNTIME_MODELS, prepareMongoOperationalRuntime } from "./mongoOperationalRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_ACTIVITY_PRUNE_CLI_RUNTIME_URI;
test("explicit activity prune CLI opens only a prepared Mongo shadow and deletes bounded expired rows", { skip: !uri, timeout: 120_000 }, async () => {
  const parsed = new URL(uri!); assert.equal(parsed.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)); assert.ok(parsed.port); assert.equal(parsed.username, ""); assert.equal(parsed.password, "");
  const names = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const, saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "prune-cli"; process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ "prune-cli": randomBytes(32).toString("base64") }); process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const databaseName = `hub_om_shadow_prune_cli_${randomBytes(6).toString("hex")}`, namespace = "shadow_prune_cli";
  const partialDatabaseName = `hub_om_shadow_prune_cli_partial_${randomBytes(4).toString("hex")}`;
  const control = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 }); let connected = false, ownsDatabase = false, ownsPartialDatabase = false;
  try {
    await control.connect(); connected = true; assert.equal((await control.db("admin").admin().listDatabases({ nameOnly: true })).databases.some(row => row.name === databaseName), false); ownsDatabase = true;
    const options = { client: control, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoOperationalRuntime(options);
    const store = new MongoOperationStore(options, MONGO_OPERATIONAL_RUNTIME_MODELS), old = new Date("2000-01-01T00:00:00.000Z");
    await store.collection("ActivityRequest").insertOne(encodeMongoRuntimeDocument("ActivityRequest", coachFixtureRow("ActivityRequest", { id: randomUUID(), occurredAt: old })));
    await store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", coachFixtureRow("ActivityChange", { id: randomUUID(), occurredAt: old })));
    let loaded = 0, output: unknown;
    const result = await runActivityPruneCli(["--backend=mongodb-shadow"], { MONGODB_URI: uri, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace }, () => { loaded++; }, value => { output = value; });
    assert.deepEqual(result, { deletedRequests: 1, deletedChanges: 1 }); assert.deepEqual(output, result); assert.equal(loaded, 0);
    assert.equal(await store.collection("ActivityRequest").countDocuments(), 0); assert.equal(await store.collection("ActivityChange").countDocuments(), 0);
    await assert.rejects(runActivityPruneCli(["--backend=mongodb-shadow"], { MONGODB_URI: uri, MONGODB_SHADOW_DATABASE: databaseName }, () => { loaded++; }), /ACTIVITY_PRUNE_FAILED/); assert.equal(loaded, 0);
    const absent = `hub_om_shadow_prune_cli_absent_${randomBytes(4).toString("hex")}`;
    await assert.rejects(runActivityPruneCli(["--backend=mongodb-shadow"], { MONGODB_URI: uri, MONGODB_SHADOW_DATABASE: absent, MONGODB_SHADOW_NAMESPACE: namespace }, () => { loaded++; }), /ACTIVITY_PRUNE_FAILED/);
    assert.equal((await control.db(absent).listCollections().toArray()).length, 0);
    assert.equal((await control.db("admin").admin().listDatabases({ nameOnly: true })).databases.some(row => row.name === partialDatabaseName), false); ownsPartialDatabase = true;
    const partial = control.db(partialDatabaseName).collection(`${namespace}__unrelated`);
    await partial.insertOne({ marker: "unchanged" });
    const beforeCollections = (await control.db(partialDatabaseName).listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
    await assert.rejects(runActivityPruneCli(["--backend=mongodb-shadow"], { MONGODB_URI: uri, MONGODB_SHADOW_DATABASE: partialDatabaseName, MONGODB_SHADOW_NAMESPACE: namespace }, () => { loaded++; }), /ACTIVITY_PRUNE_FAILED/);
    assert.deepEqual((await control.db(partialDatabaseName).listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort(), beforeCollections);
    assert.deepEqual(await partial.findOne({}, { projection: { _id: 0 } }), { marker: "unchanged" });
    await control.db("admin").command({ ping: 1 });
  } finally { try { if (connected && ownsDatabase) await control.db(databaseName).dropDatabase(); if (connected && ownsPartialDatabase) await control.db(partialDatabaseName).dropDatabase(); } finally { if (connected) await control.close(); for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
});
