import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import type { MongoClient } from "mongodb";
import * as readiness from "./mongoReadStore";
import { completeMongoRow, MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, type MongoRuntimeDocument } from "./mongoRuntimeCodec";

mock.module("./mongoReadStore", { namedExports: { ...readiness, assertMongoReadStoreReady: async () => {} } });
const { MongoInstructorNoteRepository } = await import("./mongoInstructorNoteRepository");
const saved = new Map(["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY"].map(key => [key, process.env[key]]));

test("InstructorNote: encrypted partial updates, duplicate-name precedence and redaction contract", async () => {
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "fixture";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  const data = new Map<string, MongoRuntimeDocument>();
  const rows = () => [...data.values()].map(row => decodeMongoRuntimeDocument("InstructorNote", row));
  const one = mock.method(MongoOperationStore.prototype, "one", async (_model: string, filter: MongoRow) => rows().find(row => Object.entries(filter).every(([key, value]) => row[key === "_id" ? "id" : key] === value)) ?? null);
  const scan = mock.method(MongoOperationStore.prototype, "scan", async () => rows());
  const eq = mock.method(MongoOperationStore.prototype, "findPrivateEqual", async (_model: string, field: string, value: string | null) => rows().filter(row => row[field] === value));
  const collection = mock.method(MongoOperationStore.prototype, "collection", () => ({
    insertOne: async (doc: MongoRuntimeDocument) => { data.set(doc._id, doc); },
    replaceOne: async (where: { _id: string }, doc: MongoRuntimeDocument) => {
      if (!data.has(where._id)) return { matchedCount: 0 };
      data.set(where._id, doc); return { matchedCount: 1 };
    }
  }) as unknown as ReturnType<MongoOperationStore["collection"]>);
  // Contract harness only: no claim of real transaction/unique-index verification here.
  const session = { withTransaction: async (work: () => Promise<unknown>) => work(), endSession: async () => {} };
  const options = { client: { db: () => ({ command: async () => ({ setName: "fixture", logicalSessionTimeoutMinutes: 30 }) }), startSession: () => session } as unknown as MongoClient, databaseName: "hub_om_shadow_notes_mock", namespace: "shadow_notes", allowShadowWrites: true as const };
  try {
    await assert.rejects(MongoInstructorNoteRepository.open({ ...options, allowShadowWrites: false as unknown as true }), /SHADOW_WRITE_GATE/);
    const repository = await MongoInstructorNoteRepository.open(options);
    assert.deepEqual(await repository.getNote("Synthetic none"), {});
    assert.deepEqual(await repository.getNoteByNotionNo(111), {});
    const first = await repository.saveNoteByNotionNo(111, { instructorName: "Synthetic instructor", notes: "Keep this", recruitAvoid: true, notion: { categories: ["Synthetic category"], email: "remove@example.invalid", memo: "Call 010-1234-5678" }, email: "remove@example.invalid" });
    assert.equal(first.notionNo, 111);
    assert.equal(first.email, undefined);
    assert.equal(first.notion?.email, undefined);
    assert.equal(first.notion?.memo, "Call [연락처 비공개]");
    await repository.saveNoteByNotionNo(111, { displayName: "Synthetic display" });
    assert.equal((await repository.getNoteByNotionNo(111)).notes, "Keep this");
    assert.equal((await repository.getNoteByNotionNo(111)).recruitAvoid, true);
    await repository.saveNoteByNotionNo(111, { notes: "", recruitAvoid: false });
    const cleared = await repository.getNoteByNotionNo(111);
    assert.equal(cleared.notes, undefined); assert.equal(cleared.recruitAvoid, false);
    assert.equal(cleared.displayName, "Synthetic display");
    await repository.saveNoteByNotionNo(222, { instructorName: "Synthetic instructor", notes: "Other numbered row" });
    const noNumber = completeMongoRow("InstructorNote", { id: randomUUID(), instructorName: "Synthetic instructor", notes: "Unnumbered row", recruitAvoid: false, createdAt: new Date(), updatedAt: new Date() });
    const encoded = encodeMongoRuntimeDocument("InstructorNote", noNumber); data.set(encoded._id, encoded);
    assert.equal((await repository.getNote("Synthetic instructor")).notes, "Unnumbered row");
    await repository.saveNote("Synthetic instructor", { notes: "Updates lowest numbered row" });
    assert.equal((await repository.getNoteByNotionNo(111)).notes, "Updates lowest numbered row");
    assert.equal((await repository.getNoteByNotionNo(222)).notes, "Other numbered row");
    assert.equal((await repository.getNote("Synthetic instructor")).notes, "Unnumbered row");
    const created = await repository.saveNote("Synthetic new name", { instructorName: "Ignored override", notionNo: 999 });
    assert.equal(created.instructorName, "Synthetic new name"); assert.equal(created.notionNo, undefined);
    await repository.saveNoteByNotionNo(111, { notionNo: 333, instructorName: "Synthetic renamed" });
    assert.deepEqual(await repository.getNoteByNotionNo(111), {});
    assert.equal((await repository.getNoteByNotionNo(333)).instructorName, "Synthetic renamed");
    assert.equal((await repository.listNotes()).length, 4);
    const stored = [...data.values()];
    assert.ok(!JSON.stringify(stored).includes("Synthetic instructor"));
    assert.ok(!JSON.stringify(stored).includes("Synthetic category"));
    assert.ok(!JSON.stringify(stored).includes("remove@example.invalid"));
    const row = rows().find(row => row.notionNo === 333)!;
    const before = data.get(row.id as string);
    await assert.rejects(repository.saveNoteByNotionNo(333, { notion: { syncedAt: "not a date" } }), /INSTRUCTOR_NOTE_FAILED/);
    assert.equal(data.get(row.id as string), before);
    const oldKeys = process.env.PII_ENCRYPTION_KEYS; delete process.env.PII_ENCRYPTION_KEYS;
    await assert.rejects(repository.saveNoteByNotionNo(333, { notes: "must not persist" }), /INSTRUCTOR_NOTE_FAILED/);
    process.env.PII_ENCRYPTION_KEYS = oldKeys;
    assert.equal(data.get(row.id as string), before);
    assert.equal(rows().find(row => row.instructorName === "Synthetic new name")?.notionProfile, MongoDbNull);
  } finally {
    for (const handle of [one, scan, eq, collection]) handle.mock.restore();
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("InstructorNote refuses a standalone Mongo server", async () => {
  const client = { db: () => ({ command: async () => ({ logicalSessionTimeoutMinutes: 30 }) }) } as unknown as MongoClient;
  await assert.rejects(MongoInstructorNoteRepository.open({ client, databaseName: "hub_om_shadow_notes_mock", namespace: "shadow_notes", allowShadowWrites: true }), /TRANSACTIONS_REQUIRED/);
});

test("InstructorNote open never exposes raw connection failures", async () => {
  const client = { db: () => ({ command: async () => { throw new Error("synthetic-secret@example.invalid"); } }) } as unknown as MongoClient;
  await assert.rejects(MongoInstructorNoteRepository.open({ client, databaseName: "hub_om_shadow_notes_mock", namespace: "shadow_notes", allowShadowWrites: true }), (error: unknown) => {
    assert.ok(error instanceof Error); assert.match(error.message, /INSTRUCTOR_NOTE_OPEN_FAILED/); assert.ok(!error.message.includes("example.invalid")); return true;
  });
});
