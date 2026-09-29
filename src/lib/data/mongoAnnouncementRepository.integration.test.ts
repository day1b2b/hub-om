import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { AbstractCursor, BSON, Binary, Collection, MongoClient, type CommandStartedEvent, type CommandSucceededEvent, type CommandFailedEvent, type Document } from "mongodb";
import { activityContext } from "../activity/context";
import { ANNOUNCEMENT_MODELS, MongoAnnouncementError, MongoAnnouncementRepository, prepareMongoAnnouncementStore } from "./mongoAnnouncementRepository";
import { MongoOperationStore, completeMongoRow, operationMongoIndexes } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_ANNOUNCEMENT_TEST_URI;
const actor = "synthetic-announcement@example.invalid";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const file = (n: number, length = 257) => ({ fileName: `합성 첨부 ${n} #%.bin`, mimeType: "application/octet-stream", size: length, data: Uint8Array.from({ length }, (_, i) => (i * 131 + n * 17) % 256) });
const input = (attachments = [file(0)]) => ({ title: "Synthetic private title", content: "<p>Synthetic private content</p>", authorEmail: actor, authorName: null, attachments });
function attributed<T>(work: () => Promise<T>, requestId = randomUUID()) { return activityContext.run({ requestId, actorEmail: actor, actorName: "Synthetic author", actorType: "user", route: "/api/admin/announcements", method: "PUT" }, work); }
function safe(error: unknown) { assert.ok(error instanceof MongoAnnouncementError); assert.doesNotMatch(error.message, /synthetic-announcement|Synthetic private|injected-secret|합성 첨부/); assert.equal((error as Error & { cause?: unknown }).cause, undefined); return true; }
function code(expected: string) { return (error: unknown) => { safe(error); assert.equal((error as MongoAnnouncementError).code, expected); return true; }; }
// Node 24 mock.method(Symbol.asyncIterator).mock.restore() can leave a broken
// proxy behind. Restore the exact own-property descriptor, without registering
// this Symbol replacement with the global test mock tracker.
function replaceCursorIterator(replacement: AbstractCursor[typeof Symbol.asyncIterator]): () => void {
  const prototype = AbstractCursor.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, Symbol.asyncIterator);
  assert.ok(descriptor && typeof descriptor.value === "function");
  Object.defineProperty(prototype, Symbol.asyncIterator, { ...descriptor, value: replacement });
  return () => {
    Object.defineProperty(prototype, Symbol.asyncIterator, descriptor);
    assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, Symbol.asyncIterator), descriptor);
  };
}
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; }
async function bounded<T>(promise: Promise<T>) { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic barrier timeout")), 10_000); })]); } finally { clearTimeout(timer); } }

test("announcements native replica-set contract", { skip: !uri, timeout: 300_000 }, async suite => {
  const address = new URL(uri!); assert.equal(address.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(address.hostname)); assert.ok(address.port); assert.equal(address.username, ""); assert.equal(address.password, ""); assert.equal(address.pathname, "/"); assert.deepEqual([...address.searchParams.keys()], ["replicaSet"]); assert.ok(address.searchParams.get("replicaSet"));
  const databaseName = `hub_om_shadow_announcement_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const keys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"], saved = new Map(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_announcement_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoAnnouncementStore(options);
    const repo = await MongoAnnouncementRepository.open(options), store = new MongoOperationStore(options, ANNOUNCEMENT_MODELS);
    const snapshot = async (): Promise<Record<string, Document[]>> => Object.fromEntries(await Promise.all(ANNOUNCEMENT_MODELS.map(async model => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()])));
    const replace = async (model: string, id: string, values: Document) => { const row = await store.one(model, { _id: id }); assert.ok(row); await store.collection(model).replaceOne({ _id: id }, encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...row, ...values }))); };
    const update = (id: string, title = "Synthetic changed title", attachments = [] as ReturnType<typeof file>[], removeAttachmentIds: string[] = []) => repo.update({ id, title, content: "<p>Synthetic changed content</p>", attachments, removeAttachmentIds });
    return { options, repo, store, snapshot, replace, update };
  }
  async function observe<T>(work: () => Promise<T>) {
    const names: string[] = [], reads = new Map<number, string>(), batches: Array<{ collection: string; ids: string[]; bytes: number }> = []; let conflicts = 0;
    const started = (event: CommandStartedEvent) => { if (event.databaseName !== databaseName) return; names.push(event.commandName); if (["find", "aggregate"].includes(event.commandName)) reads.set(event.requestId, String(event.command.find ?? event.command.aggregate)); };
    const done = (event: CommandSucceededEvent) => { const reply = event.reply as Document; if (reply.writeErrors?.some((e: { code: number }) => e.code === 112)) conflicts++; const collection = reads.get(event.requestId); if (collection && reply.cursor?.firstBatch) batches.push({ collection, ids: reply.cursor.firstBatch.map((row: Document) => String(row._id)), bytes: BSON.calculateObjectSize(reply) }); reads.delete(event.requestId); };
    const fail = (event: CommandFailedEvent) => { if ((event.failure as { code?: number }).code === 112) conflicts++; };
    client.on("commandStarted", started); client.on("commandSucceeded", done); client.on("commandFailed", fail);
    try { return { result: await work(), names, batches, conflicts }; } finally { client.off("commandStarted", started); client.off("commandSucceeded", done); client.off("commandFailed", fail); }
  }
  function holdRead(namespace: string, requestId: string) {
    const held = signal(), release = signal(), original = AbstractCursor.prototype.close; let stopped = false;
    const patch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) { await original.apply(this, args); if (!stopped && this.namespace.collection === `${namespace}_Announcement` && activityContext.getStore()?.requestId === requestId) { stopped = true; held.resolve(); await release.promise; } });
    return { held, release, patch };
  }
  try {
    await client.connect(); connected = true;
    await suite.test("independent DTOs, list descending, attachments ascending, UUID aliases and deleted visibility", async () => {
      const f = await fixture(); assert.deepEqual(await f.repo.list(), []);
      const a = await f.repo.create(input([file(0), file(1)])), b = await f.repo.create(input([]));
      await f.replace("Announcement", a.id, { createdAt: new Date("2090-01-01") }); await f.replace("Announcement", b.id, { createdAt: new Date("2091-01-01") });
      const detail = await f.repo.getDetail(a.id); assert.ok(detail); assert.equal(detail.attachments.length, 2);
      for (let i = 0; i < 2; i++) await f.replace("AnnouncementAttachment", detail.attachments[i].id, { createdAt: new Date(`209${i}-01-01`) });
      assert.deepEqual((await f.repo.list()).map(row => row.id), [b.id, a.id]);
      assert.deepEqual((await f.repo.list()).map(row => Object.keys(row).sort()), [a, b].map(() => ["id", "title", "authorEmail", "authorName", "createdAt", "updatedAt"].sort()));
      for (const id of [a.id, a.id.toUpperCase(), a.id.replaceAll("-", ""), `{${a.id}}`]) {
        const value = await f.repo.getDetail(id); assert.ok(value); assert.equal(value.authorName, null); assert.equal(value.content, input().content); assert.deepEqual(value.attachments.map(row => row.fileName), detail.attachments.map(row => row.fileName));
        const page = await f.repo.getDetailPage(id), edit = await f.repo.getEditPage(id); assert.ok(page && edit);
        assert.deepEqual(Object.keys(page).sort(), ["id", "title", "content", "authorEmail", "authorName", "createdAt", "attachments"].sort());
        assert.deepEqual(Object.keys(edit).sort(), ["id", "title", "content", "attachments"].sort());
        assert.deepEqual(Object.keys(edit.attachments[0]).sort(), ["fileName", "id", "size"]);
      }
      assert.equal(await f.repo.getDetail(randomUUID()), null); await assert.rejects(f.repo.getDetail(` ${a.id}`), safe);
      const before = await f.snapshot(); const read = await observe(() => f.repo.getDetail(a.id)); assert.ok(!read.names.some(name => ["insert", "update", "delete", "create", "createIndexes", "collMod"].includes(name))); assert.deepEqual(await f.snapshot(), before);
      await attributed(() => f.repo.softDelete(a.id, actor));
      assert.equal(await f.repo.getDetail(a.id), null); assert.equal(await f.repo.getDetailPage(a.id), null); assert.equal(await f.repo.getEditPage(a.id), null); assert.equal(await f.repo.download(a.id, detail.attachments[0].id), null);
      assert.deepEqual((await f.repo.list()).map(row => row.id), [b.id]); assert.ok((await f.repo.getDeleteState(a.id))?.deletedAt); assert.equal((await f.repo.getUpdateState(a.id))?._count.attachments, 2);
      assert.deepEqual((await f.snapshot()).AnnouncementAttachment, before.AnnouncementAttachment);
    });
    await suite.test("actual five 5MiB binary attachments survive create/detail/edit/download/remove+replace; short BSON pages have no getMore", async t => {
      const f = await fixture(), files = Array.from({ length: 5 }, (_, i) => file(i, 5 * 1024 * 1024)), started = performance.now(), rssBefore = process.memoryUsage().rss;
      const created = await attributed(() => f.repo.create(input(files)));
      const raw = await f.store.collection("AnnouncementAttachment").find({ announcementId: created.id }).toArray(); assert.equal(raw.length, 5);
      const sizes = raw.map(row => { assert.ok(row.data instanceof Binary); assert.equal(row.data.sub_type, 0); assert.ok(row.data.length() > 5 * 1024 * 1024); assert.ok(BSON.calculateObjectSize(row) < 16 * 1024 * 1024); return BSON.calculateObjectSize(row); });
      const observed = await observe(() => f.repo.getDetail(created.id)); assert.ok(observed.result); assert.equal(observed.result.attachments.length, 5); assert.ok(!observed.names.includes("getMore"));
      const pages = observed.batches.filter(row => row.collection === `${f.options.namespace}_AnnouncementAttachment` && row.ids.length);
      assert.ok(pages.length >= 5, "real ~9MiB encrypted documents force short firstBatch"); assert.ok(pages.some(row => row.ids.length < 5 && row.bytes > 8 * 1024 * 1024));
      assert.deepEqual([...new Set(pages.flatMap(row => row.ids))].sort(), raw.map(row => String(row._id)).sort());
      assert.equal((await f.repo.getEditPage(created.id))?.attachments.length, 5);
      for (const attachment of observed.result.attachments) { const expected = files.find(row => row.fileName === attachment.fileName)!; const downloaded = await f.repo.download(created.id, attachment.id); assert.ok(downloaded); assert.equal(downloaded.mimeType, expected.mimeType); assert.equal(downloaded.fileName, expected.fileName); assert.equal(hash(downloaded.data), hash(expected.data)); assert.equal(downloaded.data.length, expected.size); }
      const remove = observed.result.attachments[0], replacement = file(9, 5 * 1024 * 1024), kept = raw.filter(row => row._id !== remove.id);
      await attributed(() => f.update(created.id, "Synthetic replaced title", [replacement], [remove.id]));
      const after = await f.repo.getDetail(created.id); assert.ok(after); assert.equal(after.attachments.length, 5); assert.equal(await f.repo.download(created.id, remove.id), null);
      for (const row of kept) assert.deepEqual(await f.store.collection("AnnouncementAttachment").findOne({ _id: String(row._id) }), row);
      const added = after.attachments.find(row => row.fileName === replacement.fileName); assert.ok(added); assert.equal(hash((await f.repo.download(created.id, added.id))!.data), hash(replacement.data));
      t.diagnostic(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, originalBytes: 5 * 5 * 1024 * 1024, bsonBytes: sizes, elapsedMs: Math.round(performance.now() - started), rssBefore, rssAfter: process.memoryUsage().rss, maxRSSKiB: process.resourceUsage().maxRSS, note: "observed isolated fixture, not a production load guarantee" }));
    });
    await suite.test("partial edits preserve author/ciphertext; foreign/duplicate removal IDs cannot delete unrelated files; same logical replay", async () => {
      const f = await fixture(), a = await f.repo.create(input([file(0), file(1)])), b = await f.repo.create(input([file(2)]));
      const detail = (await f.repo.getDetail(a.id))!, foreign = (await f.repo.getDetail(b.id))!.attachments[0], before = await f.snapshot();
      await attributed(() => f.update(a.id, "Synthetic changed title", [file(3)], [detail.attachments[0].id, detail.attachments[0].id, foreign.id, randomUUID()]));
      const raw = (await f.snapshot()).Announcement.find(row => row._id === a.id)!;
      for (const [key, value] of Object.entries(before.Announcement.find(row => row._id === a.id)!)) if (!["title", "content", "titlePiiIndex", "contentPiiIndex", "updatedAt"].includes(key)) assert.deepEqual(raw[key], value, key);
      assert.ok(await f.repo.download(b.id, foreign.id)); assert.equal((await f.repo.getDetail(a.id))?.attachments.length, 2);
      const auditCount = await f.store.collection("ActivityChange").countDocuments(); await new Promise(resolve => setTimeout(resolve, 10)); await attributed(() => f.update(a.id));
      assert.notDeepEqual((await f.store.collection("Announcement").findOne({ _id: a.id }))?.updatedAt, raw.updatedAt); assert.equal(await f.store.collection("ActivityChange").countDocuments(), auditCount);
      const stored = JSON.stringify(await f.snapshot()); assert.doesNotMatch(stored, /Synthetic private|synthetic-announcement@example.invalid|합성 첨부/);
    });
    await suite.test("announcement audits redact private fields; attachment audit exposes only relationship/MIME/size and empty bytes round-trip", async () => {
      const f = await fixture(), parent = await attributed(() => f.repo.create(input([file(0, 0)]))), detail = (await f.repo.getDetail(parent.id))!;
      const downloaded = await f.repo.download(parent.id, detail.attachments[0].id); assert.ok(downloaded); assert.equal(downloaded.data.byteLength, 0);
      const rows = await f.store.scan("ActivityChange", {}); assert.equal(rows.length, 2);
      const announcement = rows.find(row => row.targetId === parent.id), attachment = rows.find(row => row.targetId === detail.attachments[0].id); assert.ok(announcement && attachment);
      assert.equal(announcement.action, "create"); assert.equal(announcement.actorEmail, actor); assert.equal(attachment.action, "create");
      const changes = announcement.changes as Document; assert.deepEqual(changes.title, { redacted: true }); assert.deepEqual(changes.content, { redacted: true }); assert.deepEqual(changes.author_name, { redacted: true });
      assert.deepEqual(attachment.changes, { announcement_id: { before: null, after: parent.id }, file_name: { redacted: true }, mime_type: { before: null, after: "application/octet-stream" }, size: { before: null, after: 0 }, data: { redacted: true } });
      const other = await f.repo.create(input([])); assert.equal(await f.repo.download(other.id, detail.attachments[0].id), null);
      await attributed(() => f.update(parent.id, "Synthetic removed file", [], [detail.attachments[0].id]));
      const deletion = (await f.store.scan("ActivityChange", {})).find(row => row.targetId === detail.attachments[0].id && row.action === "delete"); assert.ok(deletion); assert.deepEqual((deletion.changes as Document).size, { before: 0, after: null });
    });
    for (const operation of ["create", "update"] as const) for (const failure of ["attachment", "audit"] as const) {
      await suite.test(`${operation}: actual later ${failure} insert then failure rolls back parent/files/HMAC/audit`, async () => {
        const f = await fixture(), a = await f.repo.create(input()), detail = (await f.repo.getDetail(a.id))!, before = await f.snapshot(), original = Collection.prototype.insertOne; let inserted = 0;
        const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) { const result = await original.apply(this, args); if (this.collectionName === `${f.options.namespace}_${failure === "attachment" ? "AnnouncementAttachment" : "ActivityChange"}` && ++inserted === 2) throw new Error("injected-secret"); return result; });
        try { await assert.rejects(attributed(() => operation === "create" ? f.repo.create(input([file(5), file(6)])) : f.update(a.id, "Synthetic failing update", [file(5), file(6)], [detail.attachments[0].id])), safe); } finally { patch.mock.restore(); }
        assert.equal(inserted, 2); assert.deepEqual(await f.snapshot(), before);
      });
    }
    for (const corruption of ["missing-key", "wrong-key", "title-hmac", "file-hmac", "bytes"] as const) {
      await suite.test(`${corruption} authenticates full source and fails without partial mutation`, async () => {
        const f = await fixture(), a = await f.repo.create(input()), attachment = (await f.repo.getDetail(a.id))!.attachments[0], prior = process.env.PII_ENCRYPTION_KEYS!;
        if (corruption === "missing-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ other: randomBytes(32).toString("base64") });
        else if (corruption === "wrong-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
        else if (corruption === "title-hmac") await f.store.collection("Announcement").updateOne({ _id: a.id }, { $set: { titlePiiIndex: "0".repeat(64) } }, { bypassDocumentValidation: true });
        else if (corruption === "file-hmac") await f.store.collection("AnnouncementAttachment").updateOne({ _id: attachment.id }, { $set: { fileNamePiiIndex: "0".repeat(64) } }, { bypassDocumentValidation: true });
        else { const raw = await f.store.collection("AnnouncementAttachment").findOne({ _id: attachment.id }); assert.ok(raw?.data instanceof Binary); const damaged = Buffer.from(raw.data.value()); damaged[Math.floor(damaged.length / 2)] ^= 1; await f.store.collection("AnnouncementAttachment").updateOne({ _id: attachment.id }, { $set: { data: new Binary(damaged) } }, { bypassDocumentValidation: true }); }
        const before = await f.snapshot();
        try { await assert.rejects(f.repo.getDetail(a.id), safe); await assert.rejects(f.repo.download(a.id, attachment.id), safe); await assert.rejects(attributed(() => f.update(a.id, "Synthetic must rollback", [], [attachment.id])), safe); assert.deepEqual(await f.snapshot(), before); } finally { process.env.PII_ENCRYPTION_KEYS = prior; }
      });
    }
    for (const order of ["PUT/PUT", "PUT/DELETE", "DELETE/PUT"] as const) {
      await suite.test(`real ${order}: paused first reader retries after second writer commits, without resurrection or duplicate audit`, async () => {
        const f = await fixture(), a = await f.repo.create(input()), second = await MongoAnnouncementRepository.open(f.options), requestId = randomUUID(), barrier = holdRead(f.options.namespace, requestId);
        const firstDeletes = order.startsWith("DELETE"), secondDeletes = order.endsWith("DELETE");
        const pending = attributed(async () => firstDeletes ? f.repo.softDelete(a.id, actor) : f.update(a.id, "Synthetic final PUT"), requestId); void pending.catch(() => {});
        try {
          await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Writer barrier not reached"); })]));
          const observed = await observe(async () => { await attributed(async () => secondDeletes ? second.softDelete(a.id, actor) : second.update({ id: a.id, title: "Synthetic earlier PUT", content: "<p>Synthetic concurrent</p>", attachments: [], removeAttachmentIds: [] })); barrier.release.resolve(); await pending; }); assert.ok(observed.conflicts > 0, "actual wire WriteConflict 112 required");
        } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
        const row = await f.store.one("Announcement", { _id: a.id }); assert.ok(row); assert.equal(row.authorEmail, actor); assert.equal(row.title, firstDeletes ? "Synthetic earlier PUT" : "Synthetic final PUT");
        assert.equal(row.deletedAt !== null, firstDeletes || secondDeletes); assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), 1); assert.equal(await f.store.collection("ActivityChange").countDocuments(), 2);
        if (firstDeletes || secondDeletes) { assert.equal(await f.repo.getDetail(a.id), null); const fileRow = await f.store.collection("AnnouncementAttachment").findOne({ announcementId: a.id }); assert.ok(fileRow); assert.equal(await f.repo.download(a.id, String(fileRow._id)), null); }
      });
    }
    await suite.test("concurrent additions preserve separate preflight and can exceed five attachments", async () => {
      const f = await fixture(), a = await f.repo.create(input(Array.from({ length: 4 }, (_, i) => file(i))));
      const second = await MongoAnnouncementRepository.open(f.options);
      for (const state of await Promise.all([f.repo.getUpdateState(a.id), second.getUpdateState(a.id)])) {
        assert.equal(state?._count.attachments, 4);
        assert.equal(state!._count.attachments + 1, 5);
      }
      const requestId = randomUUID(), secondRequestId = randomUUID(), barrier = holdRead(f.options.namespace, requestId);
      const pending = attributed(() => f.update(a.id, "Synthetic first addition", [file(4)]), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Writer barrier not reached"); })]));
        const observed = await observe(async () => {
          await attributed(() => second.update({ id: a.id, title: "Synthetic second addition", content: input().content, attachments: [file(5)], removeAttachmentIds: [] }), secondRequestId);
          barrier.release.resolve(); await pending;
        });
        assert.ok(observed.conflicts > 0);
      } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      const detail = await f.repo.getDetail(a.id); assert.ok(detail);
      assert.equal(detail.attachments.length, 6);
      assert.equal(new Set(detail.attachments.map(row => row.fileName)).size, 6);
      for (const request of [requestId, secondRequestId]) assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId: request }), 2);
    });
    await suite.test("download parent and file use one snapshot when delete commits after parent read", async () => {
      const f = await fixture(), a = await f.repo.create(input()), attachment = (await f.repo.getDetail(a.id))!.attachments[0], requestId = randomUUID(), barrier = holdRead(f.options.namespace, requestId);
      const pending = attributed(() => f.repo.download(a.id, attachment.id), requestId); void pending.catch(() => {});
      try { await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Download barrier not reached"); })])); await attributed(() => f.repo.softDelete(a.id, actor)); barrier.release.resolve(); const downloaded = await pending; assert.ok(downloaded); assert.equal(hash(downloaded.data), hash(file(0).data)); } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      assert.equal(await f.repo.download(a.id, attachment.id), null);
    });
    await suite.test("101 real rows paginate list and attachment metadata without truncation or getMore", async () => {
      const f = await fixture(), parent = await f.repo.create(input([]));
      const parents = Array.from({ length: 100 }, (_, i) => encodeMongoRuntimeDocument("Announcement", completeMongoRow("Announcement", { id: randomUUID(), title: `Synthetic page ${i}`, content: "Synthetic content", authorEmail: actor, authorName: null, createdAt: new Date(2_000_000_000_000 + i), updatedAt: new Date(2_000_000_000_000 + i) })));
      await f.store.collection("Announcement").insertMany(parents);
      const attachments = Array.from({ length: 101 }, (_, i) => encodeMongoRuntimeDocument("AnnouncementAttachment", completeMongoRow("AnnouncementAttachment", { id: randomUUID(), announcementId: parent.id, ...file(i), createdAt: new Date(2_000_000_000_000 + i) })));
      await f.store.collection("AnnouncementAttachment").insertMany(attachments);
      const observed = await observe(async () => ({ list: await f.repo.list(), detail: await f.repo.getDetail(parent.id) }));
      assert.equal(observed.result.list.length, 101); assert.ok(observed.result.detail); assert.deepEqual(observed.result.detail.attachments.map(row => row.fileName), Array.from({ length: 101 }, (_, i) => file(i).fileName)); assert.ok(!observed.names.includes("getMore"));
    });
    for (const target of ["list", "attachments"] as const) await suite.test(`${target} byte budget rejects oversized cursor BSON without partial results (injected document, not stored boundary)`, async () => {
      const f = await fixture(), parent = await f.repo.create(input()), before = await f.snapshot(), original = AbstractCursor.prototype[Symbol.asyncIterator]; let measured = 0;
      // BSON's namespace is frozen. Inject a document through the public cursor,
      // leaving calculateObjectSize real; reject by budget before codec validation.
      const payload = Buffer.alloc((target === "list" ? 32 : 64) * 1024 * 1024 + 1);
      const restoreIterator = replaceCursorIterator(async function* (this: AbstractCursor) {
        for await (const document of { [Symbol.asyncIterator]: () => original.call(this) }) {
          if (this.namespace.collection === `${f.options.namespace}_${target === "list" ? "Announcement" : "AnnouncementAttachment"}`) { measured++; yield { ...document, syntheticBudget: payload }; }
          else yield document;
        }
      });
      try { await assert.rejects(target === "list" ? f.repo.list() : f.repo.getDetail(parent.id), code(target === "list" ? "SCAN_LIMIT_EXCEEDED" : "ATTACHMENT_SCAN_LIMIT")); } finally { restoreIterator(); }
      assert.equal(measured, 1); assert.deepEqual(await f.snapshot(), before);
    });
    for (const target of ["list", "attachments"] as const) await suite.test(`${target} row budget rejects 20001 cursor deliveries (injected repetition, not a real 20k-row DB boundary)`, async t => {
      const f = await fixture(), parent = await f.repo.create(input([file(0, 1)])), before = await f.snapshot(), original = AbstractCursor.prototype[Symbol.asyncIterator]; let delivered = 0;
      const restoreIterator = replaceCursorIterator(async function* (this: AbstractCursor) {
        if (this.namespace.collection !== `${f.options.namespace}_${target === "list" ? "Announcement" : "AnnouncementAttachment"}`) { yield* original.call(this); return; }
        for await (const document of { [Symbol.asyncIterator]: () => original.call(this) }) {
          for (let i = 0; i < 20_001; i++) { delivered++; yield document; }
          return;
        }
      });
      try { await assert.rejects(target === "list" ? f.repo.list() : f.repo.getDetail(parent.id), code(target === "list" ? "SCAN_LIMIT_EXCEEDED" : "ATTACHMENT_SCAN_LIMIT")); } finally { restoreIterator(); }
      assert.equal(delivered, 20_001); assert.deepEqual(await f.snapshot(), before); t.diagnostic("20k real database boundary not executed; public cursor repetition validates the counter only");
    });
    for (const phase of ["list", "attachments", "audit"] as const) await suite.test(`${phase}: virtual elapsed clock rejects final-page/late-write success and preserves raw state`, async () => {
      const f = await fixture(), parent = await f.repo.create(input()), before = await f.snapshot(), now = performance.now.bind(performance), close = AbstractCursor.prototype.close, insert = Collection.prototype.insertOne; let elapsed = 0;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const cursor = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) { await close.apply(this, args); if (phase !== "audit" && this.namespace.collection === `${f.options.namespace}_${phase === "list" ? "Announcement" : "AnnouncementAttachment"}`) elapsed = 16_000; });
      const audit = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) { const result = await insert.apply(this, args); if (phase === "audit" && this.collectionName === `${f.options.namespace}_ActivityChange`) elapsed = 30_001; return result; });
      try { await assert.rejects(phase === "list" ? f.repo.list() : phase === "attachments" ? f.repo.getDetail(parent.id) : attributed(() => f.update(parent.id)), code(phase === "list" ? "SCAN_TIMEOUT" : phase === "attachments" ? "ATTACHMENT_SCAN_TIMEOUT" : "ANNOUNCEMENT_TIMEOUT")); }
      finally { cursor.mock.restore(); audit.mock.restore(); clock.mock.restore(); }
      assert.equal(elapsed, phase === "audit" ? 30_001 : 16_000); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("real write conflict plus virtual20s+15s proves retry does not reset total30s deadline", async () => {
      const f = await fixture(), parent = await f.repo.create(input()), requestId = randomUUID(), held = signal(), release = signal(), write = Collection.prototype.updateOne, insert = Collection.prototype.insertOne, now = performance.now.bind(performance);
      let elapsed = 0, paused = false, conflicts = 0, inserted = 0; let winner: Awaited<ReturnType<typeof f.snapshot>> | undefined;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const ours = this.collectionName === `${f.options.namespace}_Announcement` && activityContext.getStore()?.requestId === requestId;
        if (ours && !paused) { paused = true; held.resolve(); await release.promise; }
        try { return await write.apply(this, args); } catch (error) { if (ours && (error as { code?: number }).code === 112) { conflicts++; elapsed = 20_000; } throw error; }
      });
      const audit = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) { const result = await insert.apply(this, args); if (this.collectionName === `${f.options.namespace}_ActivityChange` && activityContext.getStore()?.requestId === requestId) { assert.equal(conflicts, 1); inserted++; elapsed += 15_000; } return result; });
      const pending = attributed(() => f.update(parent.id, "Synthetic expired retry"), requestId); void pending.catch(() => {});
      try { await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Retry barrier not reached"); })])); const observed = await observe(async () => { await attributed(() => f.update(parent.id, "Synthetic retained winner")); winner = await f.snapshot(); release.resolve(); await assert.rejects(pending, code("ANNOUNCEMENT_TIMEOUT")); }); assert.ok(observed.conflicts > 0); }
      finally { release.resolve(); await Promise.allSettled([pending]); audit.mock.restore(); patch.mock.restore(); clock.mock.restore(); }
      assert.equal(conflicts, 1); assert.equal(inserted, 1); assert.equal(elapsed, 35_000); assert.ok(winner); assert.deepEqual(await f.snapshot(), winner);
    });
    for (const problem of ["validator", "index"] as const) await suite.test(`open rejects ${problem} without DDL repair`, async () => {
      const f = await fixture(), collection = f.store.collection("AnnouncementAttachment");
      if (problem === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "moderate" }); else { const name = operationMongoIndexes("AnnouncementAttachment")[0]?.name; assert.ok(name); await collection.dropIndex(name); }
      const observed = await observe(() => assert.rejects(MongoAnnouncementRepository.open(f.options), safe)); assert.ok(!observed.names.some(name => ["create", "createIndexes", "collMod", "insert", "update", "delete"].includes(name)));
    });
  } finally { try { if (connected) { assert.match(databaseName, /^hub_om_shadow_announcement_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } } finally { try { await client.close(); } finally { for (const key of keys) { const value = saved.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; } } } }
});
