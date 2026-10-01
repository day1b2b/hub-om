import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import { runCoachTokenBackfillCli } from "./coachTokenBackfillCliRuntime";
import { coachTokenBackfillFixtures, expectedTokenBackfillApply, expectedTokenBackfillDryRun, expectedTokenBackfillRerun } from "./coachTokenBackfillFixtures";
import { COACH_TOKEN_BACKFILL_MODELS, prepareMongoCoachTokenBackfillStore } from "./mongoCoachTokenBackfillRepository";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_COACH_TOKEN_BACKFILL_CLI_TEST_URI;
async function snapshotNamespace(client: MongoClient, databaseName: string, prefix: string) {
  const result: Record<string, unknown> = {};
  const collections = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray())
    .filter(info => info.name.startsWith(prefix)).sort((a, b) => a.name.localeCompare(b.name));
  for (const info of collections) {
    const collection = client.db(databaseName).collection(info.name);
    result[info.name] = { info, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return result;
}

test("coach token backfill real CLI selector uses only a prepared Mongo shadow", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_token_cli_${randomBytes(8).toString("hex")}`;
  const namespace = `shadow_token_cli_${randomBytes(8).toString("hex")}`;
  const names = ["DATABASE_URL", "MONGODB_URI", "MONGODB_SHADOW_DATABASE", "MONGODB_SHADOW_NAMESPACE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  try {
    delete process.env.DATABASE_URL;
    Object.assign(process.env, {
      MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace,
      PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
      PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    });
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoCoachTokenBackfillStore(options);
    const store = new MongoOperationStore(options, COACH_TOKEN_BACKFILL_MODELS);
    for (const [model, rows] of coachTokenBackfillFixtures()) if (rows.length) await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    const args = ["--backend=mongodb-shadow"];
    assert.deepEqual((await runCoachTokenBackfillCli(args, process.env, () => { throw new Error("PG env must not load"); })).summary, expectedTokenBackfillDryRun);
    const apply = ["--apply", "--backup-confirmed", "--maintenance-confirmed", ...args];
    assert.deepEqual((await runCoachTokenBackfillCli(apply, process.env, () => { throw new Error("PG env must not load"); })).summary, expectedTokenBackfillApply);
    const applied = await Promise.all(COACH_TOKEN_BACKFILL_MODELS.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray()));
    assert.deepEqual((await runCoachTokenBackfillCli(apply, process.env, () => { throw new Error("PG env must not load"); })).summary, expectedTokenBackfillRerun);
    assert.deepEqual(await Promise.all(COACH_TOKEN_BACKFILL_MODELS.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray())), applied);
    const raw = JSON.stringify(applied); assert.equal(raw.includes("synthetic-fallback-token"), false); assert.equal(raw.includes("synthetic-same-token"), false);

    const partial = `shadow_partial_${randomBytes(6).toString("hex")}`;
    await client.db(databaseName).createCollection(`${partial}_LegacyOnly`, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    const collection = client.db(databaseName).collection(`${partial}_LegacyOnly`);
    await collection.createIndex({ marker: 1 }, { unique: true, name: "legacy_marker_unique" });
    await collection.insertOne({ marker: "unchanged" });
    const before = await snapshotNamespace(client, databaseName, `${partial}_`);
    process.env.MONGODB_SHADOW_NAMESPACE = partial;
    await assert.rejects(runCoachTokenBackfillCli(args, process.env, () => {}), /^Error: COACH_TOKEN_BACKFILL_FAILED$/);
    assert.deepEqual(await snapshotNamespace(client, databaseName, `${partial}_`), before);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close();
    for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
