import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { activityContext } from "../activity/context";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoCoachTokenRotationRepository, prepareMongoCoachTokenRotationStore, COACH_TOKEN_ROTATION_MODELS } from "./mongoCoachTokenRotationRepository";
import { MongoCoachTokenRepository, prepareMongoCoachTokenStore } from "./mongoCoachTokenRepository";
import { MongoOperationStore, operationMongoValidator } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_COACH_ACCESS_TEST_URI;
test("Native token rotation: old/new lookup, ciphertext/index, unique and audit rollback, concurrent deletion", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5_000, monitorCommands: true });
  const databaseName = `hub_om_shadow_coach_rotation_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName, namespace: `shadow_rotation_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"], saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const activity = { requestId: "00000000-0000-4000-8000-000000000001", route: "/api/coaches/synthetic/regenerate-token", method: "POST", actorEmail: "actor@example.invalid", actorName: "Synthetic actor", actorType: "user" as const };
  let connected = false, observe = false;
  const commands: string[] = []; client.on("commandStarted", event => { if (observe) commands.push(event.commandName); });
  try {
    await client.connect(); connected = true;
    await assert.rejects(MongoCoachTokenRotationRepository.open({ ...options, allowShadowWrites: false } as never), /SHADOW_WRITE_GATE/);
    await assert.rejects(MongoCoachTokenRotationRepository.open(options), /VALIDATOR_NOT_READY/);
    await prepareMongoCoachTokenRotationStore(options); await prepareMongoCoachTokenStore(options);
    observe = true; const repository = await MongoCoachTokenRotationRepository.open(options); observe = false;
    assert.ok(commands.includes("hello")); assert.ok(!commands.some(command => ["create", "insert", "update", "collMod", "createIndexes"].includes(command)));
    const lookup = await MongoCoachTokenRepository.open(options), store = new MongoOperationStore(options, COACH_TOKEN_ROTATION_MODELS);
    const row = coachFixtureRow("Coach", { name: "Synthetic rotation coach", accessToken: "synthetic-old-token", isActive: true, deletedAt: null });
    const collision = coachFixtureRow("Coach", { name: "Synthetic collision coach", accessToken: "synthetic-collision-token", isActive: true, deletedAt: null });
    const deleted = coachFixtureRow("Coach", { name: "Synthetic deleted coach", accessToken: "synthetic-deleted-token", deletedAt: new Date() });
    await store.collection("Coach").insertMany([row, collision, deleted].map(value => encodeMongoRuntimeDocument("Coach", value)));
    const id = row.id as string; assert.ok(await lookup.findByToken(row.accessToken as string));
    const rotated = await activityContext.run(activity, () => repository.regenerateToken(id)); assert.ok(rotated); assert.match(rotated.accessToken, /^[a-f0-9]{64}$/);
    assert.equal(await lookup.findByToken(row.accessToken as string), null); assert.ok(await lookup.findByToken(rotated.accessToken));
    const raw = await store.collection("Coach").findOne({ _id: id }); assert.ok(raw); assert.ok(!JSON.stringify(raw).includes(rotated.accessToken));
    assert.equal(raw.accessTokenPiiIndex, mongoRuntimeBlindIndex("Coach", "accessToken", rotated.accessToken));
    const auditRaw = await store.collection("ActivityChange").findOne({ targetId: id }); assert.ok(auditRaw);
    assert.deepEqual((decodeMongoRuntimeDocument("ActivityChange", auditRaw).changes as Record<string, unknown>).access_token, { redacted: true });
    assert.ok(!JSON.stringify(auditRaw).includes(rotated.accessToken)); assert.ok(!JSON.stringify(auditRaw).includes(activity.actorEmail));
    // Control only the private randomness seam; the public API has no caller-provided token option.
    const forced = mock.method(repository as unknown as { generateToken(): string }, "generateToken", () => collision.accessToken as string);
    try {
      await assert.rejects(activityContext.run(activity, () => repository.regenerateToken(id)), /COACH_TOKEN_ROTATION_FAILED/);
      assert.deepEqual(await store.collection("Coach").findOne({ _id: id }), raw); assert.equal(await store.collection("ActivityChange").countDocuments(), 1);
      assert.ok(await lookup.findByToken(rotated.accessToken)); assert.ok(await lookup.findByToken(collision.accessToken as string));
    } finally { forced.mock.restore(); }
    await store.db.command({ collMod: store.collection("ActivityChange").collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { targetId: { $ne: id } }] } });
    try {
      await assert.rejects(activityContext.run(activity, () => repository.regenerateToken(id)), /COACH_TOKEN_ROTATION_FAILED/);
      assert.deepEqual(await store.collection("Coach").findOne({ _id: id }), raw); assert.equal(await store.collection("ActivityChange").countDocuments(), 1); assert.ok(await lookup.findByToken(rotated.accessToken));
    } finally { await store.db.command({ collMod: store.collection("ActivityChange").collectionName, validator: operationMongoValidator("ActivityChange") }); }
    assert.equal(await repository.regenerateToken(deleted.id as string), null); assert.equal(await lookup.findByToken(deleted.accessToken as string), null);
    // Force deletion to commit after the rotation snapshot read and before its replacement.
    const internalStore = (repository as unknown as { store: MongoOperationStore }).store;
    const originalOne = internalStore.one.bind(internalStore);
    let releaseRead!: () => void, readObserved!: () => void, first = true;
    const paused = new Promise<void>(resolve => { releaseRead = resolve; });
    const observed = new Promise<void>(resolve => { readObserved = resolve; });
    const hook = mock.method(internalStore, "one", async (...args: Parameters<typeof internalStore.one>) => {
      const found = await originalOne(...args);
      if (first) { first = false; readObserved(); await paused; }
      return found;
    });
    try {
      const pending = activityContext.run(activity, () => repository.regenerateToken(id));
      await observed;
      await store.collection("Coach").updateOne({ _id: id }, { $set: { deletedAt: new Date() } });
      releaseRead();
      assert.equal(await pending, null, "Snapshot conflict must retry and observe the committed deletion");
      const after = await store.one("Coach", { _id: id }); assert.equal(after!.accessToken, rotated.accessToken); assert.ok(after!.deletedAt);
      assert.equal(await lookup.findByToken(rotated.accessToken), null); assert.equal(await store.collection("ActivityChange").countDocuments(), 1);
    } finally { releaseRead(); hook.mock.restore(); }
    // Two authorized rotations can both complete; only the last committed token remains valid.
    const concurrentRow = coachFixtureRow("Coach", { name: "Synthetic concurrent rotation", accessToken: "synthetic-concurrent-old", deletedAt: null, isActive: true });
    await store.collection("Coach").insertOne(encodeMongoRuntimeDocument("Coach", concurrentRow));
    const concurrentId = concurrentRow.id as string;
    const results = await Promise.all([
      activityContext.run(activity, () => repository.regenerateToken(concurrentId)),
      activityContext.run(activity, () => repository.regenerateToken(concurrentId))
    ]);
    assert.ok(results[0] && results[1]); assert.notEqual(results[0].accessToken, results[1].accessToken);
    const committedToken = (await store.one("Coach", { _id: concurrentId }))!.accessToken;
    const authenticated = await Promise.all(results.map(result => lookup.findByToken(result!.accessToken)));
    assert.equal(authenticated.filter(Boolean).length, 1, "Only one of the concurrent rotation responses may remain valid");
    const survivingIndex = authenticated.findIndex(Boolean);
    assert.equal(results[survivingIndex]!.accessToken, committedToken);
    assert.equal(await lookup.findByToken(concurrentRow.accessToken as string), null);
    assert.equal(await store.collection("ActivityChange").countDocuments({ targetId: concurrentId }), 2);

  } finally {
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally { try { await client.close(); } finally { for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
