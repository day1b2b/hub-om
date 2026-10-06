import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { AbstractCursor, BSON, Collection, MongoClient, type CommandFailedEvent, type CommandStartedEvent, type CommandSucceededEvent, type Document } from "mongodb";
import { activityContext } from "../activity/context";
import { DELETED_OPERATION_MODELS, MongoDeletedOperationRepository, prepareMongoDeletedOperationStore } from "./mongoDeletedOperationRepository";
import type { DeletedOperationRepository } from "./deletedOperationRepository";
import { MongoCourseAdminRepository, prepareMongoCourseAdminStore } from "./mongoCourseAdminRepository";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationError, MongoOperationStore, completeMongoRow, prepareMongoOperationStore, operationMongoIndexes, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_DELETED_OPERATION_TEST_URI;
const operator = "synthetic-restore@example.invalid";
const oldDate = new Date("2090-01-01T00:00:00.000Z");
function withActor<T>(work: () => Promise<T>, requestId = randomUUID()) {
  return activityContext.run({ requestId, actorType: "user", actorEmail: operator, actorName: "Synthetic restore actor", route: "/api/admin/deleted-operations", method: "PUT" }, work);
}
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic barrier deadline")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
function safeError(error: unknown) {
  assert.ok(error instanceof MongoOperationError);
  assert.doesNotMatch(String(error), /synthetic-restore@example.invalid|Synthetic private detail|synthetic-injected-secret/);
  return true;
}

