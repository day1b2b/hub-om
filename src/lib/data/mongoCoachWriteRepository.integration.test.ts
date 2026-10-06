import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import { MongoCoachWriteRepository, COACH_WRITE_MODELS, prepareMongoCoachWriteStore } from "./mongoCoachWriteRepository";
import { MongoOperationStore, operationMongoValidator, stableMongoValue } from "./mongoOperationStore";

const uri = process.env.MONGODB_COACH_WRITE_TEST_URI;
/** Explicit disposable loopback replica only. Never reads MONGODB_URI or any env file. */
test("Mongo coach writes native: encrypted atomic CRUD, audit rollback, concurrent updates and shared tags", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const databaseName = `hub_om_shadow_coach_write_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName, namespace: `shadow_test_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  let connected = false, monitorOpen = false;
  const commands: string[] = [];
  client.on("commandStarted", event => { if (monitorOpen) commands.push(event.commandName); });
  try {
    await client.connect(); connected = true;
    await assert.rejects(MongoCoachWriteRepository.open(options), /VALIDATOR_NOT_READY/);
    await prepareMongoCoachWriteStore(options);
    monitorOpen = true; const repository = await MongoCoachWriteRepository.open(options); monitorOpen = false;
    assert.ok(commands.includes("hello")); assert.ok(commands.includes("listCollections"));
    assert.ok(!commands.some(command => ["insert", "update", "create", "collMod", "createIndexes"].includes(command)), "Opening must not write/prepare");
    const store = new MongoOperationStore(options, COACH_WRITE_MODELS);
    const created = await repository.createCoach({ name: "Synthetic Coach", email: "coach-write@example.invalid", phone: "010-0000-0000", fields: ["A", "A"], curriculums: ["First"] });
    const id = created.id, actor = { email: "manager@example.invalid", name: "Synthetic author" };
    assert.deepEqual(Object.keys(created).sort(), ["id", "name"]);
    assert.equal((await store.one("Coach", { _id: id }))?.normalizedName, "synthetic coach");
    assert.equal(await store.collection("CoachField").countDocuments({ coachId: id }), 1);
    assert.match((await store.one("Coach", { _id: id }))?.accessToken as string, /^[a-f0-9]{64}$/);
    await repository.updateCoach(id, { name: "Updated Coach", phone: null, managerNote: "Synthetic private note", fields: [] }, actor);
    assert.equal((await store.one("CoachPrivateProfile", { _id: id }))?.phone, null);
    assert.equal((await store.one("CoachPrivateProfile", { _id: id }))?.email, "coach-write@example.invalid");
    assert.equal(await store.collection("CoachField").countDocuments({ coachId: id }), 0);
    assert.equal(await store.collection("CoachCurriculum").countDocuments({ coachId: id }), 1);
    const audit = await store.one("CoachContentEntry", { coachId: id });
    assert.equal(audit?.content, "프로필 수정: name, managerNote, fields"); assert.equal(audit?.authorEmail, actor.email);
    for (const model of ["Coach", "CoachPrivateProfile", "CoachContentEntry"]) {
      const raw = JSON.stringify(await store.collection(model).find({}).toArray());
      for (const secret of ["Updated Coach", "coach-write@example.invalid", "Synthetic private note", actor.email]) assert.ok(!raw.includes(secret));
    }
    // Force the final insert to fail using a test-only stricter validator. The earlier
    // coach/profile/link/master modifications must all disappear after abort.
    const before = await Promise.all(COACH_WRITE_MODELS.map(async model => [model, stableMongoValue(await store.collection(model).find({}).sort({ _id: 1 }).toArray())]));
    const auditCollection = store.collection("CoachContentEntry").collectionName;
    await store.db.command({ collMod: auditCollection, validator: { $and: [operationMongoValidator("CoachContentEntry"), { sourceField: { $eq: "synthetic-reject-all" } }] }, validationLevel: "strict", validationAction: "error" });
    try {
      await assert.rejects(repository.updateCoach(id, { name: "Rollback name", email: "rollback@example.invalid", fields: ["Rollback tag"], curriculums: [] }, actor), /COACH_WRITE_FAILED/);
      const after = await Promise.all(COACH_WRITE_MODELS.map(async model => [model, stableMongoValue(await store.collection(model).find({}).sort({ _id: 1 }).toArray())]));
      assert.deepEqual(after, before, "Audit failure must roll back every changed model");
    } finally { await store.db.command({ collMod: auditCollection, validator: operationMongoValidator("CoachContentEntry"), validationLevel: "strict", validationAction: "error" }); }
    // Each retry re-reads a snapshot; disjoint concurrent patches cannot overwrite
    // one another with a stale whole-document replacement.
    await Promise.all([
      repository.updateCoach(id, { managerNote: "Concurrent note", phone: "010-1111-2222", fields: ["Concurrent field"] }, actor),
      repository.updateCoach(id, { workType: "Concurrent work", email: "concurrent@example.invalid", curriculums: ["Concurrent curriculum"] }, actor)
    ]);
    const concurrent = await store.one("Coach", { _id: id }), privateConcurrent = await store.one("CoachPrivateProfile", { _id: id });
    assert.equal(concurrent?.managerNote, "Concurrent note"); assert.equal(concurrent?.workType, "Concurrent work");
    assert.equal(privateConcurrent?.phone, "010-1111-2222"); assert.equal(privateConcurrent?.email, "concurrent@example.invalid");
    assert.equal(await store.collection("CoachContentEntry").countDocuments({ coachId: id }), 3);
    const shared = await Promise.all(Array.from({ length: 4 }, (_, index) => repository.createCoach({ name: `Concurrent ${index}`, fields: ["One shared master"] })));
    assert.equal(new Set(shared.map(row => row.id)).size, 4);
    assert.equal(await store.collection("CoachFieldMaster").countDocuments({ name: "One shared master" }), 1);
    const master = await store.one("CoachFieldMaster", { name: "One shared master" });
    assert.equal(await store.collection("CoachField").countDocuments({ tagId: master!.id }), 4);
    // Independent namespaces cannot see or modify each other's identifiers.
    const secondOptions = { ...options, namespace: `shadow_second_${randomBytes(8).toString("hex")}` };
    await prepareMongoCoachWriteStore(secondOptions); const second = await MongoCoachWriteRepository.open(secondOptions);
    await assert.rejects(second.updateCoachStatus(id, "inactive"), /COACH_NOT_FOUND/);
    assert.deepEqual(await repository.updateCoachStatus(id, "inactive"), { id, status: "inactive", isActive: true });
    // Raw tampering blocks writes without returning the offending value.
    const original = await store.collection("Coach").findOne({ _id: id }); assert.ok(original);
    const pieces = (original.name as string).split(":"); pieces[4] = (pieces[4][0] === "A" ? "B" : "A") + pieces[4].slice(1);
    await store.collection("Coach").updateOne({ _id: id }, { $set: { name: pieces.join(":") } });
    await assert.rejects(repository.updateCoachStatus(id, "active"), /COACH_WRITE_FAILED/);
    await store.collection("Coach").replaceOne({ _id: id }, original);
    await repository.deleteCoach(id, actor.email);
    const deleted = await store.one("Coach", { _id: id }); assert.ok(deleted?.deletedAt instanceof Date); assert.equal(deleted?.deletedBy, actor.email);
    assert.equal(await store.collection("CoachPrivateProfile").countDocuments({ _id: id }), 1);
    await assert.rejects(repository.updateCoach(id, { name: "Cannot restore" }, actor), /COACH_NOT_FOUND/);
    await assert.rejects(repository.deleteCoach(id, actor.email), /COACH_NOT_FOUND/);
  } finally {
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
