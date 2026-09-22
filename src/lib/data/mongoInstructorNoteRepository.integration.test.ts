import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { MongoOperationStore, operationMongoValidator } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";

const uri = process.env.MONGODB_INSTRUCTOR_NOTE_TEST_URI;
test("InstructorNote native: encrypted merge, unique upsert races, transaction rollback and tamper rejection", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_note_test_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName, namespace: "shadow_note_test", allowShadowWrites: true as const };
  const saved = new Map(["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"].map(key => [key, process.env[key]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  let connected = false;
  try {
    await client.connect(); connected = true;
    await assert.rejects(MongoInstructorNoteRepository.open(options), /VALIDATOR_NOT_READY/);
    await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
    const repository = await MongoInstructorNoteRepository.open(options);
    const store = new MongoOperationStore(options, INSTRUCTOR_NOTE_MODELS);
    const collection = store.collection("InstructorNote");
    await Promise.all(Array.from({ length: 4 }, () => repository.saveNoteByNotionNo(401, { instructorName: "Synthetic concurrent instructor" })));
    assert.equal(await collection.countDocuments({ notionNo: 401 }), 1);
    await Promise.all([
      repository.saveNoteByNotionNo(401, { displayName: "Synthetic display" }),
      repository.saveNoteByNotionNo(401, { notes: "Synthetic preserved memo" }),
      repository.saveNoteByNotionNo(401, { recruitAvoid: true })
    ]);
    const merged = await repository.getNoteByNotionNo(401);
    assert.equal(merged.displayName, "Synthetic display"); assert.equal(merged.notes, "Synthetic preserved memo"); assert.equal(merged.recruitAvoid, true);
    await repository.saveNoteByNotionNo(402, { instructorName: "Synthetic concurrent instructor", notes: "Second number" });
    assert.equal((await repository.listNotes()).length, 2);
    assert.equal((await repository.getNote("Synthetic concurrent instructor")).notionNo, 401);
    await repository.saveNoteByNotionNo(401, { notes: "", recruitAvoid: false, notion: { categories: ["Synthetic category"], email: "remove@example.invalid", memo: "email remove@example.invalid" } });
    const clean = await repository.getNoteByNotionNo(401);
    assert.equal(clean.notes, undefined); assert.equal(clean.recruitAvoid, false); assert.equal(clean.notion?.email, undefined); assert.equal(clean.notion?.memo, "email [이메일 비공개]");
    const stored = (await collection.findOne({ notionNo: 401 }))!;
    assert.ok(!JSON.stringify(stored).includes("Synthetic concurrent instructor")); assert.ok(!JSON.stringify(stored).includes("Synthetic category"));
    // A real server-side validation failure must leave the whole prior document unchanged.
    await store.db.command({ collMod: collection.collectionName, validator: { $and: [operationMongoValidator("InstructorNote"), { notionNo: { $ne: 401 } }] } });
    await assert.rejects(repository.saveNoteByNotionNo(401, { notes: "Rejected write" }), /INSTRUCTOR_NOTE_FAILED/);
    assert.deepEqual(await collection.findOne({ notionNo: 401 }), stored);
    await store.db.command({ collMod: collection.collectionName, validator: operationMongoValidator("InstructorNote") });
    await assert.rejects(repository.saveNoteByNotionNo(401, { notionNo: 402 }), /INSTRUCTOR_NOTE_FAILED/);
    assert.deepEqual(await collection.findOne({ notionNo: 401 }), stored);
    await collection.updateOne({ notionNo: 401 }, { $set: { instructorNamePiiIndex: "0".repeat(64) } });
    const corrupt = await collection.findOne({ notionNo: 401 });
    await assert.rejects(repository.saveNoteByNotionNo(401, { notes: "Cannot overwrite corrupt row" }), /INSTRUCTOR_NOTE_FAILED/);
    assert.deepEqual(await collection.findOne({ notionNo: 401 }), corrupt);
    await collection.replaceOne({ _id: stored._id }, stored);
    const keys = process.env.PII_ENCRYPTION_KEYS; delete process.env.PII_ENCRYPTION_KEYS;
    await assert.rejects(repository.saveNoteByNotionNo(401, { notes: "Missing key" }), /INSTRUCTOR_NOTE_FAILED/);
    process.env.PII_ENCRYPTION_KEYS = keys;
    assert.deepEqual(await collection.findOne({ notionNo: 401 }), stored);
    assert.equal((await repository.getNoteByNotionNo(401)).displayName, "Synthetic display");
    const secondOptions = { ...options, namespace: "shadow_note_second" };
    await prepareMongoReadStore(secondOptions, INSTRUCTOR_NOTE_MODELS);
    const second = await MongoInstructorNoteRepository.open(secondOptions);
    await second.saveNoteByNotionNo(401, { instructorName: "Synthetic isolated" });
    assert.equal((await second.getNoteByNotionNo(401)).instructorName, "Synthetic isolated");
    assert.equal((await repository.getNoteByNotionNo(401)).instructorName, "Synthetic concurrent instructor");
  } finally {
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally { try { await client.close(); } finally { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } } }
  }
});
