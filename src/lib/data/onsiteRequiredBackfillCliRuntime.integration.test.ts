import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import { MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS, prepareMongoAdminMaintenanceRuntime } from "./mongoAdminMaintenanceRuntime";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { runOnsiteRequiredBackfillCli } from "./onsiteRequiredBackfillCliRuntime";

const uri = process.env.MONGODB_ONSITE_BACKFILL_CLI_RUNTIME_URI;
test("explicit onsite backfill CLI dry-runs and applies only in a prepared Mongo shadow", { skip: !uri, timeout: 120_000 }, async () => {
  const parsed = new URL(uri!); assert.equal(parsed.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)); assert.ok(parsed.port); assert.equal(parsed.username, ""); assert.equal(parsed.password, "");
  const names = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const, saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "onsite-cli"; process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ "onsite-cli": randomBytes(32).toString("base64") }); process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const databaseName = `hub_om_shadow_onsite_cli_${randomBytes(5).toString("hex")}`, namespace = "shadow_onsite_cli";
  const partialDatabaseName = `hub_om_shadow_onsite_cli_partial_${randomBytes(4).toString("hex")}`;
  const control = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 }); let connected = false, ownsDatabase = false, ownsPartial = false;
  try {
    await control.connect(); connected = true;
    const databases = () => control.db("admin").admin().listDatabases({ nameOnly: true });
    assert.equal((await databases()).databases.some(row => row.name === databaseName), false); ownsDatabase = true;
    const options = { client: control, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoAdminMaintenanceRuntime(options);
    const store = new MongoOperationStore(options, MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS);
    const rows = [
      coachFixtureRow("OperationSession", { id: randomUUID(), operationId: "synthetic-onsite-n", onsiteRequired: "N", deletedAt: null }),
      coachFixtureRow("OperationSession", { id: randomUUID(), operationId: "synthetic-onsite-y", onsiteRequired: "Y", deletedAt: null }),
      coachFixtureRow("OperationSession", { id: randomUUID(), operationId: "synthetic-onsite-deleted", onsiteRequired: "N", deletedAt: new Date("2020-01-01T00:00:00.000Z") }),
    ];
    await store.collection("OperationSession").insertMany(rows.map(row => encodeMongoRuntimeDocument("OperationSession", row)));
    let loaded = 0;
    const env = { MONGODB_URI: uri, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace };
    const beforeDryRun = {
      sessions: await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(),
      changes: await store.collection("ActivityChange").find({}).sort({ _id: 1 }).toArray(),
    };
    assert.deepEqual(await runOnsiteRequiredBackfillCli(["--backend=mongodb-shadow"], env, () => { loaded++; }), { apply: false, targetCount: 1, updatedCount: 0 });
    assert.deepEqual({ sessions: await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), changes: await store.collection("ActivityChange").find({}).sort({ _id: 1 }).toArray() }, beforeDryRun);
    assert.deepEqual(await runOnsiteRequiredBackfillCli(["--apply", "--backend=mongodb-shadow"], env, () => { loaded++; }), { apply: true, targetCount: 1, updatedCount: 1 });
    assert.deepEqual(await runOnsiteRequiredBackfillCli(["--apply", "--backend=mongodb-shadow"], env, () => { loaded++; }), { apply: true, targetCount: 0, updatedCount: 0 });
    const logical = await store.scan("OperationSession", {}, undefined);
    assert.equal(logical.find(row => row.operationId === "synthetic-onsite-n")?.onsiteRequired, "Y");
    assert.equal(logical.find(row => row.operationId === "synthetic-onsite-deleted")?.onsiteRequired, "N");
    assert.equal(await store.collection("ActivityChange").countDocuments(), 0); assert.equal(loaded, 0);

    assert.equal((await databases()).databases.some(row => row.name === partialDatabaseName), false); ownsPartial = true;
    const partialOptions = { client: control, databaseName: partialDatabaseName, namespace, allowShadowWrites: true as const };
    const partialStore = new MongoOperationStore(partialOptions, MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS), partial = partialStore.collection("OperationSession");
    await partial.insertOne({ _id: "partial-runtime-marker", marker: "unchanged" });
    const before = {
      metadata: await control.db(partialDatabaseName).listCollections({ name: partial.collectionName }).next(),
      indexes: await partial.listIndexes().toArray(), documents: await partial.find({}).toArray(),
    };
    await assert.rejects(runOnsiteRequiredBackfillCli(["--apply", "--backend=mongodb-shadow"], { ...env, MONGODB_SHADOW_DATABASE: partialDatabaseName }, () => { loaded++; }), /^Error: ONSITE_REQUIRED_BACKFILL_FAILED$/);
    assert.deepEqual({ metadata: await control.db(partialDatabaseName).listCollections({ name: partial.collectionName }).next(), indexes: await partial.listIndexes().toArray(), documents: await partial.find({}).toArray() }, before);
    assert.equal((await control.db(partialDatabaseName).listCollections().toArray()).length, 1); assert.equal(loaded, 0);
  } finally {
    try { if (connected && ownsDatabase) await control.db(databaseName).dropDatabase(); if (connected && ownsPartial) await control.db(partialDatabaseName).dropDatabase(); }
    finally { if (connected) await control.close(); for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
  }
});
