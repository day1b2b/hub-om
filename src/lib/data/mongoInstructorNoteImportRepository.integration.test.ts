import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { Collection, MongoClient, MongoServerError } from "mongodb";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoInstructorNoteImportRepository, prepareMongoInstructorNoteImportStore } from "./mongoInstructorNoteImportRepository";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_INSTRUCTOR_NOTE_IMPORT_TEST_URI;
test("instructor note import is private, atomic and repeatable on Mongo", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port); assert.equal(url.username, "");
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  const databaseName = `hub_om_shadow_note_import_${randomBytes(6).toString("hex")}`, namespace = `shadow_note_import_${randomBytes(6).toString("hex")}`;
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"], saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoInstructorNoteImportStore(options); const store = new MongoOperationStore(options, ["InstructorNote"]);
    const add = async (values: MongoRow) => { const row = coachFixtureRow("InstructorNote", { id: randomUUID(), instructorName: "Synthetic", recruitAvoid: false, ...values }); await store.collection("InstructorNote").insertOne(encodeMongoRuntimeDocument("InstructorNote", row)); return row; };
    const numbered = await add({ instructorName: "Synthetic A", notionNo: 5, displayName: "Keep display", notes: "Old A" });
    const legacy = await add({ instructorName: "Synthetic A", notionNo: null, displayName: "Legacy display", notes: "Legacy A" });
    const second = await add({ instructorName: "Synthetic B", notionNo: null, partnerId: "Keep partner", notes: "Old B" });
    const repository = await MongoInstructorNoteImportRepository.open(options);
    const entries = [
      { name: "Synthetic A", note: { notionNo: 5, instructorName: "Synthetic A", displayName: "", notes: "Redacted A", notion: { syncedAt: "2026-10-01T00:00:00.000Z", memo: "Safe memo" } } },
      { name: "Synthetic A", note: { notionNo: 6, instructorName: "Synthetic A", notes: "Distinct same-name row" } },
      { name: "Synthetic B", note: { partnerId: "", recruitAvoid: true, notes: "Redacted B" } },
      { name: "Synthetic C", note: { displayName: "Display C", notes: "Redacted C" } },
    ];
    const before = await store.collection("InstructorNote").find({}).sort({ _id: 1 }).toArray();
    assert.deepEqual(await repository.importNotes(entries, false), { total: 4, inserted: 2, updated: 2 });
    assert.deepEqual(await store.collection("InstructorNote").find({}).sort({ _id: 1 }).toArray(), before);
    const originalReplace = Collection.prototype.replaceOne;
    const late = mock.method(Collection.prototype, "replaceOne", async function(this: Collection, ...args: Parameters<Collection["replaceOne"]>) {
      if (this.collectionName === `${namespace}_InstructorNote` && (args[0] as { _id?: string })._id === second.id) throw new Error("private late canary");
      return originalReplace.apply(this, args);
    });
    try { await assert.rejects(repository.importNotes(entries, true), error => !String(error).includes("canary")); } finally { late.mock.restore(); }
    assert.deepEqual(await store.collection("InstructorNote").find({}).sort({ _id: 1 }).toArray(), before, "late row failure rolls back earlier writes");
    assert.deepEqual(await repository.importNotes(entries, true), { total: 4, inserted: 2, updated: 2 });
    const a = await store.one("InstructorNote", { _id: numbered.id as string }), untouched = await store.one("InstructorNote", { _id: legacy.id as string });
    assert.equal(a?.displayName, "Keep display"); assert.equal(a?.notes, "Redacted A"); assert.equal(untouched?.notes, "Legacy A");
    const b = await store.one("InstructorNote", { _id: second.id as string }); assert.equal(b?.partnerId, "Keep partner"); assert.equal(b?.recruitAvoid, true); assert.equal(b?.notes, "Redacted B");
    assert.equal((await store.scan("InstructorNote", {})).find(row => row.instructorName === "Synthetic C")?.displayName, "Display C");
    assert.equal((await store.one("InstructorNote", { notionNo: 6 }))?.notes, "Distinct same-name row");
    const raw = JSON.stringify(await store.collection("InstructorNote").find({}).toArray());
    for (const plaintext of ["Synthetic A", "Redacted A", "Safe memo", "Keep partner", "Display C"]) assert.equal(raw.includes(plaintext), false);
    assert.deepEqual(await repository.importNotes(entries, true), { total: 4, inserted: 0, updated: 4 });
    let attempts = 0; const originalInsert = Collection.prototype.insertOne;
    const race = mock.method(Collection.prototype, "insertOne", async function(this: Collection, ...args: Parameters<Collection["insertOne"]>) {
      if (this.collectionName === `${namespace}_InstructorNote` && attempts++ === 0) throw new MongoServerError({ message: "first insert race", code: 11000 });
      return originalInsert.apply(this, args);
    });
    try { assert.deepEqual(await repository.importNotes([{ name: "Synthetic D", note: {} }], true), { total: 1, inserted: 1, updated: 0 }); } finally { race.mock.restore(); }
    assert.equal(attempts, 2);
    const secondRepository = await MongoInstructorNoteImportRepository.open(options);
    const concurrent = await Promise.all([repository.importNotes([{ name: "Synthetic E", note: {} }], true), secondRepository.importNotes([{ name: "Synthetic E", note: {} }], true)]);
    assert.deepEqual(concurrent.map(result => [result.inserted, result.updated]).sort(), [[0, 1], [1, 0]]); assert.equal((await store.findPrivateEqual("InstructorNote", "instructorName", "Synthetic E")).length, 1);
    const partial = { ...options, namespace: `${namespace}_partial` }; await client.db(databaseName).createCollection(`${partial.namespace}_InstructorNote`);
    const sentinel = client.db(databaseName).collection<{ _id: string }>(`${partial.namespace}_InstructorNote`); await sentinel.insertOne({ _id: "sentinel" }); const partialBefore = await sentinel.find({}).toArray();
    await assert.rejects(MongoInstructorNoteImportRepository.open(partial)); assert.deepEqual(await sentinel.find({}).toArray(), partialBefore);
  } finally { try { await client.db(databaseName).dropDatabase(); } finally { await client.close(); for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
});
