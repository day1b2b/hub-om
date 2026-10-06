import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { AbstractCursor, BSON, Collection, MongoClient, type CommandFailedEvent, type CommandStartedEvent, type CommandSucceededEvent, type Document } from "mongodb";
import { activityContext } from "../activity/context";
import { isEncrypted } from "../privacy/crypto";
import { COURSE_ADMIN_MODELS, MongoCourseAdminRepository, prepareMongoCourseAdminStore } from "./mongoCourseAdminRepository";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationError, MongoOperationStore, prepareMongoOperationStore, operationMongoIndexes, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_COURSE_ADMIN_TEST_URI;
const operator = "synthetic-course-admin@example.invalid";
const oldDate = new Date("2090-01-01T00:00:00.000Z");
function withActor<T>(work: () => Promise<T>, requestId = randomUUID()) {
  return activityContext.run({ requestId, actorType: "user", actorEmail: operator, actorName: "Synthetic course admin", route: "/api/admin/courses/[courseId]", method: "DELETE" }, work);
}
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic conflict barrier timeout")), 10_000); })]); }
  finally { clearTimeout(timer); }
}

/** Explicit synthetic loopback target only; never load application env files. */
test("course admin repository on an isolated Mongo replica set", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const databaseName = `hub_om_shadow_course_admin_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture(activeCount = 2, operations = false, large = false) {
    const options = { client, databaseName, namespace: `shadow_course_admin_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoCourseAdminStore(options);
    if (operations) await prepareMongoOperationStore({ ...options, processSequenceHighWater: 1000 });
    const store = new MongoOperationStore(options, COURSE_ADMIN_MODELS);
    const company = coachFixtureRow("Company", { name: "Synthetic company", normalizedName: "synthetic-company" });
    const course = coachFixtureRow("Course", { id: "abcdefab-1234-4abc-8abc-abcdefabcdef", companyId: company.id, processSeq: 533, courseId: "SYNTHETIC-SHARED", name: "Synthetic target course" });
    const other = coachFixtureRow("Course", { companyId: company.id, processSeq: 534, courseId: "SYNTHETIC-SHARED", name: "Synthetic separate course" });
    const empty = coachFixtureRow("Course", { companyId: company.id, processSeq: 535, courseId: "SYNTHETIC-EMPTY", name: "Synthetic empty course" });
    const makeSession = (n: number, courseRecordId: unknown, extra: MongoRow = {}) => coachFixtureRow("OperationSession", {
      operationId: `SYNTHETIC-OP-${n}`, courseRecordId, deletedAt: null, deletedBy: null, updatedAt: oldDate,
      omName: "Synthetic private owner", ldName: "Synthetic private LD", operationDetail: large ? "x".repeat(5 * 1024 * 1024) : "Synthetic private detail",
      createdBy: "synthetic-creator@example.invalid", updatedBy: "synthetic-editor@example.invalid",
      educationDates: [], startDate: new Date("2099-09-01"), endDate: new Date("2099-09-02"), ...extra
    });
    const active = Array.from({ length: activeCount }, (_, n) => makeSession(n, course.id));
    const deleted = makeSession(activeCount, course.id, { deletedAt: oldDate, deletedBy: "synthetic-prior-deleter@example.invalid" });
    const unrelated = makeSession(activeCount + 1, other.id);
    for (const [model, rows] of [["Company", [company]], ["Course", [course, other, empty]], ["OperationSession", [...active, deleted, unrelated]]] as const) {
      await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    }
    const repo = await MongoCourseAdminRepository.open(options);
    const snapshot = async (): Promise<Record<string, Document[]>> => Object.fromEntries(await Promise.all(COURSE_ADMIN_MODELS.map(async (model: string) => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()])));
    return { options, store, repo, company, course, other, empty, active, deleted, unrelated, snapshot };
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
    await suite.test("lookup returns the exact DTO and only active sessions of the selected course without writes", async () => {
      const f = await fixture(), before = await f.snapshot();
      const observed = await wire(() => f.repo.findCourse(533));
      assert.deepEqual(observed.result, { courseRecordId: f.course.id, processId: "PRC-000533", companyName: "Synthetic company", courseName: "Synthetic target course", activeSessionCount: 2 });
      assert.equal((await f.repo.findCourse(534))?.activeSessionCount, 1);
      assert.equal((await f.repo.findCourse(535))?.activeSessionCount, 0);
      assert.equal(await f.repo.findCourse(999999), null);
      assert.deepEqual(await f.snapshot(), before);
      assert.ok(!observed.names.some(name => ["insert", "update", "delete", "create", "createIndexes"].includes(name)));
      assert.doesNotMatch(JSON.stringify(observed.result), /PiiIndex|Encrypted|Synthetic private|synthetic-creator/);
    });
    await suite.test("uppercase UUID deletion is atomic, audited, preserves unrelated ciphertext, and replays as zero", async () => {
      const f = await fixture(), before = await f.snapshot();
      assert.equal(await withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id).toUpperCase(), operator)), 2);
      const after = await f.snapshot();
      assert.deepEqual(after.Company, before.Company); assert.deepEqual(after.Course, before.Course);
      for (const original of before.OperationSession) {
        const current = after.OperationSession.find(row => row._id === original._id); assert.ok(current);
        if (f.active.some(row => row.id === original._id)) {
          const decoded = await f.store.one("OperationSession", { _id: original._id }); assert.ok(decoded);
          assert.ok(decoded.deletedAt instanceof Date); assert.equal(decoded.deletedBy, operator);
          assert.notDeepEqual(decoded.updatedAt, oldDate);
          assert.ok(isEncrypted(current.deletedBy));
          assert.equal(current.deletedByPiiIndex, mongoRuntimeBlindIndex("OperationSession", "deletedBy", operator));
          const ignored = new Set(["deletedAt", "deletedBy", "deletedByPiiIndex", "updatedAt"]);
          for (const key of Object.keys(original)) if (!ignored.has(key)) assert.deepEqual(current[key], original[key], `unchanged ${key} ciphertext/value`);
        } else assert.deepEqual(current, original);
      }
      const audits = await f.store.scan("ActivityChange", {});
      assert.equal(audits.length, 2); assert.deepEqual(new Set(audits.map(row => row.targetId)), new Set(f.active.map(row => row.id)));
      for (const row of audits) { assert.equal(row.targetType, "operation_sessions"); assert.equal(row.action, "delete"); assert.equal(row.actorEmail, operator); assert.deepEqual(row.changes, { deleted_at: { redacted: true } }); }
      assert.doesNotMatch(JSON.stringify(after.ActivityChange), /synthetic-course-admin@example.invalid|Synthetic private owner/);
      assert.equal(await withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator)), 0);
      assert.deepEqual(await f.snapshot(), after);
      assert.equal((await f.repo.findCourse(533))?.activeSessionCount, 0);
    });
    await suite.test("missing course is null, existing empty course is zero, and null deletedBy remains null", async () => {
      const f = await fixture();
      assert.equal(await f.repo.softDeleteCourseSessions(randomUUID(), null), null);
      assert.equal(await f.repo.softDeleteCourseSessions(String(f.empty.id), null), 0);
      assert.equal(await f.repo.softDeleteCourseSessions(String(f.course.id), null), 2);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0, "no activity context means no fabricated actor audit");
      for (const row of f.active) {
        const raw = await f.store.collection("OperationSession").findOne({ _id: String(row.id) }); assert.ok(raw);
        assert.equal(raw.deletedBy, null); assert.equal(raw.deletedByPiiIndex, null);
      }
    });
    await suite.test("activity with null actor records null identity without inventing a deletedBy", async () => {
      const f = await fixture();
      assert.equal(await activityContext.run({ requestId: randomUUID(), actorType: "anonymous", actorEmail: null, actorName: null, route: "/synthetic/course-admin", method: "DELETE" }, () => f.repo.softDeleteCourseSessions(String(f.course.id), null)), 2);
      const audits = await f.store.scan("ActivityChange", {}); assert.equal(audits.length, 2);
      for (const row of audits) { assert.equal(row.actorEmail, null); assert.equal(row.actorName, null); assert.equal(row.action, "delete"); }
      for (const row of f.active) assert.equal((await f.store.one("OperationSession", { _id: String(row.id) }))?.deletedBy, null);
    });
    await suite.test("second real audit insert failure rolls back every session and audit", async () => {
      const f = await fixture(), before = await f.snapshot(), original = Collection.prototype.insertOne; let inserts = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++inserts === 2) throw new Error("synthetic-sensitive-audit-failure");
        return result;
      });
      try { await assert.rejects(withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator)), error => { assert.ok(error instanceof MongoOperationError); assert.equal(error.code, "COURSE_ADMIN_TRANSACTION_FAILED"); assert.doesNotMatch(String(error), /synthetic-sensitive|synthetic-course-admin@example.invalid/); return true; }); }
      finally { patch.mock.restore(); }
      assert.equal(inserts, 2); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("invalid UUID and out-of-range process sequence reject with fixed codes and no writes", async () => {
      const f = await fixture(), before = await f.snapshot();
      for (const value of ["not-a-uuid", ` ${f.course.id}`, `${f.course.id} `]) {
        await assert.rejects(f.repo.softDeleteCourseSessions(value, operator), error => { assert.ok(error instanceof MongoOperationError); assert.equal(error.code, "COURSE_ADMIN_INVALID_UUID"); return true; });
      }
      for (const value of [NaN, Infinity, 1.5, 2147483648, -2147483649]) {
        await assert.rejects(f.repo.findCourse(value), error => { assert.ok(error instanceof MongoOperationError); assert.equal(error.code, "COURSE_ADMIN_INVALID_PROCESS_SEQ"); return true; });
      }
      assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("simulated total write deadline after the last audit rejects late success and rolls back", async () => {
      const f = await fixture(), before = await f.snapshot(), original = Collection.prototype.insertOne;
      const now = performance.now.bind(performance); let elapsed = 0, audits = 0;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++audits === 2) elapsed = 60_001;
        return result;
      });
      try {
        await assert.rejects(withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator)), error => {
          assert.ok(error instanceof MongoOperationError); assert.equal(error.code, "COURSE_ADMIN_TIMEOUT"); return true;
        });
      } finally { patch.mock.restore(); clock.mock.restore(); }
      assert.equal(audits, 2); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("201 active sessions cross pages and all commit with one audit each and no getMore", async () => {
      const f = await fixture(201);
      assert.equal((await f.repo.findCourse(533))?.activeSessionCount, 201);
      const observed = await wire(() => withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator)));
      assert.equal(observed.result, 201); assert.ok(!observed.names.includes("getMore"));
      assert.equal(await f.store.collection("OperationSession").countDocuments({ courseRecordId: f.course.id, deletedAt: null }), 0);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "delete" }), 201);
      assert.equal((await f.repo.findCourse(534))?.activeSessionCount, 1);
    });
    await suite.test("concurrent deletes re-read after real write conflict and audit each session once", async () => {
      const f = await fixture(), requestId = randomUUID(), barrier = holdSessionRead(f.options.namespace, requestId);
      const pending = withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Deletion barrier not reached"); })]));
        const observed = await wire(async () => {
          const winner = await withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator));
          barrier.release.resolve(); return [winner, await pending];
        });
        assert.deepEqual(observed.result, [2, 0]); assert.ok(observed.conflicts > 0);
      } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 2);
    });
    for (const first of ["update", "delete"] as const) {
      await suite.test(`operation ${first} commits first: cross-repository conflict cannot lose edits or resurrect deleted sessions`, async () => {
        const f = await fixture(2, true), operations = await MongoOperationRepository.open(f.options), requestId = randomUUID();
        const operationId = String(f.active[0].operationId), barrier = holdSessionRead(f.options.namespace, requestId);
        const pending = withActor<unknown>(() => first === "update" ? f.repo.softDeleteCourseSessions(String(f.course.id), operator) : operations.updateOperation(operationId, { om: "Synthetic concurrent owner" }, operator), requestId);
        void pending.catch(() => {});
        try {
          await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Operation barrier not reached"); })]));
          const observed = await wire(async () => {
            if (first === "update") {
              await withActor(() => operations.updateOperation(operationId, { om: "Synthetic concurrent owner" }, operator));
              barrier.release.resolve(); assert.equal(await pending, 2);
            } else {
              assert.equal(await withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator)), 2);
              barrier.release.resolve(); await assert.rejects(pending, /OPERATION_NOT_FOUND/);
            }
          });
          assert.ok(observed.conflicts > 0);
        } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
        const row = await f.store.one("OperationSession", { _id: String(f.active[0].id) }); assert.ok(row?.deletedAt);
        assert.equal(row.omName, first === "update" ? "Synthetic concurrent owner" : "Synthetic private owner");
        assert.equal(await operations.getOperationById(operationId), null);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "delete" }), 2);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "update" }), first === "update" ? 1 : 0);
      });
    }
    for (const writer of ["individual-delete", "course-move"] as const) {
      await suite.test(`${writer} wins against course deletion: retry does not resurrect or delete the moved session`, async () => {
        const f = await fixture(2, true), operations = await MongoOperationRepository.open(f.options), requestId = randomUUID();
        const operationId = String(f.active[0].operationId), barrier = holdSessionRead(f.options.namespace, requestId);
        const pending = withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator), requestId); void pending.catch(() => {});
        try {
          await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Course barrier not reached"); })]));
          const observed = await wire(async () => {
            if (writer === "individual-delete") await withActor(() => operations.deleteOperation(operationId, operator));
            else await withActor(() => operations.updateOperation(operationId, { courseName: String(f.other.name) }, operator));
            barrier.release.resolve(); assert.equal(await pending, 1);
          });
          assert.ok(observed.conflicts > 0);
        } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
        const row = await f.store.one("OperationSession", { _id: String(f.active[0].id) }); assert.ok(row);
        if (writer === "individual-delete") { assert.ok(row.deletedAt); assert.equal(await operations.getOperationById(operationId), null); }
        else { assert.equal(row.deletedAt, null); assert.equal(row.courseRecordId, f.other.id); assert.ok(await operations.getOperationById(operationId)); }
        assert.equal((await f.repo.findCourse(533))?.activeSessionCount, 0);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "delete" }), writer === "individual-delete" ? 2 : 1);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "update" }), writer === "course-move" ? 1 : 0);
      });
    }
    await suite.test("real BSON-short session batches continue to empty EOF without getMore", async () => {
      const f = await fixture(3, false, true);
      const observed = await wire(() => withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator)));
      assert.equal(observed.result, 3); assert.ok(!observed.names.includes("getMore"));
      const pages = observed.batches.filter(page => page.collection === `${f.options.namespace}_OperationSession`);
      assert.ok(pages.some(page => page.count > 0 && page.count < 3 && page.bytes > 6 * 1024 * 1024));
      assert.ok(pages.filter(page => page.count > 0).length >= 2); assert.ok(pages.some(page => page.count === 0));
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 3);
    });
    await suite.test("real encrypted scan byte limit rejects without partial session or audit writes", async () => {
      const f = await fixture(6, false, true), before = await f.snapshot();
      await assert.rejects(withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator)), /SCAN_LIMIT_EXCEEDED/);
      assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("simulated scan deadline after cursor close rejects without partial changes", async () => {
      const f = await fixture(), before = await f.snapshot(), original = AbstractCursor.prototype.close;
      const now = performance.now.bind(performance); let elapsed = 0;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) {
        await original.apply(this, args);
        if (this.namespace.collection === `${f.options.namespace}_OperationSession`) elapsed = 16_001;
      });
      try { await assert.rejects(withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator)), /SCAN_TIMEOUT/); }
      finally { patch.mock.restore(); clock.mock.restore(); }
      assert.equal(elapsed, 16_001); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("101st real audit succeeds before a late failure rolls back all 201 sessions and audits", async () => {
      const f = await fixture(201), before = await f.snapshot(), original = Collection.prototype.insertOne;
      let auditInserts = 0, writtenSessions = 0, writtenAudits = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++auditInserts === 101) {
          const session = args[1]?.session; assert.ok(session);
          writtenSessions = await f.store.collection("OperationSession").countDocuments({
            _id: { $in: f.active.map(row => String(row.id)) }, deletedAt: { $ne: null }
          }, { session });
          writtenAudits = await f.store.collection("ActivityChange").countDocuments({}, { session });
          assert.equal(writtenSessions, 101); assert.equal(writtenAudits, 101);
          throw new Error("Synthetic late-page audit failure");
        }
        return result;
      });
      try {
        await assert.rejects(withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator)), error => {
          assert.ok(error instanceof MongoOperationError); assert.equal(error.code, "COURSE_ADMIN_TRANSACTION_FAILED"); return true;
        });
      } finally { patch.mock.restore(); }
      assert.equal(auditInserts, 101); assert.equal(writtenSessions, 101); assert.equal(writtenAudits, 101);
      assert.deepEqual(await f.snapshot(), before);
    });

    for (const writer of ["individual-delete", "course-move"] as const) {
      await suite.test(`course bulk deletion wins after ${writer} snapshot read: writer retries to not-found without extra audits`, async () => {
        const f = await fixture(2, true), operations = await MongoOperationRepository.open(f.options), requestId = randomUUID();
        const operationId = String(f.active[0].operationId), barrier = holdSessionRead(f.options.namespace, requestId);
        const pending = withActor<unknown>(() => writer === "individual-delete"
          ? operations.deleteOperation(operationId, operator)
          : operations.updateOperation(operationId, { courseName: String(f.other.name) }, operator), requestId);
        void pending.catch(() => {});
        let afterBulk: Record<string, Document[]> | undefined;
        try {
          await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Reverse writer barrier not reached"); })]));
          const observed = await wire(async () => {
            assert.equal(await withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator)), 2);
            afterBulk = await f.snapshot();
            barrier.release.resolve();
            await assert.rejects(pending, error => {
              assert.ok(error instanceof MongoOperationError); assert.equal(error.code, "OPERATION_NOT_FOUND"); return true;
            });
          });
          assert.ok(observed.conflicts > 0, "the real stale writer must encounter code 112 before retry");
        } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
        assert.ok(afterBulk); assert.deepEqual(await f.snapshot(), afterBulk);
        assert.equal(await operations.getOperationById(operationId), null);
        const row = await f.store.one("OperationSession", { _id: String(f.active[0].id) });
        assert.ok(row?.deletedAt); assert.equal(row.courseRecordId, f.course.id);
        assert.equal((await f.repo.findCourse(533))?.activeSessionCount, 0);
        assert.equal((await f.repo.findCourse(534))?.activeSessionCount, 1);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "delete" }), 2);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "update" }), 0);
      });
    }

    await suite.test("real write conflict retry shares the original deadline: simulated 40s plus 25s rolls back only the failed bulk job", async () => {
      const f = await fixture(2, true), operations = await MongoOperationRepository.open(f.options), requestId = randomUUID();
      const held = signal(), release = signal();
      const originalUpdate = Collection.prototype.updateOne, originalInsert = Collection.prototype.insertOne;
      const now = performance.now.bind(performance);
      let elapsed = 0, paused = false, targetId = "", realConflicts = 0, retryAudits = 0;
      let afterWinner: Record<string, Document[]> | undefined;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const writePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const ours = this.collectionName === `${f.options.namespace}_OperationSession` && activityContext.getStore()?.requestId === requestId;
        if (ours && !paused) {
          paused = true; targetId = String(args[0]._id); held.resolve(); await release.promise;
        }
        try { return await originalUpdate.apply(this, args); }
        catch (error) {
          if (ours && (error as { code?: number }).code === 112) {
            // This is the actual server conflict, not a fabricated TransientTransactionError.
            realConflicts++; elapsed = 40_000;
          }
          throw error;
        }
      });
      const auditPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await originalInsert.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange` && activityContext.getStore()?.requestId === requestId) {
          assert.equal(realConflicts, 1); retryAudits++;
          if (retryAudits === 1) elapsed += 25_000;
        }
        return result;
      });
      const pending = withActor(() => f.repo.softDeleteCourseSessions(String(f.course.id), operator), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("First-write barrier not reached"); })]));
        const target = f.active.find(row => row.id === targetId); assert.ok(target);
        const observed = await wire(async () => {
          await withActor(() => operations.updateOperation(String(target.operationId), { om: "Synthetic retained winner" }, operator));
          afterWinner = await f.snapshot();
          release.resolve();
          await assert.rejects(pending, error => {
            assert.ok(error instanceof MongoOperationError); assert.equal(error.code, "COURSE_ADMIN_TIMEOUT"); return true;
          });
        });
        assert.ok(observed.conflicts > 0);
      } finally { release.resolve(); await Promise.allSettled([pending]); auditPatch.mock.restore(); writePatch.mock.restore(); clock.mock.restore(); }
      assert.equal(realConflicts, 1); assert.equal(retryAudits, 1); assert.equal(elapsed, 65_000);
      assert.ok(afterWinner); assert.deepEqual(await f.snapshot(), afterWinner);
      assert.equal((await f.repo.findCourse(533))?.activeSessionCount, 2);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "delete" }), 0);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ action: "update" }), 1);
    });

    for (const problem of ["validator", "index"] as const) {
      await suite.test(`unready ${problem} refuses open without DDL repair`, async () => {
        const f = await fixture(), collection = f.store.collection("OperationSession");
        if (problem === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "moderate" });
        else { const name = operationMongoIndexes("OperationSession")[0]?.name; assert.ok(name); await collection.dropIndex(name); }
        const observed = await wire(async () => { await assert.rejects(MongoCourseAdminRepository.open(f.options)); });
        assert.ok(!observed.names.some(name => ["create", "createIndexes", "collMod", "insert", "update", "delete"].includes(name)));
      });
    }
  } finally {
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_course_admin_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
