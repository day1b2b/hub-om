import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { AbstractCursor, Collection, MongoClient, type CommandStartedEvent, type CommandFailedEvent, type CommandSucceededEvent, type Document } from "mongodb";
import { MongoInstructorNoteRepository, INSTRUCTOR_NOTE_MODELS } from "./mongoInstructorNoteRepository";
import { MongoOperationStore, completeMongoRow, type MongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { activityContext } from "../activity/context";
import { mapPageToInstructor } from "../instructors/notionInstructorMap";
import { runNotionInstructorSync } from "../instructors/instructorNotionSyncWorkflow";

const uri = process.env.MONGODB_INSTRUCTOR_NOTION_TEST_URI;
const actor = "synthetic-sync@example.invalid";
function page(no: number, name = "Synthetic instructor", avoid = false) {
  return { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", properties: {
    ID: { type: "unique_id", unique_id: { number: no, prefix: null } },
    강사명: { type: "title", title: [{ plain_text: name }] },
    "섭외지양 여부": { type: "checkbox", checkbox: avoid },
    메모: { type: "rich_text", rich_text: [{ plain_text: "Synthetic memo 010-1234-5678 private@example.invalid" }] },
    연락처: { type: "phone_number", phone_number: "010-1234-5678" },
    "이메일 주소": { type: "email", email: "private@example.invalid" }
  } };
}
function record(no: number, name = "Synthetic instructor", avoid = false) { const value = mapPageToInstructor(page(no, name, avoid)); assert.ok(value); return value; }
function attributed<T>(work: () => Promise<T>, requestId = randomUUID()) { return activityContext.run({ requestId, actorType: "user", actorEmail: actor, actorName: "Synthetic actor", route: "/api/admin/sync-notion-instructors", method: "POST" }, work); }
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>) { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic barrier timeout")), 7000); })]); } finally { clearTimeout(timer); } }
function safe(error: unknown) { assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /Synthetic|private@example|010-1234|injected-secret/); assert.equal((error as Error & { cause?: unknown }).cause, undefined); return true; }

