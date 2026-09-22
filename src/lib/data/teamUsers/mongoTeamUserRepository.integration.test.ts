import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Long, MongoClient } from "mongodb";
import { encodeMongoRuntimeDocument } from "../mongoRuntimeCodec";
import { MongoOperationStore, operationMongoValidator } from "../mongoOperationStore";
import { DuplicateTeamUserEmailError } from "./teamUserRepository";
import { MONGO_TEAM_USER_MODELS, MongoTeamUserRepository, prepareMongoTeamUserStore } from "./mongoTeamUserRepository";
const uri = process.env.MONGODB_TEAM_USER_TEST_URI;

test("TeamUser native transactions: concurrent normalized create, merged updates, rollback, guards and encrypted rows", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5_000, monitorCommands: true });
  const databaseName = `hub_om_shadow_team_user_${randomBytes(10).toString("hex")}`;
  const options = { client, databaseName, namespace: `shadow_test_${randomBytes(10).toString("hex")}`, allowShadowWrites: true as const };
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  let connected = false, monitorReads = false;
  const commands: string[] = [];
  let rollbackCollection: string | null = null;
  const rollbackUpdates: string[] = [];
  client.on("commandStarted", event => {
    if (monitorReads) commands.push(event.commandName);
    if (rollbackCollection && event.commandName === "update" && event.command.update === rollbackCollection) rollbackUpdates.push(String(event.command.updates[0].q._id));
  });
  try {
    await client.connect(); connected = true;
    await assert.rejects(MongoTeamUserRepository.open(options));
    await prepareMongoTeamUserStore(options); await prepareMongoTeamUserStore(options);
    monitorReads = true;
    const repository = await MongoTeamUserRepository.open(options), second = await MongoTeamUserRepository.open(options);
    assert.deepEqual(await repository.listTeamUsers(), []);
    monitorReads = false;
    assert.ok(commands.includes("find"));
    assert.deepEqual(commands.filter(command => ["insert", "update", "delete", "create", "collMod", "createIndexes", "findAndModify"].includes(command)), []);
    const base = { name: "Synthetic Team name", email: "user@example.invalid", slackId: "Synthetic slack" };
    const attempts = await Promise.allSettled(["user@example.invalid", " USER@EXAMPLE.INVALID ", "User@example.invalid", "user@EXAMPLE.invalid"].map((email, i) => (i % 2 ? repository : second).createTeamUser({ ...base, email })));
    const successes = attempts.filter(result => result.status === "fulfilled");
    assert.equal(successes.length, 1, "Shared guard must prevent duplicates even when roster starts empty");
    for (const failure of attempts.filter(result => result.status === "rejected")) {
      assert.ok(failure.reason instanceof DuplicateTeamUserEmailError); assert.deepEqual(failure.reason.existingNames, []); assert.ok(!String(failure.reason).includes("@"));
    }
    const created = (await repository.listTeamUsers())[0];
    assert.equal((await repository.findTeamUsersByEmail(" USER@example.INVALID ")).length, 1);
    const store = new MongoOperationStore(options, MONGO_TEAM_USER_MODELS);
    const doc = await store.collection("TeamUser").findOne({ _id: created.id }); assert.ok(doc);
    assert.ok(!JSON.stringify(doc).includes("@example.invalid")); assert.ok(!JSON.stringify(doc).includes(base.name)); assert.ok(!JSON.stringify(doc).includes(base.slackId));
    await Promise.all([repository.updateTeamUserTeam(created.id, "AX 2파트"), second.updateTeamUsersRole([created.id], "ld")]);
    const merged = (await repository.listTeamUsers())[0]; assert.equal(merged.team, "AX 2파트"); assert.equal(merged.role, "ld");
    assert.equal(await repository.updateTeamUsersRole([created.id, created.id, randomUUID()], "om"), 1);
    assert.equal(await repository.updateTeamUserTeam(randomUUID(), null), null);
    // Preserve legacy uppercase/whitespace forms and reject a normalized duplicate against them.
    const legacyId = randomUUID();
    await store.collection("TeamUser").insertOne(encodeMongoRuntimeDocument("TeamUser", { id: legacyId, name: "Synthetic legacy", email: " Legacy@EXAMPLE.INVALID ", slackId: "", team: null, role: null, createdAt: new Date() }));
    await assert.rejects(repository.createTeamUser({ ...base, email: "legacy@example.invalid" }), DuplicateTeamUserEmailError);
    // Force a later replacement to fail at the server; the complete batch and first guard write must roll back.
    const before = await store.collection("TeamUser").find().sort({ _id: 1 }).toArray();
    const guard = store.db.collection<{ _id: string; version: Long }>(`${options.namespace}___teamUserWriteGuard`, { promoteLongs: false });
    const beforeGuard = await guard.findOne({ _id: "TeamUser" });
    const rejectedId = (await store.scan("TeamUser", { _id: { $in: [created.id, legacyId] } })).at(-1)!.id;
    await store.db.command({ collMod: store.collection("TeamUser").collectionName, validator: { $and: [operationMongoValidator("TeamUser"), { $or: [{ _id: { $ne: rejectedId } }, { role: { $ne: "LD" } }] }] } });
    try {
      rollbackCollection = store.collection("TeamUser").collectionName;
      await assert.rejects(repository.updateTeamUsersRole([created.id, legacyId], "ld"), /TEAM_USER_ACCESS_FAILED/);
      rollbackCollection = null;
      assert.equal(rollbackUpdates.length, 2, "Failure must occur after one earlier row replacement was submitted");
      assert.equal(rollbackUpdates.at(-1), rejectedId);
      assert.deepEqual(await store.collection("TeamUser").find().sort({ _id: 1 }).toArray(), before);
      assert.deepEqual(await guard.findOne({ _id: "TeamUser" }), beforeGuard);
    } finally { rollbackCollection = null; await store.db.command({ collMod: store.collection("TeamUser").collectionName, validator: operationMongoValidator("TeamUser") }); }
    const disabled = await MongoTeamUserRepository.open({ ...options, allowShadowWrites: undefined });
    await assert.rejects(disabled.createTeamUser(base), /SHADOW_WRITE_GATE/); await assert.rejects(disabled.updateTeamUserTeam(created.id, null), /SHADOW_WRITE_GATE/);
    await assert.rejects(repository.deleteTeamUsers([created.id]), /TEAM_USER_DELETE_POLICY_REQUIRED/);
    assert.equal((await repository.listTeamUsers()).length, 2);
    await guard.updateOne({ _id: "TeamUser" }, { $set: { version: Long.MAX_VALUE } });
    await assert.rejects(repository.updateTeamUserTeam(created.id, null), /TEAM_USER_GUARD_UNAVAILABLE/);
    await guard.deleteOne({ _id: "TeamUser" });
    await assert.rejects(MongoTeamUserRepository.open(options), /TEAM_USER_GUARD_NOT_READY/);
    await assert.rejects(repository.updateTeamUsersRole([created.id], "om"), /TEAM_USER_GUARD_UNAVAILABLE/);
  } finally {
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally { try { await client.close(); } finally { for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
