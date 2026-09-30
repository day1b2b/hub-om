/**
 * V10–V12 only. Main owner integrates this file beside the Mongo repositories in
 * src/lib/data before running the repository's native TS loader. No DB execution
 * was performed by this file's author. PG oracle / HTTP status mapping belong to
 * the other owners: here Conflict classes are the repository's 409 contract.
 *
 * Required opt-in: MONGODB_OM_ASSIGNMENT_TEST_URI=
 * mongodb://127.0.0.1:27819/?replicaSet=omassignment20260929
 * Missing URI is an explicit SKIP, never acceptance evidence.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import {
  Collection, MongoClient, MongoServerError,
  type CommandStartedEvent, type CommandFailedEvent, type CommandSucceededEvent,
  type Document
} from "mongodb";
import { activityContext } from "../activity/context";
import { MongoOmAssignmentRepository, prepareMongoOmAssignmentStore } from "./mongoOmAssignmentRepository";
import { OmAssignmentConflict } from "./omRequest/omAssignmentContract";
import { MongoOmRequestRepository } from "./mongoOmRequestRepository";
import { MongoCourseNameRestoreRepository, prepareMongoCourseNameRestoreStore } from "./mongoCourseNameRestoreRepository";
import { CourseNameRestoreConflict } from "./courseNameRestoreRepository";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoDeletedOperationRepository } from "./mongoDeletedOperationRepository";
import { MongoCourseAdminRepository } from "./mongoCourseAdminRepository";
import { MongoOperationBackfillRepository } from "./mongoOperationBackfillRepository";
import { ADMIN_DATABASE_MODELS, MongoAdminDatabaseRepository, prepareMongoAdminDatabaseStore } from "./mongoAdminDatabaseRepository";
import { OPERATION_MODELS, MongoOperationStore, prepareMongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import type { OmRequestInput } from "./omRequest/omRequestTypes";

const uri = process.env.MONGODB_OM_ASSIGNMENT_TEST_URI;
const actor = "synthetic-cross-writer@example.invalid";
const nextOm = "Synthetic OM X", previousOm = "Synthetic OM Y";
const oldDate = new Date("2090-01-01T00:00:00.000Z");
const models = [...new Set([...OPERATION_MODELS, ...ADMIN_DATABASE_MODELS, "OmRequest"])];
const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "AUTH_SECRET", "NEXTAUTH_SECRET"];
type RawSnapshot = Record<string, Document[]>;
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Synthetic native barrier deadline")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
function attributed<T>(requestId: string, work: () => Promise<T>, route = "/api/om-request/assign") {
  return activityContext.run({ requestId, actorEmail: actor, actorName: "Synthetic actor", actorType: "user", route, method: "POST" }, work);
}
const requestInput = (): OmRequestInput => ({
  team: "Synthetic team", ld: "Synthetic LD", company: "Synthetic company", trainingType: "오프라인",
  courseId: "123", courseName: "Synthetic current", courseCategory: "Synthetic category",
  instructorName: "Synthetic instructor", syncupLink: "", driveLink: "", skillfloSetup: "N", skillmatchSetup: "N",
  onSiteOperation: "N", coachRequest: "N", resultReportNeeded: "N", totalSessions: 2,
  sessions: ["2099-09-01", "2099-09-02"].map(date => ({ date, timeStart: "09:00", timeEnd: "10:00", duration: "1", location: "Synthetic room" })),
  notes: "Synthetic private notes"
});

// Sequential subtests are essential: process.env and Collection prototype hooks
// are process-local. Each fixture owns its own client, keys, namespace AND DB.
test("OM assignment V10–V12 native cross-writer evidence", { skip: !uri, timeout: 600_000, concurrency: false }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  // Keep an explicit disposable endpoint allowlist when the full regression uses a fresh server.
  const expectedReplica = url.port === "27829" ? "importstaging20260930" : "omassignment20260929";
  assert.ok(["27819", "27829"].includes(url.port));
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/"); assert.equal(url.hash, "");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]);
  assert.equal(url.searchParams.get("replicaSet"), expectedReplica);

  async function fixture(requestNeedsChange = false) {
    const saved = new Map(envNames.map(name => [name, process.env[name]]));
    Object.assign(process.env, {
      PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
      PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"),
      PII_ALLOW_PLAINTEXT_READS: "false", AUTH_SECRET: randomBytes(32).toString("hex"), NEXTAUTH_SECRET: ""
    });
    const databaseName = `hub_om_shadow_assignment_cross_${randomBytes(8).toString("hex")}`;
    const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    const options = { client, databaseName, namespace: `shadow_assignment_cross_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    let connected = false;
    const cleanup = async () => {
      try {
        if (connected) {
          assert.match(databaseName, /^hub_om_shadow_assignment_cross_[a-f0-9]{16}$/);
          await client.db(databaseName).dropDatabase();
        }
      } finally {
        try { await client.close(); }
        finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
      }
    };
    try {
      await client.connect(); connected = true;
      assert.equal((await client.db(databaseName).command({ hello: 1 })).setName, expectedReplica);
      await prepareMongoOperationStore({ ...options, processSequenceHighWater: 1000 });
      await prepareMongoCourseNameRestoreStore({ ...options, processSequenceHighWater: 1000 });
      await prepareMongoAdminDatabaseStore(options);
      await prepareMongoOmAssignmentStore(options);
      const store = new MongoOperationStore(options, models);
      const insert = async (model: string, values: MongoRow) => {
        const row = coachFixtureRow(model, values);
        await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row));
        return row;
      };
      const company = await insert("Company", { name: "Synthetic company", normalizedName: "synthetic-company", updatedAt: oldDate });
      const course = await insert("Course", { companyId: company.id, courseId: "123", name: "Synthetic current", processSeq: 100, updatedAt: oldDate });
      const target = await insert("Course", { companyId: company.id, courseId: "123\u200b", name: "Synthetic original", processSeq: 101, updatedAt: oldDate });
      const session = (values: MongoRow = {}) => insert("OperationSession", {
        operationId: `SYNTHETIC-${randomUUID()}`, courseRecordId: course.id, startDate: new Date("2099-09-01"), endDate: new Date("2099-09-02"),
        roundNo: null, educationDates: [], deletedAt: null, deletedBy: null, updatedAt: oldDate, updatedBy: null,
        omName: nextOm, omUserId: null, onsiteRequired: "N", operationStatus: "ASSIGNMENT_PLANNED", ...values
      });
      // Fixed ordered UUIDs ensure S2 is the sole changed operation, independent of sort randomness.
      const s1 = await session({ id: "00000000-0000-4000-8000-000000000001", roundNo: "1" });
      const s2 = await session({ id: "00000000-0000-4000-8000-000000000002", roundNo: "2", omName: previousOm });
      for (const row of [s1, s2]) await insert("OperationSourceRecord", {
        operationSessionId: row.id, mappedFields: { courseName: "Synthetic original" },
        rowSnapshot: { private: "Synthetic source only" }, createdAt: new Date("2099-01-03")
      });
      const request = await insert("OmRequest", {
        ...requestInput(), operationId: s1.operationId, assignedOm: requestNeedsChange ? previousOm : nextOm,
        status: "배정완료", createdAt: oldDate
      });
      const batchId = randomUUID();
      const creation = (targetType: string, targetId: unknown, values: MongoRow = {}) => insert("ActivityChange", {
        requestId: batchId, route: "/api/om-request", method: "POST", action: "create", targetType, targetId,
        actorType: "user", actorEmail: actor, actorName: "Synthetic creator", occurredAt: oldDate, changes: {}, ...values
      });
      const requestCreation = await creation("om_requests", request.id);
      const s1Creation = await creation("operation_sessions", s1.id);
      const s2Creation = await creation("operation_sessions", s2.id);
      // V10 requires an existing guard, not V13's first-upsert race.
      const guard = store.db.collection<{ _id: string; nonce: string }>(`${options.namespace}_CourseNameRestoreGuard`);
      await guard.insertOne({ _id: "restore", nonce: randomUUID() });
      const assignment = await MongoOmAssignmentRepository.open(options);
      const restore = await MongoCourseNameRestoreRepository.open(options);
      const requests = await MongoOmRequestRepository.open(options);
      const operations = await MongoOperationRepository.open(options);
      const deleted = await MongoDeletedOperationRepository.open(options);
      const admin = await MongoAdminDatabaseRepository.open(options);
      const backfill = await MongoOperationBackfillRepository.open(options);
      const courses = await MongoCourseAdminRepository.open(options);
      const existing = await requests.getOmRequest(String(request.id)); assert.ok(existing);
      const preview = () => assignment.previewOmAssignment(existing, nextOm, actor);
      const confirm = (token: string) => assignment.assignOmRequestAtomically(existing, nextOm, actor, token);
      const snapshot = async (): Promise<RawSnapshot> => {
        const names = (await store.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).filter(name => name.startsWith(`${options.namespace}_`)).sort();
        return Object.fromEntries(await Promise.all(names.map(async name => [name.slice(options.namespace.length + 1), await store.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
      };
      const audits = (requestId: string) => store.scan("ActivityChange", { requestId });
      const row = async (seed: MongoRow) => { const result = await store.one("OperationSession", { _id: String(seed.id) }); assert.ok(result); return result; };
      return { options, client, store, guard, insert, session, creation, course, target, s1, s2, request, requestCreation, s1Creation, s2Creation,
        batchId, existing, assignment, restore, requests, operations, deleted, admin, backfill, courses, preview, confirm, snapshot, audits, row, cleanup };
    } catch (error) { await cleanup(); throw error; }
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  // Wire evidence is recorded from native driver events, never injected errors.
  // Include owner + session + transaction to prove full callback retry/read order.
  function observe(f: Fixture) {
    type Entry = { owner: string | undefined; session: string; tx: string; name: string; collection: string; ids: string[]; code?: number };
    const entries: Entry[] = [], started = new Map<number, Entry>();
    const start = (event: CommandStartedEvent) => {
      const command = event.command;
      if (event.databaseName !== f.options.databaseName && !["commitTransaction", "abortTransaction"].includes(event.commandName)) return;
      const entry: Entry = {
        owner: activityContext.getStore()?.requestId, session: String(command.lsid?.id ?? ""), tx: String(command.txnNumber ?? ""),
        name: event.commandName, collection: String(command.find ?? command.aggregate ?? command.update ?? command.insert ?? command.delete ?? command.findAndModify ?? ""),
        ids: [
          ...(command.documents ?? []).map((document: Document) => String(document.targetId ?? document._id)),
          ...(command.updates ?? command.deletes ?? []).map((item: Document) => String(item.q?._id)),
          ...(command.findAndModify ? [String(command.query?._id)] : [])
        ]
      };
      entries.push(entry); started.set(event.requestId, entry);
    };
    const failed = (event: CommandFailedEvent) => {
      const entry = started.get(event.requestId);
      if (entry) entry.code = (event.failure as { code?: number }).code;
    };
    const success = (event: CommandSucceededEvent) => {
      const entry = started.get(event.requestId), reply = event.reply as Document;
      const error = reply.writeErrors?.find((item: { code: number }) => item.code === 112);
      if (entry && error) entry.code = error.code;
    };
    f.client.on("commandStarted", start); f.client.on("commandFailed", failed); f.client.on("commandSucceeded", success);
    return {
      entries,
      stop() { f.client.off("commandStarted", start); f.client.off("commandFailed", failed); f.client.off("commandSucceeded", success); },
      assertRetry(owner: string, collection: string) {
        const owned = entries.filter(entry => entry.owner === owner);
        const conflict = owned.find(entry => entry.code === 112 && entry.collection === `${f.options.namespace}_${collection}`);
        assert.ok(conflict, `real driver 112 required at ${collection}`);
        const retry = owned.find(entry => entry.name === "update" && entry.collection.endsWith("_CourseNameRestoreGuard") && entry.tx !== conflict.tx);
        assert.ok(retry, "retry must reacquire the guard in a new transaction");
        assert.equal(retry.session, conflict.session, "withTransaction reuses its independent client session");
        const reads = owned.filter(entry => entry.tx === retry.tx && ["find", "aggregate"].includes(entry.name));
        const rereadModel = collection === "OmRequest" ? "OmRequest" : "OperationSession";
        assert.ok(reads.some(entry => entry.collection.endsWith(`_${rereadModel}`)), "retry re-reads the latest relevant row, including a missing/deleted request");
        for (const entry of reads) assert.ok(entries.indexOf(entry) > entries.indexOf(retry), "retry guard precedes business reads");
        return { conflict, retry };
      },
      assertBusinessBeforeAudit(owner: string, model: string, id: string) {
        const audit = entries.find(entry => entry.owner === owner && entry.name === "insert" && entry.collection.endsWith("_ActivityChange") && entry.ids.includes(id));
        assert.ok(audit, "expected committed owner's audit command");
        const write = entries.find(entry => entry.owner === owner && entry.tx === audit.tx && entry.session === audit.session && ["update", "delete", "findAndModify"].includes(entry.name) && entry.collection === `${f.options.namespace}_${model}` && entry.ids.includes(id));
        assert.ok(write && entries.indexOf(write) < entries.indexOf(audit), "business write precedes audit in the same native transaction");
        const commit = entries.find(entry => entry.owner === owner && entry.name === "commitTransaction" && entry.tx === audit.tx && entry.session === audit.session);
        assert.ok(commit && entries.indexOf(audit) < entries.indexOf(commit), "audit precedes commit");
      }
    };
  }

  // Pause A just before its first business write: all predicate/token reads are
  // complete, guard is owned, but no changed business row is locked yet.
  function holdAssignment(f: Fixture, owner: string) {
    const held = signal(), release = signal(), original = Collection.prototype.updateOne;
    let paused = false;
    const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
      if (!paused && this.collectionName === `${f.options.namespace}_OperationSession` && activityContext.getStore()?.requestId === owner) {
        paused = true; held.resolve(); await bounded(release.promise);
      }
      return original.apply(this, args);
    });
    return { held, release, patch };
  }
  async function waitHeld(held: ReturnType<typeof signal>, pending: Promise<unknown>) {
    await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Expected barrier was not reached"); })]));
  }
  async function assertAudits(f: Fixture, owner: string, expected: Array<[string, string, string]>) {
    const rows = await f.audits(owner);
    assert.deepEqual(rows.map(row => [row.targetType, row.targetId, row.action].join("|")).sort(), expected.map(row => row.join("|")).sort());
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    for (const row of rows) { assert.equal(row.actorEmail, actor); assert.equal(row.actorType, "user"); }
    return rows;
  }

  await suite.test("V10 fixture proves both real signatures depend on each of S1/S2 updatedAt", async () => {
    const f = await fixture();
    const now = Date.now(), clock = mock.method(Date, "now", () => now);
    try {
      const before = await f.snapshot(), initial = await f.preview(), plan = await f.restore.planCourseNameRestore("123");
      assert.equal(initial.count, 2);
      assert.deepEqual(initial.operations.map(row => row.operationId), [f.s1.operationId, f.s2.operationId]);
      assert.deepEqual(plan.rows.map(row => row.operationId).sort(), [f.s1.operationId, f.s2.operationId].sort());
      assert.ok(plan.rows.every(row => row.restorable));
      for (const seed of [f.s1, f.s2]) {
        // Only a timestamp changes. Preserve the exact encrypted original on reset.
        const raw = await f.store.collection("OperationSession").findOne({ _id: String(seed.id) }); assert.ok(raw);
        try {
          await f.store.collection("OperationSession").updateOne({ _id: String(seed.id) }, { $set: { updatedAt: new Date(oldDate.getTime() + 1) } });
          assert.notEqual((await f.preview()).token, initial.token);
          assert.notEqual((await f.restore.planCourseNameRestore("123")).snapshot, plan.snapshot);
        } finally { await f.store.collection("OperationSession").replaceOne({ _id: String(seed.id) }, raw); }
      }
      assert.deepEqual(await f.snapshot(), before);
    } finally { clock.mock.restore(); await f.cleanup(); }
  });

  for (const winnerRole of ["assignment", "restore"] as const) {
    await suite.test(`V10 ${winnerRole} wins: native guard112 / retry / stale loser409 / no disjoint-write mixture`, async () => {
      const f = await fixture();
      try {
        const preview = await f.preview(), plan = await f.restore.planCourseNameRestore("123"), before = await f.snapshot();
        const winnerId = randomUUID(), loserId = randomUUID(), held = signal(), oldSnapshotRead = signal(), releaseWinner = signal(), releaseLoser = signal();
        const original = Collection.prototype.updateOne;
        let winnerHeld = false, loserHeld = false, driver112 = 0;
        const evidence = observe(f);
        const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          const owner = activityContext.getStore()?.requestId, isGuard = this.collectionName === f.guard.collectionName;
          if (isGuard) assert.equal(args[0]._id, "restore", "both real repositories contend on the existing same guard document");
          if (isGuard && owner === loserId && !loserHeld) {
            loserHeld = true;
            const session = args[2]?.session; assert.ok(session);
            // Establish a genuine pre-winner snapshot BEFORE attempting the guard.
            // Never wait for both transactions to acquire the same guard.
            const rows = await f.store.collection("OperationSession").find({}, { session }).toArray();
            assert.equal(rows.length, 2); assert.ok(rows.every(row => row.updatedAt.getTime() === oldDate.getTime()));
            oldSnapshotRead.resolve(); await bounded(releaseLoser.promise);
          }
          try {
            const result = await original.apply(this, args);
            if (isGuard && owner === winnerId && !winnerHeld) {
              winnerHeld = true; held.resolve(); await bounded(releaseWinner.promise);
            }
            return result;
          } catch (error) {
            if (isGuard && owner === loserId && error instanceof MongoServerError && error.code === 112) driver112++;
            throw error;
          }
        });
        const assign = () => f.confirm(preview.token);
        const restore = () => f.restore.applyCourseNameRestore("123", [String(f.s1.operationId)], plan.snapshot, actor);
        const winner = attributed<unknown>(winnerId, winnerRole === "assignment" ? assign : restore);
        void winner.catch(() => {});
        let loser: Promise<unknown> | undefined, committed: RawSnapshot | undefined;
        try {
          await waitHeld(held, winner);
          loser = attributed<unknown>(loserId, winnerRole === "assignment" ? restore : assign); void loser.catch(() => {});
          await waitHeld(oldSnapshotRead, loser);
          releaseWinner.resolve();
          const result = await winner;
          if (winnerRole === "assignment") assert.deepEqual((result as { operationIds: string[] }).operationIds, [f.s2.operationId]);
          else assert.deepEqual(result, { moved: [{ operationId: f.s1.operationId, from: "Synthetic current", to: "Synthetic original" }], skipped: [] });
          committed = await f.snapshot();
          releaseLoser.resolve();
          await assert.rejects(loser, winnerRole === "assignment" ? CourseNameRestoreConflict : OmAssignmentConflict);
          assert.ok(driver112 > 0, "actual MongoServerError112, not a simulated throw");
          const { conflict } = evidence.assertRetry(loserId, "CourseNameRestoreGuard");
          const winnerGuard = evidence.entries.find(entry => entry.owner === winnerId && entry.collection === f.guard.collectionName);
          assert.ok(winnerGuard); assert.notEqual(winnerGuard.session, conflict.session);
          const changed = winnerRole === "assignment" ? f.s2 : f.s1;
          evidence.assertBusinessBeforeAudit(winnerId, "OperationSession", String(changed.id));
          await assertAudits(f, winnerId, [["operation_sessions", String(changed.id), "update"]]);
          await assertAudits(f, loserId, []);
          assert.deepEqual(await f.snapshot(), committed, "loser rolls back its guard and every attempted business/audit write");
        } finally {
          releaseWinner.resolve(); releaseLoser.resolve();
          await Promise.allSettled(loser ? [winner, loser] : [winner]); patch.mock.restore(); evidence.stop();
        }
        assert.ok(committed);
        const s1 = await f.row(f.s1), s2 = await f.row(f.s2);
        assert.equal(s1.omName, nextOm);
        assert.equal(s1.courseRecordId, winnerRole === "restore" ? f.target.id : f.course.id);
        assert.equal(s2.courseRecordId, f.course.id);
        assert.equal(s2.omName, winnerRole === "assignment" ? nextOm : previousOm);
        const unchanged = winnerRole === "assignment" ? f.s1 : f.s2;
        assert.deepEqual(committed.OperationSession.find(row => row._id === unchanged.id), before.OperationSession.find(row => row._id === unchanged.id));
        assert.notDeepEqual((winnerRole === "assignment" ? s2 : s1).updatedAt, oldDate);
        assert.deepEqual(committed.OmRequest, before.OmRequest);
        assert.deepEqual(committed.Course, before.Course);
        assert.deepEqual(committed.__counter, before.__counter, "existing target: no counter or new-course race");
      } finally { await f.cleanup(); }
    });
  }

  const writers = ["OmRequest.patch", "OmRequest.delete", "Operation.update", "Operation.delete", "DeletedOperation.restore", "AdminDatabase.cell", "OperationBackfill", "Course.delete"] as const;
  type Writer = typeof writers[number];
  async function write(f: Fixture, writer: Writer, seed = f.s2) {
    if (writer === "OmRequest.patch") {
      const input = requestInput(); input.sessions[1].date = "2099-10-02";
      assert.ok(await f.requests.updateOmRequest(f.existing.id, input));
    } else if (writer === "OmRequest.delete") assert.equal(await f.requests.deleteOmRequest(f.existing.id), true);
    else if (writer === "Operation.update") await f.operations.updateOperation(String(seed.operationId), { om: "Synthetic writer OM" }, actor);
    else if (writer === "Operation.delete") await f.operations.deleteOperation(String(seed.operationId), actor);
    else if (writer === "DeletedOperation.restore") {
      // Existing contract allows restore on a live row: real updatedAt write,
      // no invented deleted row (which assignment preview would reject).
      assert.deepEqual(await f.deleted.restoreOperation(String(seed.operationId)), { operationId: seed.operationId });
    } else if (writer === "AdminDatabase.cell") await f.admin.updateCell({ table: "operation_sessions", rowId: String(seed.id), field: "omName", value: "Synthetic cell OM", updatedBy: actor });
    else if (writer === "OperationBackfill") assert.equal(await f.backfill.applyOnsiteRequiredBackfill(), 2);
    else assert.equal(await f.courses.softDeleteCourseSessions(String(f.course.id), actor), 2);
  }
  function writerAudits(f: Fixture, writer: Writer, seed = f.s2): Array<[string, string, string]> {
    if (writer === "DeletedOperation.restore") return []; // updatedAt-only replay has no audit by contract.
    if (writer.startsWith("OmRequest")) return [["om_requests", f.existing.id, writer.endsWith("delete") ? "delete" : "update"]];
    const seeds = writer === "OperationBackfill" || writer === "Course.delete" ? [f.s1, f.s2] : [seed];
    return seeds.map(row => ["operation_sessions", String(row.id), writer.endsWith("delete") ? "delete" : "update"]);
  }
  async function assertWriterValue(f: Fixture, writer: Writer, seed = f.s2) {
    const row = await f.row(seed);
    if (writer === "OmRequest.patch") assert.equal((await f.requests.getOmRequest(f.existing.id))?.sessions[1].date, "2099-10-02");
    else if (writer === "OmRequest.delete") assert.equal(await f.requests.getOmRequest(f.existing.id), null);
    else if (writer === "Operation.update") assert.equal(row.omName, "Synthetic writer OM");
    else if (writer === "AdminDatabase.cell") assert.equal(row.omName, "Synthetic cell OM");
    else if (writer === "OperationBackfill") for (const item of [f.s1, f.s2]) assert.equal((await f.row(item)).onsiteRequired, "Y");
    else if (writer === "Operation.delete" || writer === "Course.delete") {
      for (const item of writer === "Course.delete" ? [f.s1, f.s2] : [seed]) assert.ok((await f.row(item)).deletedAt instanceof Date);
    } else { assert.equal(row.deletedAt, null); assert.notDeepEqual(row.updatedAt, oldDate); }
  }

  for (const writer of writers) {
    await suite.test(`V11 real ${writer} commits before overlapping A write: native112 + full re-read + A409`, async () => {
      const f = await fixture(true);
      try {
        const preview = await f.preview(), assignmentId = randomUUID(), writerId = randomUUID();
        const hold = holdAssignment(f, assignmentId), evidence = observe(f);
        const pending = attributed(assignmentId, () => f.confirm(preview.token)); void pending.catch(() => {});
        let committed: RawSnapshot | undefined;
        try {
          await waitHeld(hold.held, pending);
          await attributed(writerId, () => write(f, writer), `/synthetic/${writer}`);
          committed = await f.snapshot();
          await assertWriterValue(f, writer);
          hold.release.resolve(); await assert.rejects(pending, OmAssignmentConflict);
          evidence.assertRetry(assignmentId, writer.startsWith("OmRequest") ? "OmRequest" : "OperationSession");
          assert.deepEqual(await f.snapshot(), committed, "writer is the final state owner; A's partial S2/audit/guard changes must abort");
          await assertAudits(f, assignmentId, []);
          const expected = writerAudits(f, writer);
          await assertAudits(f, writerId, expected);
          for (const [type, id] of expected) evidence.assertBusinessBeforeAudit(writerId, type === "om_requests" ? "OmRequest" : "OperationSession", id);
          assert.equal((await f.row(f.s1)).omName, nextOm);
          if (writer.startsWith("OmRequest")) assert.equal((await f.row(f.s2)).omName, previousOm);
        } finally { hold.release.resolve(); await Promise.allSettled([pending]); hold.patch.mock.restore(); evidence.stop(); }
      } finally { await f.cleanup(); }
    });

    await suite.test(`V11 A commit then real ${writer}: explicit A→writer final ownership / audit order`, async () => {
      const f = await fixture(true);
      try {
        const preview = await f.preview(), assignmentId = randomUUID(), writerId = randomUUID(), evidence = observe(f);
        try {
          const result = await attributed(assignmentId, () => f.confirm(preview.token));
          assert.deepEqual(result.operationIds, [f.s2.operationId]);
          assert.equal((await f.requests.getOmRequest(f.existing.id))?.assignedOm, nextOm);
          assert.equal((await f.row(f.s2)).omName, nextOm);
          await assertAudits(f, assignmentId, [["operation_sessions", String(f.s2.id), "update"], ["om_requests", f.existing.id, "update"]]);
          await attributed(writerId, () => write(f, writer), `/synthetic/${writer}`);
          await assertWriterValue(f, writer);
          await assertAudits(f, writerId, writerAudits(f, writer));
          evidence.assertBusinessBeforeAudit(assignmentId, "OperationSession", String(f.s2.id));
          evidence.assertBusinessBeforeAudit(assignmentId, "OmRequest", f.existing.id);
          const commit = evidence.entries.findIndex(entry => entry.owner === assignmentId && entry.name === "commitTransaction");
          const writerStart = evidence.entries.findIndex(entry => entry.owner === writerId);
          assert.ok(commit >= 0 && writerStart > commit, "A is committed before the actual writer starts");
          if (writer !== "Operation.update" && writer !== "AdminDatabase.cell") assert.equal((await f.row(f.s2)).omName, nextOm);
        } finally { evidence.stop(); }
      } finally { await f.cleanup(); }
    });
  }

  for (const writer of ["Operation.update", "Operation.delete", "DeletedOperation.restore", "AdminDatabase.cell"] as const) {
    await suite.test(`V11 ${writer} on A-noop S1 after A snapshot: both commit, valid one-way A→writer`, async () => {
      const f = await fixture();
      try {
        const preview = await f.preview(), assignmentId = randomUUID(), writerId = randomUUID(), hold = holdAssignment(f, assignmentId), evidence = observe(f);
        const pending = attributed(assignmentId, () => f.confirm(preview.token)); void pending.catch(() => {});
        try {
          await waitHeld(hold.held, pending);
          await attributed(writerId, () => write(f, writer, f.s1), `/synthetic/${writer}`);
          const writerS1 = await f.store.collection("OperationSession").findOne({ _id: String(f.s1.id) });
          hold.release.resolve(); assert.deepEqual((await pending).operationIds, [f.s2.operationId]);
          assert.deepEqual(await f.store.collection("OperationSession").findOne({ _id: String(f.s1.id) }), writerS1);
          await assertWriterValue(f, writer, f.s1); assert.equal((await f.row(f.s2)).omName, nextOm);
          await assertAudits(f, assignmentId, [["operation_sessions", String(f.s2.id), "update"]]);
          await assertAudits(f, writerId, writerAudits(f, writer, f.s1));
          evidence.assertBusinessBeforeAudit(assignmentId, "OperationSession", String(f.s2.id));
          for (const [, id] of writerAudits(f, writer, f.s1)) evidence.assertBusinessBeforeAudit(writerId, "OperationSession", id);
          assert.equal(evidence.entries.filter(entry => entry.code === 112).length, 0, "disjoint writes do not require a conflict");
          if (writer === "Operation.delete") await assert.rejects(f.preview(), OmAssignmentConflict);
          else assert.equal((await f.preview()).count, 2);
        } finally { hold.release.resolve(); await Promise.allSettled([pending]); hold.patch.mock.restore(); evidence.stop(); }
      } finally { await f.cleanup(); }
    });
  }

  const metadataCases = ["extra-operation", "duplicate-operation", "second-request", "duplicate-request", "delete-operation-creation", "delete-request-creation", "edit-route", "retain-valid-metadata"] as const;
  type MetadataCase = typeof metadataCases[number];
  async function mutateMetadata(f: Fixture, kind: MetadataCase) {
    if (kind === "extra-operation") {
      const extra = await f.session({ roundNo: "3" }); await f.creation("operation_sessions", extra.id);
    } else if (kind === "duplicate-operation") await f.creation("operation_sessions", f.s2.id);
    else if (kind === "second-request") {
      const other = await f.insert("OmRequest", { ...requestInput(), operationId: f.s1.operationId, assignedOm: nextOm, status: "배정완료", createdAt: oldDate });
      await f.creation("om_requests", other.id);
    } else if (kind === "duplicate-request") await f.creation("om_requests", f.request.id);
    else if (kind === "delete-operation-creation" || kind === "delete-request-creation") {
      const id = kind === "delete-operation-creation" ? f.s2Creation.id : f.requestCreation.id;
      // Raw retention-equivalent deletion of linking metadata. This is NOT an
      // assertion that the HTTP/PG retention helper was executed in this suite.
      assert.equal((await f.store.collection("ActivityChange").deleteOne({ _id: String(id) })).deletedCount, 1);
    } else if (kind === "edit-route") {
      assert.equal((await f.store.collection("ActivityChange").updateOne({ _id: String(f.s2Creation.id) }, { $set: { route: "/synthetic/unrelated" } })).modifiedCount, 1);
    } else {
      const unrelated = await f.creation("operation_sessions", f.s1.id, { requestId: randomUUID(), action: "update" });
      assert.equal((await f.store.collection("ActivityChange").deleteOne({ _id: String(unrelated.id) })).deletedCount, 1);
    }
  }
  async function freshPreview(f: Fixture) {
    const existing = await f.requests.getOmRequest(f.existing.id); assert.ok(existing);
    return f.assignment.previewOmAssignment(existing, nextOm, actor);
  }
  for (const kind of metadataCases) {
    await suite.test(`V12 raw ${kind} before A snapshot: actual linkage determines preview/confirm outcome`, async () => {
      const f = await fixture();
      try {
        const oldPreview = await f.preview(); await mutateMetadata(f, kind);
        const before = await f.snapshot(), owner = randomUUID();
        if (kind === "retain-valid-metadata") {
          assert.equal((await freshPreview(f)).count, 2);
          assert.deepEqual((await attributed(owner, () => f.confirm(oldPreview.token))).operationIds, [f.s2.operationId]);
        } else {
          await assert.rejects(freshPreview(f), OmAssignmentConflict);
          await assert.rejects(attributed(owner, () => f.confirm(oldPreview.token)), OmAssignmentConflict);
          assert.deepEqual(await f.snapshot(), before, "invalid metadata refuses all assignment business/guard/audit writes");
          await assertAudits(f, owner, []);
        }
      } finally { await f.cleanup(); }
    });
    await suite.test(`V12 raw ${kind} after A snapshot: allow one-way A→metadata; next preview revalidates`, async () => {
      const f = await fixture();
      try {
        const preview = await f.preview(), owner = randomUUID(), hold = holdAssignment(f, owner), evidence = observe(f);
        const pending = attributed(owner, () => f.confirm(preview.token)); void pending.catch(() => {});
        try {
          await waitHeld(hold.held, pending); await mutateMetadata(f, kind);
          const metadata = await f.store.collection("ActivityChange").find({ requestId: f.batchId }).sort({ _id: 1 }).toArray();
          hold.release.resolve(); assert.deepEqual((await pending).operationIds, [f.s2.operationId]);
          assert.equal((await f.row(f.s1)).omName, nextOm); assert.equal((await f.row(f.s2)).omName, nextOm);
          await assertAudits(f, owner, [["operation_sessions", String(f.s2.id), "update"]]);
          assert.deepEqual(await f.store.collection("ActivityChange").find({ requestId: f.batchId }).sort({ _id: 1 }).toArray(), metadata, "assignment must not recreate/edit removed linking history");
          assert.equal(evidence.entries.filter(entry => entry.code === 112).length, 0, "metadata predicate is not a write lock");
          const beforePreview = await f.snapshot();
          if (kind === "retain-valid-metadata") assert.equal((await freshPreview(f)).count, 2);
          else await assert.rejects(freshPreview(f), OmAssignmentConflict);
          assert.deepEqual(await f.snapshot(), beforePreview, "next preview has no cleanup or repair side effect");
        } finally { hold.release.resolve(); await Promise.allSettled([pending]); hold.patch.mock.restore(); evidence.stop(); }
      } finally { await f.cleanup(); }
    });
  }

  await suite.test("V12 unrelated same-course round after A snapshot remains outside its creation batch", async () => {
    const f = await fixture();
    try {
      const preview = await f.preview(), owner = randomUUID(), hold = holdAssignment(f, owner);
      const pending = attributed(owner, () => f.confirm(preview.token)); void pending.catch(() => {});
      try {
        await waitHeld(hold.held, pending);
        const extra = await f.session({ omName: "Synthetic independent OM", roundNo: "99" });
        await f.creation("operation_sessions", extra.id, { requestId: randomUUID() });
        const rawExtra = await f.store.collection("OperationSession").findOne({ _id: String(extra.id) });
        hold.release.resolve(); assert.deepEqual((await pending).operationIds, [f.s2.operationId]);
        const after = await freshPreview(f); assert.equal(after.count, 2);
        assert.deepEqual(after.operations.map(row => row.operationId), [f.s1.operationId, f.s2.operationId]);
        assert.deepEqual(await f.store.collection("OperationSession").findOne({ _id: String(extra.id) }), rawExtra);
        await assertAudits(f, owner, [["operation_sessions", String(f.s2.id), "update"]]);
      } finally { hold.release.resolve(); await Promise.allSettled([pending]); hold.patch.mock.restore(); }
    } finally { await f.cleanup(); }
  });
});