test("instructor Notion sync native isolated replica set", { skip: !uri, timeout: 240_000 }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/"); assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const databaseName = `hub_om_shadow_instructor_sync_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const keys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"], saved = new Map(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_instructor_sync_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS); const repo = await MongoInstructorNoteRepository.open(options), store = new MongoOperationStore(options, INSTRUCTOR_NOTE_MODELS);
    const add = async (fields: MongoRow) => { const row = completeMongoRow("InstructorNote", { id: randomUUID(), instructorName: "Synthetic instructor", recruitAvoid: false, createdAt: new Date("2090-01-01"), updatedAt: new Date("2090-01-01"), ...fields }); await store.collection("InstructorNote").insertOne(encodeMongoRuntimeDocument("InstructorNote", row)); return row; };
    const snapshot = async (): Promise<Record<string, Document[]>> => Object.fromEntries(await Promise.all(INSTRUCTOR_NOTE_MODELS.map(async model => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()])));
    return { repo, store, options, add, snapshot };
  }
  async function observe<T>(work: () => Promise<T>) {
    const names: string[] = []; let conflicts = 0, duplicateKeys = 0;
    const start = (event: CommandStartedEvent) => { if (event.databaseName === databaseName) names.push(event.commandName); };
    const failure = (code?: number) => { if (code === 112) conflicts++; if (code === 11000) duplicateKeys++; };
    const fail = (event: CommandFailedEvent) => failure((event.failure as { code?: number }).code);
    const done = (event: CommandSucceededEvent) => { for (const error of (event.reply as Document).writeErrors ?? []) failure(error.code); };
    client.on("commandStarted", start); client.on("commandFailed", fail); client.on("commandSucceeded", done);
    try { return { result: await work(), names, conflicts, duplicateKeys }; } finally { client.off("commandStarted", start); client.off("commandFailed", fail); client.off("commandSucceeded", done); }
  }
  function hold(namespace: string, requestId: string) {
    const held = signal(), release = signal(), close = AbstractCursor.prototype.close; let paused = false;
    const patch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) { await close.apply(this, args); if (!paused && this.namespace.collection === `${namespace}_InstructorNote` && activityContext.getStore()?.requestId === requestId) { paused = true; held.resolve(); await release.promise; } });
    return { held, release, patch };
  }
  try {
    await client.connect(); connected = true;
    await suite.test("NO priority, exact null-NO legacy matching, conditional notionId, profile replacement and manual field preservation", async () => {
      const f = await fixture(), numbered = await f.add({ notionNo: 10, instructorName: "Synthetic old name", displayName: "Synthetic display", notes: "Synthetic manual notes", partnerId: "Synthetic partner", notionId: "Synthetic old link", notionProfile: { memo: "old", categories: ["old"] } }), legacy = await f.add({ instructorName: "Synthetic instructor" });
      assert.deepEqual(await f.repo.findMatch(record(10)), { by: "notionNo", target: { id: numbered.id, instructorName: "Synthetic old name", recruitAvoid: false } });
      const incoming = record(10); delete incoming.note.notionId;
      assert.equal(await attributed(() => f.repo.applyRecord(incoming)), "updated");
      const row = await f.store.one("InstructorNote", { notionNo: 10 }); assert.ok(row); assert.equal(row.id, numbered.id); assert.equal(row.instructorName, "Synthetic instructor"); assert.equal(row.displayName, "Synthetic display"); assert.equal(row.notes, "Synthetic manual notes"); assert.equal(row.partnerId, "Synthetic partner"); assert.equal(row.notionId, "Synthetic old link"); assert.deepEqual(row.createdAt, numbered.createdAt); assert.equal((row.notionProfile as Document).categories, undefined); assert.equal((row.notionProfile as Document).email, undefined); assert.equal((row.notionProfile as Document).memo, "Synthetic memo [연락처 비공개] [이메일 비공개]");
      assert.equal((await f.repo.findMatch(record(11))).by, "legacy"); await attributed(() => f.repo.applyRecord(record(11))); assert.equal((await f.store.one("InstructorNote", { notionNo: 11 }))?.id, legacy.id);
      assert.equal(await f.repo.applyRecord(record(12)), "created"); assert.equal(await f.store.collection("InstructorNote").countDocuments(), 3);
      assert.equal((await f.repo.findMatch(record(13, "synthetic instructor"))).by, "none");
      assert.doesNotMatch(JSON.stringify(await f.snapshot()), /Synthetic manual|Synthetic instructor|private@example.invalid|010-1234-5678|synthetic-sync@example.invalid/);
    });
    await suite.test("sync-only audit matches PG nullable INSERT and same-profile encrypted rewrite", async () => {
      const f = await fixture(), incoming = record(15); delete incoming.note.notionId;
      const firstRequest = randomUUID(), secondRequest = randomUUID();
      await attributed(() => f.repo.applyRecord(incoming), firstRequest);
      await attributed(() => f.repo.applyRecord(incoming), secondRequest);
      const first = await f.store.one("ActivityChange", { requestId: firstRequest });
      const second = await f.store.one("ActivityChange", { requestId: secondRequest });
      assert.deepEqual(first?.changes, { instructor_name: { redacted: true }, notion_no: { redacted: true }, display_name: { redacted: true },
        notion_id: { redacted: true }, partner_id: { redacted: true }, notes: { redacted: true }, notion_profile: { redacted: true },
        notion_synced_at: { redacted: true }, recruit_avoid: { before: null, after: false } });
      assert.equal(first?.action, "create"); assert.equal(second?.action, "update");
      assert.deepEqual(second?.changes, { notion_profile: { redacted: true } });
    });
    await suite.test("multiple exact legacy candidates connect only one; numbered names and other case remain untouched", async () => {
      const f = await fixture(), first = await f.add({ notes: "Synthetic first legacy" }), second = await f.add({ notes: "Synthetic second legacy" }), numbered = await f.add({ notionNo: 98 }), differentlyCased = await f.add({ instructorName: "synthetic instructor" });
      assert.equal(await f.repo.applyRecord(record(99)), "updated"); const linked = await f.store.one("InstructorNote", { notionNo: 99 }); assert.ok(linked); assert.ok([first.id, second.id].includes(linked.id));
      assert.equal(await f.store.collection("InstructorNote").countDocuments({ notionNo: null }), 2); assert.equal((await f.store.one("InstructorNote", { notionNo: 98 }))?.id, numbered.id); assert.equal((await f.store.one("InstructorNote", { _id: String(differentlyCased.id) }))?.notionNo, null);
    });
    for (const current of [false, true]) for (const source of [false, true]) await suite.test(`recruitAvoid OR ${current}/${source}`, async () => { const f = await fixture(); await f.add({ notionNo: 1, recruitAvoid: current }); await f.repo.applyRecord(record(1, "Synthetic instructor", source)); assert.equal((await f.repo.getNoteByNotionNo(1)).recruitAvoid, current || source); });
    await suite.test("duplicate source NO dry-run has no virtual writes, initialize no writes, apply/reapply counts retain original policy", async () => {
      const f = await fixture(), before = await f.snapshot(), pages = [page(21), page(21), {}];
      const observed = await observe(() => attributed(() => runNotionInstructorSync(pages, f.repo, true)));
      assert.deepEqual(observed.result, { totalRows: 3, created: 2, updated: 0, skipped: 1, errors: 0, errorDetail: [], changes: [{ coachName: "Synthetic instructor", action: "create_notion", details: "신규 강사" }, { coachName: "Synthetic instructor", action: "create_notion", details: "신규 강사" }] });
      assert.ok(!observed.names.some(name => ["insert", "update", "delete", "create", "createIndexes", "collMod", "findAndModify"].includes(name))); assert.deepEqual(await f.snapshot(), before);
      const applied = await attributed(() => runNotionInstructorSync(pages, f.repo, false)); assert.deepEqual([applied.created, applied.updated, applied.skipped, applied.errors], [1, 1, 1, 0]);
      const repeated = await attributed(() => runNotionInstructorSync(pages, f.repo, false)); assert.deepEqual([repeated.created, repeated.updated, repeated.skipped, repeated.errors], [0, 2, 1, 0]); assert.equal(await f.store.collection("InstructorNote").countDocuments(), 1);
    });
    await suite.test("numeric PG probe contract: truncation then Int32 range, invalid numbers are errors not skips", async () => {
      for (const no of [0, -1, 2147483647, -2147483648, 0.5, -0.5, 1.5, -1.5, 2147483647.5, -2147483648.5]) {
        const f = await fixture(), preview = await runNotionInstructorSync([page(no)], f.repo, true); assert.equal(preview.created, 1); assert.equal(preview.errors, 0);
        const applied = await runNotionInstructorSync([page(no)], f.repo, false); assert.equal(applied.created, 1, `NO ${String(no)}: ${JSON.stringify(applied)}`); const row = await f.store.one("InstructorNote", {}); assert.equal(row?.notionNo, Math.trunc(no) || 0);
        assert.equal((await runNotionInstructorSync([page(no)], f.repo, false)).updated, 1);
      }
      for (const no of [2147483648, -2147483649, NaN, Infinity, -Infinity]) { const f = await fixture(), before = await f.snapshot(); for (const dry of [true, false]) { const result = await runNotionInstructorSync([page(no)], f.repo, dry); assert.equal(result.errors, 1); assert.equal(result.skipped, 0); assert.deepEqual(result.errorDetail, ["INSTRUCTOR_NOTION_ROW_FAILED"]); } assert.deepEqual(await f.snapshot(), before); }
    });
    for (const method of ["saveNote", "saveNoteByNotionNo"] as const) for (const syncLast of [false, true]) await suite.test(`actual ${method}, sync commits ${syncLast ? "last" : "first"}: conflict retries recalculate current fields and audit`, async () => {
      const f = await fixture(); await f.add({ notionNo: 41 }); const manual = await MongoInstructorNoteRepository.open(f.options), requestId = randomUUID(), barrier = hold(f.options.namespace, requestId);
      const patch = { displayName: "Synthetic display", notes: "Synthetic preserved memo", partnerId: "Synthetic partner", recruitAvoid: false, notion: { memo: "Synthetic manual profile" } };
      const writeManual = () => method === "saveNote" ? manual.saveNote("Synthetic instructor", patch) : manual.saveNoteByNotionNo(41, patch);
      const pending = attributed(async () => syncLast ? f.repo.applyRecord(record(41, "Synthetic instructor", true)) : writeManual(), requestId); void pending.catch(() => {});
      try { await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Manual/sync barrier not reached"); })])); const observed = await observe(async () => { await attributed(async () => syncLast ? writeManual() : f.repo.applyRecord(record(41, "Synthetic instructor", true))); barrier.release.resolve(); await pending; }); assert.ok(observed.conflicts > 0, "real WriteConflict 112 required"); }
      finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      const result = await f.repo.getNoteByNotionNo(41); assert.equal(result.displayName, patch.displayName); assert.equal(result.notes, patch.notes); assert.equal(result.partnerId, patch.partnerId); assert.equal(result.recruitAvoid, syncLast); assert.equal(result.notion?.memo, syncLast ? "Synthetic memo [연락처 비공개] [이메일 비공개]" : patch.notion.memo);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 2); assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), 1);
    });
    for (const legacy of [false, true]) await suite.test(`${legacy ? "same legacy different NO" : "same NO first insert"} race rematches after real conflict, preserving the first link`, async () => {
      const f = await fixture(), existing = legacy ? await f.add({}) : null, second = await MongoInstructorNoteRepository.open(f.options), requestId = randomUUID(), barrier = hold(f.options.namespace, requestId);
      const pending = attributed(() => f.repo.applyRecord(record(51, legacy ? "Synthetic instructor" : "Synthetic final name")), requestId); void pending.catch(() => {});
      try { await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Upsert barrier not reached"); })])); const observed = await observe(async () => { assert.equal(await attributed(() => second.applyRecord(record(legacy ? 52 : 51, legacy ? "Synthetic instructor" : "Synthetic first name"))), legacy ? "updated" : "created"); barrier.release.resolve(); await pending; }); assert.ok(observed.conflicts + observed.duplicateKeys > 0); }
      finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      assert.equal(await f.store.collection("InstructorNote").countDocuments({ notionNo: 51 }), 1);
      if (legacy) { assert.equal((await f.store.one("InstructorNote", { notionNo: 52 }))?.id, existing?.id); assert.equal(await f.store.collection("InstructorNote").countDocuments(), 2); }
      else assert.equal(await f.store.collection("InstructorNote").countDocuments(), 1);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), 1); assert.equal(await f.store.collection("ActivityChange").countDocuments(), 2);
    });
    for (const moving of [false, true]) await suite.test(`manual identity ${moving ? "NO move" : "first upsert"} while sync snapshot is held`, async () => {
      const f = await fixture(); if (moving) await f.add({ notionNo: 91 });
      const manual = await MongoInstructorNoteRepository.open(f.options), requestId = randomUUID(), barrier = hold(f.options.namespace, requestId);
      const pending = attributed(() => f.repo.applyRecord(record(91)), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Identity barrier not reached"); })]));
        const observed = await observe(async () => {
          await attributed(() => manual.saveNoteByNotionNo(91, { instructorName: "Synthetic instructor", notes: "Synthetic identity memo", ...(moving ? { notionNo: 92 } : {}) }));
          barrier.release.resolve(); await pending;
        });
        assert.ok(observed.conflicts + observed.duplicateKeys > 0);
      } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      assert.equal((await manual.getNoteByNotionNo(moving ? 92 : 91)).notes, "Synthetic identity memo");
      assert.equal(await f.store.collection("InstructorNote").countDocuments({ notionNo: 91 }), 1);
      assert.equal(await f.store.collection("InstructorNote").countDocuments(), moving ? 2 : 1);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 2);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), 1);
    });
    await suite.test("A success / B actual audit insert then failure / C success: only B raw row and audit roll back", async () => {
      const f = await fixture(), b = await f.add({ notionNo: 62, instructorName: "Synthetic B", notes: "Synthetic manual B" }), before = await f.store.collection("InstructorNote").findOne({ _id: String(b.id) }), insert = Collection.prototype.insertOne; let failedInserts = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) { const result = await insert.apply(this, args); if (this.collectionName === `${f.options.namespace}_ActivityChange` && args[0].targetId === b.id) { failedInserts++; throw new Error("injected-secret private@example.invalid"); } return result; });
      let result; try { result = await attributed(() => runNotionInstructorSync([page(61, "Synthetic A"), page(62, "Synthetic B"), page(63, "Synthetic C")], f.repo, false)); } finally { patch.mock.restore(); }
      assert.equal(failedInserts, 1); assert.deepEqual([result.totalRows, result.created, result.updated, result.skipped, result.errors], [3, 2, 0, 0, 1]); assert.deepEqual(result.errorDetail, ["INSTRUCTOR_NOTION_ROW_FAILED"]); assert.deepEqual(await f.store.collection("InstructorNote").findOne({ _id: String(b.id) }), before); assert.equal(await f.store.collection("ActivityChange").countDocuments({ targetId: b.id }), 0); assert.equal(await f.store.collection("ActivityChange").countDocuments(), 2); assert.equal(await f.store.collection("InstructorNote").countDocuments(), 3);
    });
    for (const damage of ["index-key", "hidden-hmac"] as const) await suite.test(`legacy ${damage}: empty HMAC candidate cannot create a duplicate`, async () => {
      const f = await fixture(), row = await f.add({ notionNo: null }), prior = process.env.PII_INDEX_KEY!;
      if (damage === "index-key") process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
      else await f.store.collection("InstructorNote").updateOne({ _id: String(row.id) }, { $set: { instructorNamePiiIndex: "0".repeat(64) } });
      const before = await f.snapshot();
      try {
        for (const dryRun of [true, false]) {
          const result = await runNotionInstructorSync([page(81)], f.repo, dryRun);
          assert.equal(result.errors, 1); assert.equal(result.created, 0);
          assert.deepEqual(result.errorDetail, ["INSTRUCTOR_NOTION_ROW_FAILED"]);
          assert.deepEqual(await f.snapshot(), before);
        }
      } finally { process.env.PII_INDEX_KEY = prior; }
    });
    for (const damage of ["missing-key", "wrong-key", "hmac", "profile"] as const) await suite.test(`${damage}: full authentication rejects preview/apply and preserves raw row`, async () => {
      const f = await fixture(), row = await f.add({ notionNo: 71, notionProfile: { memo: "Synthetic private profile" } }), prior = process.env.PII_ENCRYPTION_KEYS!;
      if (damage === "missing-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ other: randomBytes(32).toString("base64") }); else if (damage === "wrong-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); else await f.store.collection("InstructorNote").updateOne({ _id: String(row.id) }, { $set: damage === "hmac" ? { instructorNamePiiIndex: "0".repeat(64) } : { notionProfile: { $json: { __pii: "pii:v1:corrupt" } } } }, { bypassDocumentValidation: true });
      const before = await f.snapshot(); try { await assert.rejects(f.repo.findMatch(record(71)), safe); await assert.rejects(attributed(() => f.repo.applyRecord(record(71))), safe); const result = await runNotionInstructorSync([page(71)], f.repo, false); assert.deepEqual(result.errorDetail, ["INSTRUCTOR_NOTION_ROW_FAILED"]); assert.equal(result.errors, 1); assert.deepEqual(await f.snapshot(), before); } finally { process.env.PII_ENCRYPTION_KEYS = prior; }
    });
  } finally { try { if (connected) { assert.match(databaseName, /^hub_om_shadow_instructor_sync_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } } finally { try { await client.close(); } finally { for (const key of keys) { const value = saved.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; } } } }
});
