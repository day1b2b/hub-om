/** Opt-in actual Mongo replica-set validation. No external source or PostgreSQL access. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { BSON, MongoClient, type CommandStartedEvent, type Db } from "mongodb";
import type { MongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_OPERATIONAL_RUNTIME_URI;
const enabled = typeof uri === "string" && uri.length > 0;

test("one operational runtime prepares, reopens and isolates one explicit namespace", { skip: !enabled, timeout: 180_000 }, async () => {
  const parsed = new URL(uri!);
  assert.equal(parsed.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.ok(parsed.port); assert.equal(parsed.username, ""); assert.equal(parsed.password, "");
  assert.ok(parsed.pathname === "" || parsed.pathname === "/");
  const databaseName = `hub_om_shadow_oprt_${randomBytes(10).toString("hex")}`;
  const envNames = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const savedEnvironment = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "runtime-synthetic";
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ "runtime-synthetic": randomBytes(32).toString("base64") });
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";

  const [{ prepareMongoOperationalRuntime, MONGO_OPERATIONAL_RUNTIME_MODELS }, context, fixtures, codec] = await Promise.all([
    import("./mongoOperationalRuntime"),
    import("./dataRepositoryContext"),
    import("./mongoCoachFixtures"),
    import("./mongoRuntimeCodec"),
  ]);
  const client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const writes: CommandStartedEvent[] = [];
  const mutatingCommands = new Set([
    "create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes",
    "findAndModify", "bulkWrite", "renameCollection", "convertToCapped", "emptycapped", "mapReduce",
  ]);
  client.on("commandStarted", event => {
    if (mutatingCommands.has(event.commandName)) writes.push(event);
  });
  const namespace = `shadow_runtime_${randomBytes(5).toString("hex")}`;
  const secondNamespace = `${namespace}_second`;
  const partialNamespace = `${namespace}_partial`;
  const foreignNamespace = `${namespace}_foreign`;
  let connected = false, ownsDatabase = false, closeCalls = 0;
  const realClose = client.close.bind(client);
  Object.defineProperty(client, "close", { configurable: true, value: async (...args: Parameters<MongoClient["close"]>) => {
    closeCalls++; return await realClose(...args);
  } });
  const expectedNames = (value: string) => new Set([
    ...MONGO_OPERATIONAL_RUNTIME_MODELS.map(model => `${value}_${model}`), `${value}_CoachSchedulingGuard`,
  ]);
  async function snapshot(value: string): Promise<string> {
    const names = expectedNames(value);
    const infos = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray())
      .filter(info => names.has(info.name)).sort((a, b) => a.name.localeCompare(b.name));
    const rows = [];
    for (const info of infos) rows.push({ name: info.name, type: info.type, options: info.options,
      indexes: await client.db(databaseName).collection(info.name).listIndexes().toArray(),
      documents: await client.db(databaseName).collection(info.name).find({}).sort({ _id: 1 }).toArray() });
    return BSON.EJSON.stringify(rows, { relaxed: false });
  }
  try {
    await client.connect(); connected = true;
    const databases = await client.db("admin").admin().listDatabases({ nameOnly: true });
    assert.equal(databases.databases.some(database => database.name === databaseName), false);
    ownsDatabase = true;
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    const second = await prepareMongoOperationalRuntime({ ...options, namespace: secondNamespace });
    // Longer namespace first proves exact collection ownership, not prefix matching.
    const first = await prepareMongoOperationalRuntime(options);
    assert.equal(first.repositories.requestActivity, first.repositories.coachPrivateAccessLog);
    let forbiddenCallbacks = 0;
    assert.throws(() => first.run(() => second.run(() => { forbiddenCallbacks++; })), /CALENDAR_SCOPE_MISMATCH/);
    assert.throws(() => context.runWithDataRepositories({ requestActivity: first.repositories.requestActivity },
      () => { forbiddenCallbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
    assert.throws(() => context.runWithDataRepositories({ ...first.repositories, activityPrune: second.repositories.activityPrune },
      () => { forbiddenCallbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
    assert.equal(forbiddenCallbacks, 0);
    await first.repositories.databaseHealth.check();
    const coach = fixtures.coachFixtureRow("Coach", {
      name: "Synthetic Runtime Coach", normalizedName: "synthetic runtime coach", status: "ACTIVE", isActive: true,
    });
    await client.db(databaseName).collection<MongoRuntimeDocument>(`${namespace}_Coach`).insertOne(codec.encodeMongoRuntimeDocument("Coach", coach));
    await Promise.all([first.run(async () => {
      assert.equal(context.getDataRepositoryOverride("adminBackup"), first.repositories.adminBackup);
      assert.equal(context.getDataRepositoryOverride("activityPrune"), first.repositories.activityPrune);
      assert.equal(context.getDataRepositoryOverride("requestActivity"), first.repositories.requestActivity);
      assert.equal(context.getDataRepositoryOverride("coachPrivateAccessLog"), first.repositories.coachPrivateAccessLog);
      await first.repositories.requestActivity.recordRequest({
        requestId: randomUUID(), route: "/synthetic/runtime", method: "GET",
        actorEmail: "runtime@synthetic.invalid", actorName: "Synthetic Runtime Person", actorType: "user",
      }, 200, 7);
      await first.repositories.coachPrivateAccessLog.recordAccess(
        String(coach.id), "private-viewer@synthetic.invalid", "synthetic-runtime-private-access");
    }), second.run(() => second.repositories.requestActivity.recordRequest({
      requestId: randomUUID(), route: "/synthetic/runtime-second", method: "GET",
      actorEmail: "second@synthetic.invalid", actorName: "Second Synthetic Person", actorType: "user",
    }, 204, 9))]);
    const backup = await first.repositories.adminBackup.read();
    assert.equal(backup.coaches.length, 1);
    assert.equal(await client.db(databaseName).collection(`${namespace}_CoachPrivateAccessLog`).countDocuments({ coachId: coach.id }), 1);
    assert.deepEqual(await first.repositories.activityPrune.pruneBatch(), { requests: 0, changes: 0 });

    const beforeReopen = await snapshot(namespace);
    writes.length = 0;
    const reopened = await prepareMongoOperationalRuntime(options);
    await reopened.repositories.databaseHealth.check();
    assert.deepEqual(writes.map(event => event.commandName), []);
    assert.equal(await snapshot(namespace), beforeReopen);

    const stored = await client.db(databaseName).collection(`${namespace}_ActivityRequest`).findOne({});
    assert.ok(stored);
    assert.notEqual(stored.actorEmail, "runtime@synthetic.invalid");
    assert.notEqual(stored.actorName, "Synthetic Runtime Person");
    assert.doesNotMatch(JSON.stringify(stored), /runtime@synthetic\.invalid|Synthetic Runtime Person/);
    assert.equal(await client.db(databaseName).collection(`${namespace}_ActivityRequest`).countDocuments(), 1);
    assert.equal(await client.db(databaseName).collection(`${secondNamespace}_ActivityRequest`).countDocuments(), 1);
    assert.equal(await client.db(databaseName).collection(`${namespace}_ActivityRequest`).countDocuments({ route: "/synthetic/runtime-second" }), 0);
    assert.equal(await client.db(databaseName).collection(`${secondNamespace}_ActivityRequest`).countDocuments({ route: "/synthetic/runtime" }), 0);

    // Inject an actual prepare failure after multiple collection creates.
    const failedNamespace = `${namespace}_failed`;
    const originalDb = client.db.bind(client);
    let creates = 0;
    Object.defineProperty(client, "db", { configurable: true, value: (name?: string, settings?: Parameters<MongoClient["db"]>[1]) => {
      const db = originalDb(name, settings);
      const create = db.createCollection.bind(db);
      Object.defineProperty(db, "createCollection", { configurable: true, value: async (...args: Parameters<Db["createCollection"]>) => {
        creates++;
        if (creates === 3) throw new Error("synthetic prepare interruption canary");
        return await create(...args);
      } });
      return db;
    } });
    await assert.rejects(prepareMongoOperationalRuntime({ ...options, namespace: failedNamespace }),
      /^Error: MONGO_OPERATIONAL_RUNTIME_FAILED$/);
    Object.defineProperty(client, "db", { configurable: true, value: originalDb });
    assert.ok(creates >= 3);
    const failedBeforeRetry = await snapshot(failedNamespace);
    assert.notEqual(failedBeforeRetry, BSON.EJSON.stringify([], { relaxed: false }));
    writes.length = 0;
    await assert.rejects(prepareMongoOperationalRuntime({ ...options, namespace: failedNamespace }),
      /^Error: MONGO_OPERATIONAL_RUNTIME_FAILED$/);
    assert.deepEqual(writes.map(event => event.commandName), []);
    assert.equal(await snapshot(failedNamespace), failedBeforeRetry);
    await client.db("admin").command({ ping: 1 });
    assert.equal(closeCalls, 0);

    await client.db(databaseName).createCollection(`${partialNamespace}_ActivityRequest`);
    const partialBefore = await snapshot(partialNamespace);
    writes.length = 0;
    await assert.rejects(prepareMongoOperationalRuntime({ ...options, namespace: partialNamespace }),
      /^Error: MONGO_OPERATIONAL_RUNTIME_FAILED$/);
    assert.deepEqual(writes.map(event => event.commandName), []);
    assert.equal(await snapshot(partialNamespace), partialBefore);
    await client.db("admin").command({ ping: 1 });
    assert.equal(closeCalls, 0);

    // A known collection owned by another runtime also makes the namespace non-empty.
    const foreignName = `${foreignNamespace}_Company`;
    await client.db(databaseName).createCollection(foreignName);
    await client.db(databaseName).collection(foreignName).insertOne({ synthetic: "foreign-runtime-canary" });
    const foreignSnapshot = BSON.EJSON.stringify({
      info: await client.db(databaseName).listCollections({ name: foreignName }, { nameOnly: false }).toArray(),
      indexes: await client.db(databaseName).collection(foreignName).listIndexes().toArray(),
      documents: await client.db(databaseName).collection(foreignName).find({}).toArray(),
    }, { relaxed: false });
    writes.length = 0;
    await assert.rejects(prepareMongoOperationalRuntime({ ...options, namespace: foreignNamespace }),
      /^Error: MONGO_OPERATIONAL_RUNTIME_FAILED$/);
    assert.deepEqual(writes.map(event => event.commandName), []);
    assert.equal(BSON.EJSON.stringify({
      info: await client.db(databaseName).listCollections({ name: foreignName }, { nameOnly: false }).toArray(),
      indexes: await client.db(databaseName).collection(foreignName).listIndexes().toArray(),
      documents: await client.db(databaseName).collection(foreignName).find({}).toArray(),
    }, { relaxed: false }), foreignSnapshot);
  } finally {
    try { if (connected && ownsDatabase) await client.db(databaseName).dropDatabase(); }
    finally { if (connected) await realClose(); }
    for (const name of envNames) {
      const value = savedEnvironment.get(name);
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