test("deleted operations repository on an isolated Mongo replica set", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const databaseName = `hub_om_shadow_deleted_operations_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture(deletedCount = 2, writers = false, large = false) {
    const options = { client, databaseName, namespace: `shadow_deleted_operations_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoDeletedOperationStore(options);
    if (writers) {
      await prepareMongoOperationStore({ ...options, processSequenceHighWater: 1000 });
      await prepareMongoCourseAdminStore(options);
    }
    const store = new MongoOperationStore(options, DELETED_OPERATION_MODELS);
    const insert = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
    };
    const company = await insert("Company", { name: "Synthetic company", normalizedName: "synthetic-company" });
    const course = await insert("Course", { companyId: company.id, processSeq: 533, courseId: "SYNTHETIC-COURSE", name: "Synthetic course" });
    const sessionValues = (n: number, deletedAt: Date | null): MongoRow => ({
      operationId: `SYNTHETIC-OP-${n}`, courseRecordId: course.id, roundNo: n === 0 ? null : String(n),
      startDate: new Date("2099-09-01"), endDate: new Date("2099-09-02"), educationDates: [],
      deletedAt, deletedBy: deletedAt ? operator : null, updatedAt: oldDate,
      omName: "Synthetic private owner", createdBy: "synthetic-creator@example.invalid",
      operationDetail: large ? "x".repeat(5 * 1024 * 1024) : "Synthetic private detail"
    });
    const deleted: MongoRow[] = [];
    for (let n = 0; n < deletedCount; n++) deleted.push(await insert("OperationSession", sessionValues(n, new Date(Date.UTC(2099, 9, n + 1)))));
    const live = await insert("OperationSession", sessionValues(deletedCount, null));
    const repo: DeletedOperationRepository = await MongoDeletedOperationRepository.open(options);
    const snapshot = async (): Promise<Record<string, Document[]>> => Object.fromEntries(await Promise.all(DELETED_OPERATION_MODELS.map(async (model: string) => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()])));
    const replace = async (model: string, id: string, values: MongoRow) => {
      const row = await store.one(model, { _id: id }); assert.ok(row);
      await store.collection(model).replaceOne({ _id: id }, encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...row, ...values })));
    };
    return { options, store, repo, company, course, deleted, live, insert, replace, snapshot };
  }
  async function wire<T>(work: () => Promise<T>) {
    const names: string[] = [], sessions = new Set<string>(), reads = new Map<number, string>();
    const batches: Array<{ collection: string; count: number; bytes: number }> = []; let conflicts = 0;
    const started = (event: CommandStartedEvent) => {
      if (event.databaseName === databaseName && event.commandName === "find") reads.set(event.requestId, String(event.command.find));
      const sessionId = event.command.lsid?.id?.toString();
      if (event.databaseName === databaseName && sessionId) sessions.add(sessionId);
      if (event.databaseName === databaseName || (event.databaseName === "admin" && sessions.has(sessionId))) names.push(event.commandName);
    };
    const failed = (event: CommandFailedEvent) => { if ((event.failure as { code?: number }).code === 112) conflicts++; };
    const succeeded = (event: CommandSucceededEvent) => {
      const reply = event.reply as Document;
      if (reply.writeErrors?.some((error: { code: number }) => error.code === 112)) conflicts++;
      const collection = reads.get(event.requestId);
      if (collection && reply.cursor) batches.push({ collection, count: reply.cursor.firstBatch.length, bytes: BSON.calculateObjectSize(reply) });
      reads.delete(event.requestId);
    };
    client.on("commandStarted", started); client.on("commandFailed", failed); client.on("commandSucceeded", succeeded);
    try { return { result: await work(), names, batches, get conflicts() { return conflicts; } }; }
    finally { client.off("commandStarted", started); client.off("commandFailed", failed); client.off("commandSucceeded", succeeded); }
  }
  // Hold after a real snapshot read, before its first write. Competing callers keep using Mongo.
  function holdSessionRead(namespace: string, requestId: string) {
    const held = signal(), release = signal(), original = AbstractCursor.prototype.close; let paused = false;
    const patch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) {
      await original.apply(this, args);
      if (!paused && this.namespace.collection === `${namespace}_OperationSession` && activityContext.getStore()?.requestId === requestId) {
        paused = true; held.resolve(); await release.promise;
      }
    });
    return { held, release, patch };
  }
  try {
    await client.connect(); connected = true;
    await suite.test("list returns exactly the original eight fields, descending deletedAt, and excludes live rows without writes", async () => {
      const f = await fixture(), before = await f.snapshot();
      const observed = await wire(() => withActor(() => f.repo.listDeletedOperations()));
      assert.deepEqual(observed.result, [
        { operationId: "SYNTHETIC-OP-1", companyName: "Synthetic company", courseName: "Synthetic course", roundNo: "1", startDate: "2099-09-01", endDate: "2099-09-02", deletedAt: "2099-10-02T00:00:00.000Z", deletedBy: operator },
        { operationId: "SYNTHETIC-OP-0", companyName: "Synthetic company", courseName: "Synthetic course", roundNo: null, startDate: "2099-09-01", endDate: "2099-09-02", deletedAt: "2099-10-01T00:00:00.000Z", deletedBy: operator }
      ]);
      assert.doesNotMatch(JSON.stringify(observed.result), /PiiIndex|Encrypted|Synthetic private|synthetic-creator/);
      assert.ok(!observed.names.some(name => ["insert", "update", "delete", "create", "collMod", "createIndexes"].includes(name)));
      assert.deepEqual(await f.snapshot(), before);
      await f.replace("OperationSession", String(f.deleted[0].id), { deletedAt: f.deleted[1].deletedAt });
      assert.deepEqual(new Set((await f.repo.listDeletedOperations()).map(row => row.operationId)), new Set(["SYNTHETIC-OP-0", "SYNTHETIC-OP-1"]));
    });
    await suite.test("deleted/live/repeated restore clears deleted metadata, refreshes updatedAt, and preserves every unrelated stored field", async () => {
      const f = await fixture();
      for (const target of [f.deleted[0], f.live, f.deleted[0]]) {
        const before = await f.snapshot();
        // Exercise a real replay after a time interval, not strict growth in one millisecond.
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.deepEqual(await withActor(() => f.repo.restoreOperation(String(target.operationId))), { operationId: target.operationId });
        const after = await f.snapshot();
        assert.deepEqual(after.Company, before.Company); assert.deepEqual(after.Course, before.Course);
        for (const original of before.OperationSession) {
          const current = after.OperationSession.find(row => row._id === original._id); assert.ok(current);
          if (original._id !== target.id) { assert.deepEqual(current, original); continue; }
          assert.equal(current.deletedAt, null); assert.equal(current.deletedBy, null); assert.equal(current.deletedByPiiIndex, null);
          assert.notDeepEqual(current.updatedAt, original.updatedAt);
          for (const key of Object.keys(original)) if (!["deletedAt", "deletedBy", "deletedByPiiIndex", "updatedAt"].includes(key)) assert.deepEqual(current[key], original[key], key);
        }
      }
      const audits = await f.store.scan("ActivityChange", {}); assert.equal(audits.length, 1);
      assert.equal(audits[0].action, "restore"); assert.equal(audits[0].targetId, f.deleted[0].id);
      assert.equal(audits[0].actorEmail, operator); assert.deepEqual(audits[0].changes, { deleted_at: { redacted: true } });
      assert.doesNotMatch(JSON.stringify((await f.snapshot()).ActivityChange), /synthetic-restore@example.invalid/);
    });
    await suite.test("operation ID is exact text including empty, whitespace, padding, and case; missing ID fails unchanged", async () => {
      const f = await fixture(0);
      const empty = await wire(() => f.repo.listDeletedOperations());
      assert.deepEqual(empty.result, []); assert.ok(!empty.names.includes("getMore"));
      for (const operationId of ["", " ", "SyntheticCase", "syntheticcase", "  padded  "]) {
        const row = await f.insert("OperationSession", { ...completeMongoRow("OperationSession", f.live), id: randomUUID(), operationId, deletedAt: oldDate, deletedBy: operator });
        assert.deepEqual(await f.repo.restoreOperation(operationId), { operationId });
        assert.equal((await f.store.one("OperationSession", { _id: String(row.id) }))?.deletedAt, null);
      }
      const before = await f.snapshot();
      for (const operationId of ["SYNTHETICCASE", "padded", "missing"]) await assert.rejects(f.repo.restoreOperation(operationId), safeError);
      assert.deepEqual(await f.snapshot(), before);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0);
    });
    await suite.test("live row with stale deletedBy is cleaned without a logical audit", async () => {
      const f = await fixture(0);
      await f.replace("OperationSession", String(f.live.id), { deletedBy: operator });
      const before = await f.snapshot();
      assert.deepEqual(await withActor(() => f.repo.restoreOperation(String(f.live.operationId))), { operationId: f.live.operationId });
      const raw = await f.store.collection("OperationSession").findOne({ _id: String(f.live.id) }); assert.ok(raw);
      assert.equal(raw.deletedAt, null); assert.equal(raw.deletedBy, null); assert.equal(raw.deletedByPiiIndex, null);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0);
      const original = before.OperationSession.find(row => row._id === f.live.id); assert.ok(original);
      for (const key of Object.keys(original)) if (!["deletedBy", "deletedByPiiIndex", "updatedAt"].includes(key)) assert.deepEqual(raw[key], original[key]);
    });
    await suite.test("a real post-insert audit failure rolls back restored row and audit", async () => {
      const f = await fixture(), before = await f.snapshot(), original = Collection.prototype.insertOne; let inserts = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange`) { inserts++; throw new Error("synthetic-injected-secret"); }
        return result;
      });
      try { await assert.rejects(withActor(() => f.repo.restoreOperation(String(f.deleted[0].operationId))), safeError); }
      finally { patch.mock.restore(); }
      assert.equal(inserts, 1); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("list relation names and rows share one snapshot while relationships change", async () => {
      const f = await fixture(), requestId = randomUUID(), barrier = holdSessionRead(f.options.namespace, requestId);
      const pending = withActor(() => f.repo.listDeletedOperations(), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Snapshot barrier not reached"); })]));
        await f.replace("Company", String(f.company.id), { name: "Synthetic changed company" });
        await f.replace("Course", String(f.course.id), { name: "Synthetic changed course" });
        barrier.release.resolve(); const rows = await pending;
        assert.ok(rows.every(row => row.companyName === "Synthetic company" && row.courseName === "Synthetic course"));
      } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      assert.ok((await f.repo.listDeletedOperations()).every(row => row.companyName === "Synthetic changed company" && row.courseName === "Synthetic changed course"));
    });
    for (const relation of ["course", "company"] as const) {
      await suite.test(`missing ${relation} relation fails closed rather than returning an empty list`, async () => {
        const f = await fixture();
        if (relation === "course") await f.replace("OperationSession", String(f.deleted[0].id), { courseRecordId: randomUUID() });
        else await f.replace("Course", String(f.course.id), { companyId: randomUUID() });
        const before = await f.snapshot(); await assert.rejects(f.repo.listDeletedOperations(), safeError); assert.deepEqual(await f.snapshot(), before);
      });
    }
    for (const corruption of ["key", "hmac"] as const) {
      await suite.test(`${corruption} mismatch exposes no key/PII and changes no rows`, async () => {
        const f = await fixture(), savedKeys = process.env.PII_ENCRYPTION_KEYS!;
        if (corruption === "key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
        else await f.store.collection("OperationSession").updateOne({ _id: String(f.deleted[0].id) }, { $set: { deletedByPiiIndex: "0".repeat(64) } });
        const before = await f.snapshot();
        try {
          await assert.rejects(f.repo.listDeletedOperations(), safeError);
          await assert.rejects(withActor(() => f.repo.restoreOperation(String(f.deleted[0].operationId))), safeError);
          assert.deepEqual(await f.snapshot(), before);
        } finally { process.env.PII_ENCRYPTION_KEYS = savedKeys; }
      });
    }
    await suite.test("101 deleted rows cross pages without missing IDs or getMore", async () => {
      const f = await fixture(101), observed = await wire(() => f.repo.listDeletedOperations());
      assert.equal(observed.result.length, 101);
      assert.deepEqual(new Set(observed.result.map(row => row.operationId)), new Set(f.deleted.map(row => row.operationId)));
      assert.ok(!observed.names.includes("getMore"));
      for (let n = 1; n < observed.result.length; n++) assert.ok(String(observed.result[n - 1].deletedAt) >= String(observed.result[n].deletedAt));
    });
    await suite.test("real BSON-short batches continue to EOF without getMore", async () => {
      const f = await fixture(3, false, true), observed = await wire(() => f.repo.listDeletedOperations());
      assert.equal(observed.result.length, 3); assert.ok(!observed.names.includes("getMore"));
      const pages = observed.batches.filter(page => page.collection === `${f.options.namespace}_OperationSession`);
      assert.ok(pages.some(page => page.count > 0 && page.count < 3 && page.bytes > 6 * 1024 * 1024));
      assert.ok(pages.filter(page => page.count > 0).length >= 2); assert.ok(pages.some(page => page.count === 0));
    });
    await suite.test("real scan byte bound rejects without changing stored data", async () => {
      const f = await fixture(6, false, true), before = await f.snapshot();
      await assert.rejects(f.repo.listDeletedOperations(), /SCAN_LIMIT_EXCEEDED/); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("simulated 15-second scan deadline refuses a late page and leaves data unchanged", async () => {
      const f = await fixture(), before = await f.snapshot(), original = AbstractCursor.prototype.close;
      const now = performance.now.bind(performance); let elapsed = 0;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) {
        await original.apply(this, args);
        if (this.namespace.collection === `${f.options.namespace}_OperationSession`) elapsed = 16_001;
      });
      try { await assert.rejects(f.repo.listDeletedOperations(), /SCAN_TIMEOUT/); }
      finally { patch.mock.restore(); clock.mock.restore(); }
      assert.equal(elapsed, 16_001); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("simulated 30-second transaction deadline after real audit insertion rolls back late success", async () => {
      const f = await fixture(), before = await f.snapshot(), original = Collection.prototype.insertOne;
      const now = performance.now.bind(performance); let elapsed = 0, audits = 0;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange`) { audits++; elapsed = 30_001; }
        return result;
      });
      try { await assert.rejects(withActor(() => f.repo.restoreOperation(String(f.deleted[0].operationId))), error => { safeError(error); assert.match((error as MongoOperationError).code, /TIMEOUT/); return true; }); }
      finally { patch.mock.restore(); clock.mock.restore(); }
      assert.equal(audits, 1); assert.deepEqual(await f.snapshot(), before);
    });
    for (const writer of ["update", "delete", "bulk"] as const) for (const restoreLast of [false, true]) {
      await suite.test(`${writer} and restore conflict with restore ${restoreLast ? "last" : "first"}: serial last action wins without lost edits`, async () => {
        const f = await fixture(1, true), operations = await MongoOperationRepository.open(f.options), bulk = await MongoCourseAdminRepository.open(f.options);
        const operationId = String(f.live.operationId), requestId = randomUUID(), before = await f.snapshot();
        const barrier = holdSessionRead(f.options.namespace, requestId);
        const competingWriter = async () => {
          if (writer === "update") return operations.updateOperation(operationId, { om: "Synthetic concurrent owner" }, operator);
          if (writer === "delete") return operations.deleteOperation(operationId, operator);
          return bulk.softDeleteCourseSessions(String(f.course.id), operator);
        };
        const pending = withActor<unknown>(() => restoreLast ? f.repo.restoreOperation(operationId) : competingWriter(), requestId); void pending.catch(() => {});
        try {
          await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Cross-writer barrier not reached"); })]));
          const observed = await wire(async () => {
            if (restoreLast) {
              const result = await withActor(competingWriter); if (writer === "bulk") assert.equal(result, 1);
            } else assert.deepEqual(await withActor(() => f.repo.restoreOperation(operationId)), { operationId });
            barrier.release.resolve(); const result = await pending;
            if (restoreLast) assert.deepEqual(result, { operationId });
            else if (writer === "bulk") assert.equal(result, 1);
          });
          assert.ok(observed.conflicts > 0, "a real server write conflict must force a fresh snapshot");
        } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
        const row = await f.store.one("OperationSession", { _id: String(f.live.id) }); assert.ok(row);
        const isDeleted = !restoreLast && writer !== "update";
        assert.equal(row.deletedAt !== null, isDeleted);
        assert.equal(row.deletedBy, isDeleted ? operator : null);
        assert.equal(row.omName, writer === "update" ? "Synthetic concurrent owner" : "Synthetic private owner");
        assert.equal((await operations.getOperationById(operationId)) === null, isDeleted);
        const after = await f.snapshot(); assert.deepEqual(after.Course, before.Course); assert.deepEqual(after.Company, before.Company);
        assert.deepEqual(after.OperationSession.find(row => row._id === f.deleted[0].id), before.OperationSession.find(row => row._id === f.deleted[0].id));
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "update" }), writer === "update" ? 1 : 0);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "delete" }), writer === "update" ? 0 : 1);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "restore" }), restoreLast && writer !== "update" ? 1 : 0);
      });
    }
    await suite.test("bulk excludes an already-deleted row while restore is pending: no conflict is required", async () => {
      const f = await fixture(1, true), bulk = await MongoCourseAdminRepository.open(f.options), requestId = randomUUID();
      // Leave only deleted rows in the course before the competing operations start.
      await f.repo.restoreOperation(String(f.live.operationId));
      const operations = await MongoOperationRepository.open(f.options);
      await operations.deleteOperation(String(f.live.operationId), operator);
      const barrier = holdSessionRead(f.options.namespace, requestId), operationId = String(f.deleted[0].operationId);
      const pending = withActor(() => f.repo.restoreOperation(operationId), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Excluded-row barrier not reached"); })]));
        const observed = await wire(async () => {
          assert.equal(await withActor(() => bulk.softDeleteCourseSessions(String(f.course.id), operator)), 0);
          barrier.release.resolve(); assert.deepEqual(await pending, { operationId });
        });
        assert.equal(observed.conflicts, 0);
      } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "restore" }), 1);
    });
    await suite.test("individual delete that read an already-deleted row fails its active predicate even if restore then commits", async () => {
      const f = await fixture(1, true), operations = await MongoOperationRepository.open(f.options), requestId = randomUUID();
      const operationId = String(f.deleted[0].operationId), barrier = holdSessionRead(f.options.namespace, requestId);
      const pending = withActor(() => operations.deleteOperation(operationId, operator), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Active-predicate barrier not reached"); })]));
        const observed = await wire(async () => {
          await withActor(() => f.repo.restoreOperation(operationId)); barrier.release.resolve();
          await assert.rejects(pending, /OPERATION_NOT_FOUND/);
        });
        assert.equal(observed.conflicts, 0);
      } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      assert.ok(await operations.getOperationById(operationId));
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
    });
    await suite.test("two concurrent restores produce one logical restore audit after conflict retry", async () => {
      const f = await fixture(1), requestId = randomUUID(), barrier = holdSessionRead(f.options.namespace, requestId), operationId = String(f.deleted[0].operationId);
      const pending = withActor(() => f.repo.restoreOperation(operationId), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Restore barrier not reached"); })]));
        const observed = await wire(async () => {
          assert.deepEqual(await withActor(() => f.repo.restoreOperation(operationId)), { operationId });
          barrier.release.resolve(); assert.deepEqual(await pending, { operationId });
        });
        assert.ok(observed.conflicts > 0);
      } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      assert.equal((await f.store.one("OperationSession", { _id: String(f.deleted[0].id) }))?.deletedAt, null);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "restore" }), 1);
    });
    await suite.test("real restore conflict retry shares total 30s: simulated 20s plus 15s rejects and preserves the committed winner", async () => {
      const f = await fixture(1), operationId = String(f.deleted[0].operationId), requestId = randomUUID();
      const held = signal(), release = signal(), original = Collection.prototype.updateOne;
      const now = performance.now.bind(performance); let elapsed = 0, paused = false, conflicts = 0, retriedWrites = 0;
      let afterWinner: Record<string, Document[]> | undefined;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const ours = this.collectionName === `${f.options.namespace}_OperationSession` && activityContext.getStore()?.requestId === requestId;
        if (ours && !paused) { paused = true; held.resolve(); await release.promise; }
        try {
          const result = await original.apply(this, args);
          if (ours && conflicts === 1) { retriedWrites++; elapsed += 15_000; }
          return result;
        } catch (error) {
          if (ours && (error as { code?: number }).code === 112) { conflicts++; elapsed = 20_000; }
          throw error;
        }
      });
      const pending = withActor(() => f.repo.restoreOperation(operationId), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Restore first-write barrier not reached"); })]));
        const observed = await wire(async () => {
          await withActor(() => f.repo.restoreOperation(operationId)); afterWinner = await f.snapshot();
          release.resolve();
          await assert.rejects(pending, error => { safeError(error); assert.match((error as MongoOperationError).code, /TIMEOUT/); return true; });
        });
        assert.ok(observed.conflicts > 0);
      } finally { release.resolve(); await Promise.allSettled([pending]); patch.mock.restore(); clock.mock.restore(); }
      assert.equal(conflicts, 1); assert.equal(retriedWrites, 1); assert.equal(elapsed, 35_000);
      assert.ok(afterWinner); assert.deepEqual(await f.snapshot(), afterWinner);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "restore" }), 1);
    });
    for (const problem of ["validator", "index"] as const) {
      await suite.test(`unready ${problem} rejects open without automatic DDL`, async () => {
        const f = await fixture(), collection = f.store.collection("OperationSession");
        if (problem === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "moderate" });
        else { const name = operationMongoIndexes("OperationSession")[0]?.name; assert.ok(name); await collection.dropIndex(name); }
        const observed = await wire(async () => { await assert.rejects(MongoDeletedOperationRepository.open(f.options)); });
        assert.ok(!observed.names.some(name => ["create", "createIndexes", "collMod", "insert", "update", "delete"].includes(name)));
      });
    }
  } finally {
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_deleted_operations_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
