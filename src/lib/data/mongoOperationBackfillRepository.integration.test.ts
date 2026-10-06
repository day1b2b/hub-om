import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { AbstractCursor, BSON, Collection, MongoClient, type CommandFailedEvent, type CommandStartedEvent, type CommandSucceededEvent, type Document } from "mongodb";
import { activityContext } from "../activity/context";
import { OPERATION_BACKFILL_MODELS, MongoOperationBackfillRepository, prepareMongoOperationBackfillStore } from "./mongoOperationBackfillRepository";
import { MongoCourseAdminRepository, prepareMongoCourseAdminStore } from "./mongoCourseAdminRepository";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationError, MongoOperationStore, prepareMongoOperationStore, operationMongoIndexes, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_OPERATION_BACKFILL_TEST_URI;
const operator = "synthetic-backfill@example.invalid", oldDate = new Date("2090-01-01T00:00:00.000Z");
const kinds = ["onsite", "om"] as const;
type Kind = typeof kinds[number];
interface Backfill {
  countOnsiteRequiredTargets(): Promise<number>; applyOnsiteRequiredBackfill(): Promise<number>;
  countOmAssignmentStatusTargets(): Promise<number>; applyOmAssignmentStatusBackfill(): Promise<number>;
}
const count = (repo: Backfill, kind: Kind) => kind === "onsite" ? repo.countOnsiteRequiredTargets() : repo.countOmAssignmentStatusTargets();
const apply = (repo: Backfill, kind: Kind) => kind === "onsite" ? repo.applyOnsiteRequiredBackfill() : repo.applyOmAssignmentStatusBackfill();
function withActor<T>(work: () => Promise<T>, requestId = randomUUID()) {
  return activityContext.run({ requestId, actorType: "user", actorEmail: operator, actorName: "Synthetic backfill actor", route: "/synthetic/operation-backfill", method: "POST" }, work);
}
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic barrier deadline")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
function safeError(error: unknown) {
  assert.ok(error instanceof MongoOperationError);
  assert.doesNotMatch(String(error), /synthetic-backfill@example.invalid|Synthetic private|synthetic-injected-secret/); return true;
}
// Fixed original-query oracle; flags below are literal expectations, not adapter-derived predicates.
const fixedRows: MongoRow[] = [
  { onsiteRequired: "N", omName: null }, { onsiteRequired: "PARTIAL", omName: "" },
  { onsiteRequired: "UNKNOWN", omName: "★배정필요" }, { onsiteRequired: "Y", omName: "배정필요" },
  { onsiteRequired: "N", omName: " " }, { onsiteRequired: "PARTIAL", omName: " 배정필요 " },
  { onsiteRequired: "UNKNOWN", omName: "Synthetic private owner" }, { onsiteRequired: "Y", omName: "★배정필요 " },
  { onsiteRequired: "N", omName: "Synthetic private completed owner", operationStatus: "DONE", archiveStatus: "DONE" },
  { onsiteRequired: "UNKNOWN", omName: "Synthetic private archived owner", operationStatus: "RETROSPECTIVE_DONE", archiveStatus: "DONE" },
  { onsiteRequired: "N", omName: "Synthetic private deleted owner", deletedAt: oldDate },
  { onsiteRequired: "Y", omName: "Synthetic private planned owner", operationStatus: "ASSIGNMENT_PLANNED" }
];
const expectedTargets = { onsite: new Set([0, 1, 2, 4, 5, 6, 8, 9]), om: new Set([4, 5, 6, 7]) };

test("operation backfill repository on an isolated Mongo replica set", { skip: !uri, timeout: 240_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const databaseName = `hub_om_shadow_operation_backfill_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture(values: MongoRow[] = fixedRows, writers = false) {
    const options = { client, databaseName, namespace: `shadow_operation_backfill_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoOperationBackfillStore(options);
    const store = new MongoOperationStore(options, OPERATION_BACKFILL_MODELS);
    const company = coachFixtureRow("Company", { name: "Synthetic company", normalizedName: "synthetic-company" });
    const course = coachFixtureRow("Course", { companyId: company.id, processSeq: 533, courseId: "SYNTHETIC-COURSE", name: "Synthetic course" });
    if (writers) {
      await prepareMongoOperationStore({ ...options, processSequenceHighWater: 1000 }); await prepareMongoCourseAdminStore(options);
      const related = new MongoOperationStore(options);
      await related.collection("Company").insertOne(encodeMongoRuntimeDocument("Company", company));
      await related.collection("Course").insertOne(encodeMongoRuntimeDocument("Course", course));
    }
    const rows = values.map((value, n) => coachFixtureRow("OperationSession", {
      id: `dddddddd-1234-4abc-8abc-${n.toString(16).padStart(12, "0")}`, operationId: `SYNTHETIC-OP-${n}`, courseRecordId: course.id,
      onsiteRequired: "N", onsiteText: "Synthetic private original onsite", omName: "Synthetic private owner", operationStatus: "ASSIGNMENT_NEEDED", archiveStatus: "NOT_READY",
      deletedAt: null, deletedBy: null, updatedAt: oldDate, updatedBy: "synthetic-editor@example.invalid", createdBy: "synthetic-creator@example.invalid",
      operationDetail: "Synthetic private detail", educationDates: [], startDate: new Date("2099-09-01"), endDate: new Date("2099-09-02"), ...value
    }));
    if (rows.length) await store.collection("OperationSession").insertMany(rows.map(row => encodeMongoRuntimeDocument("OperationSession", row)));
    const repo: Backfill = await MongoOperationBackfillRepository.open(options);
    const snapshot = async (): Promise<Record<string, Document[]>> => Object.fromEntries(await Promise.all(OPERATION_BACKFILL_MODELS.map(async (model: string) => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()])));
    return { options, store, repo, rows, company, course, snapshot };
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
    for (const kind of kinds) {
      await suite.test(`${kind}: fixed count, exact targets, only business field/timestamp changes, encrypted audit and replay zero`, async () => {
        const f = await fixture(), before = await f.snapshot(), expected = expectedTargets[kind];
        const observed = await wire(() => withActor(() => count(f.repo, kind)));
        assert.equal(observed.result, kind === "onsite" ? 8 : 4);
        assert.ok(!observed.names.some(name => ["insert", "update", "delete", "create", "collMod", "createIndexes"].includes(name)));
        assert.deepEqual(await f.snapshot(), before);
        assert.equal(await withActor(() => apply(f.repo, kind)), expected.size);
        const after = await f.snapshot(), businessField = kind === "onsite" ? "onsiteRequired" : "operationStatus";
        for (let n = 0; n < f.rows.length; n++) {
          const id = f.rows[n].id, original = before.OperationSession.find(row => row._id === id), current = after.OperationSession.find(row => row._id === id);
          assert.ok(original && current);
          if (!expected.has(n)) { assert.deepEqual(current, original); continue; }
          assert.equal(current[businessField], kind === "onsite" ? "Y" : "ASSIGNMENT_PLANNED"); assert.notDeepEqual(current.updatedAt, oldDate);
          for (const key of Object.keys(original)) if (![businessField, "updatedAt"].includes(key)) assert.deepEqual(current[key], original[key], key);
        }
        const audits = await f.store.scan("ActivityChange", {}); assert.equal(audits.length, expected.size);
        assert.deepEqual(new Set(audits.map(row => row.targetId)), new Set([...expected].map(n => f.rows[n].id)));
        for (const row of audits) {
          assert.equal(row.action, "update"); assert.equal(row.targetType, "operation_sessions"); assert.equal(row.actorEmail, operator);
          const n = f.rows.findIndex(target => target.id === row.targetId);
          assert.deepEqual(row.changes, kind === "onsite" ? { onsite_required: { before: f.rows[n].onsiteRequired, after: "Y" } } : { operation_status: { before: "assignment_needed", after: "assignment_planned" } });
        }
        assert.doesNotMatch(JSON.stringify(after.ActivityChange), /synthetic-backfill@example.invalid|Synthetic private/);
        assert.equal(await count(f.repo, kind), 0); assert.equal(await withActor(() => apply(f.repo, kind)), 0);
        assert.deepEqual(await f.snapshot(), after);
      });
      await suite.test(`${kind}: 101 targets cross pages and context-free apply creates no audit`, async () => {
        const f = await fixture(Array.from({ length: 101 }, () => ({})));
        assert.equal(await count(f.repo, kind), 101);
        const observed = await wire(() => apply(f.repo, kind)); assert.equal(observed.result, 101); assert.ok(!observed.names.includes("getMore"));
        assert.equal(await count(f.repo, kind), 0); assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0);
        const pages = observed.batches.filter(page => page.collection === `${f.options.namespace}_OperationSession`);
        assert.ok(pages.filter(page => page.count > 0).length >= 2);
      });
      for (const failAt of ["write", "audit"] as const) {
        await suite.test(`${kind}: 101st real ${failAt} succeeds then fails, rolling back all prior raw changes and audits`, async () => {
          const f = await fixture(Array.from({ length: 201 }, () => ({}))), before = await f.snapshot();
          let writes = 0, audits = 0, checked = false;
          const originalWrite = Collection.prototype.updateOne, originalAudit = Collection.prototype.insertOne;
          const writePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
            const result = await originalWrite.apply(this, args);
            if (this.collectionName === `${f.options.namespace}_OperationSession` && ++writes === 101 && failAt === "write") { checked = true; throw new Error("synthetic-injected-secret"); }
            return result;
          });
          const auditPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
            const result = await originalAudit.apply(this, args);
            if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++audits === 101 && failAt === "audit") {
              const session = args[1]?.session; assert.ok(session);
              assert.equal(await f.store.collection("ActivityChange").countDocuments({}, { session }), 101);
              checked = true; throw new Error("synthetic-injected-secret");
            }
            return result;
          });
          try { await assert.rejects(withActor(() => apply(f.repo, kind)), safeError); }
          finally { writePatch.mock.restore(); auditPatch.mock.restore(); }
          assert.equal(checked, true); assert.equal(writes, 101); assert.equal(audits, failAt === "write" ? 100 : 101);
          assert.deepEqual(await f.snapshot(), before);
        });
      }
      await suite.test(`${kind}: real BSON-short batches return complete count/apply without getMore`, async () => {
        const f = await fixture(Array.from({ length: 3 }, () => ({ operationDetail: "x".repeat(5 * 1024 * 1024) })));
        for (const work of [() => count(f.repo, kind), () => apply(f.repo, kind)]) {
          const observed = await wire(work); assert.equal(observed.result, 3); assert.ok(!observed.names.includes("getMore"));
          const pages = observed.batches.filter(page => page.collection === `${f.options.namespace}_OperationSession`);
          assert.ok(pages.some(page => page.count > 0 && page.count < 3 && page.bytes > 6 * 1024 * 1024));
          assert.ok(pages.filter(page => page.count > 0).length >= 2); assert.ok(pages.some(page => page.count === 0));
        }
      });
      await suite.test(`${kind}: actual 32MiB scan bound rejects count/apply without partial success`, async () => {
        const f = await fixture(Array.from({ length: 6 }, () => ({ operationDetail: "x".repeat(5 * 1024 * 1024) }))), before = await f.snapshot();
        await assert.rejects(count(f.repo, kind), /SCAN_LIMIT_EXCEEDED/);
        await assert.rejects(withActor(() => apply(f.repo, kind)), /SCAN_LIMIT_EXCEEDED/); assert.deepEqual(await f.snapshot(), before);
      });
      await suite.test(`${kind}: simulated scan 15s and total 30s deadlines reject late success and roll back`, async () => {
        const f = await fixture([{}]), before = await f.snapshot();
        for (const phase of ["scan", "transaction"] as const) {
          const now = performance.now.bind(performance); let elapsed = 0;
          const clock = mock.method(performance, "now", () => now() + elapsed);
          const close = AbstractCursor.prototype.close, insert = Collection.prototype.insertOne;
          const cursorPatch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) {
            await close.apply(this, args); if (phase === "scan" && this.namespace.collection === `${f.options.namespace}_OperationSession`) elapsed = 16_001;
          });
          const auditPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
            const result = await insert.apply(this, args); if (phase === "transaction" && this.collectionName === `${f.options.namespace}_ActivityChange`) elapsed = 30_001; return result;
          });
          try { await assert.rejects(withActor(() => apply(f.repo, kind)), error => { safeError(error); assert.equal((error as MongoOperationError).code, phase === "scan" ? "SCAN_TIMEOUT" : "OPERATION_BACKFILL_TIMEOUT"); return true; }); }
          finally { cursorPatch.mock.restore(); auditPatch.mock.restore(); clock.mock.restore(); }
          assert.equal(elapsed, phase === "scan" ? 16_001 : 30_001); assert.deepEqual(await f.snapshot(), before);
        }
      });
    }
    await suite.test("OM candidate query uses exact HMAC exclusions and authenticates a forged included placeholder", async () => {
      const f = await fixture(); const queries: string[] = [];
      const listener = (event: CommandStartedEvent) => { if (event.databaseName === databaseName && event.commandName === "find" && event.command.find === `${f.options.namespace}_OperationSession`) queries.push(JSON.stringify(event.command.filter)); };
      client.on("commandStarted", listener);
      try { assert.equal(await count(f.repo, "om"), 4); } finally { client.off("commandStarted", listener); }
      assert.ok(queries.some(query => query.includes("omNamePiiIndex")));
      for (const placeholder of ["", "★배정필요", "배정필요"]) assert.ok(queries.some(query => query.includes(mongoRuntimeBlindIndex("OperationSession", "omName", placeholder)!)));
      assert.ok(queries.every(query => !query.includes("Synthetic private") && !query.includes("★배정필요")));
      // Do not claim to validate rows excluded by their index: forge one into the candidate bucket.
      await f.store.collection("OperationSession").updateOne({ _id: String(f.rows[1].id) }, { $set: { omNamePiiIndex: mongoRuntimeBlindIndex("OperationSession", "omName", "Synthetic private forged owner") } });
      const before = await f.snapshot();
      await assert.rejects(count(f.repo, "om"), safeError); await assert.rejects(withActor(() => apply(f.repo, "om")), safeError);
      assert.deepEqual(await f.snapshot(), before);
    });
    for (const key of ["PII_ENCRYPTION_KEYS", "PII_INDEX_KEY"] as const) {
      await suite.test(`${key} mismatch fails count/apply safely without writes`, async () => {
        const f = await fixture([{}]), before = await f.snapshot(), previous = process.env[key]!;
        process.env[key] = key === "PII_INDEX_KEY" ? randomBytes(32).toString("base64") : JSON.stringify({ fixture: randomBytes(32).toString("base64") });
        try {
          for (const kind of kinds) { await assert.rejects(count(f.repo, kind), safeError); await assert.rejects(withActor(() => apply(f.repo, kind)), safeError); }
          assert.deepEqual(await f.snapshot(), before);
        } finally { process.env[key] = previous; }
      });
    }
    for (const kind of kinds) {
      await suite.test(`${kind}: count does not reserve targets; a later writer can make apply zero`, async () => {
        const f = await fixture([{}], true), operations = await MongoOperationRepository.open(f.options);
        assert.equal(await count(f.repo, kind), 1);
        await operations.updateOperation(String(f.rows[0].operationId), kind === "onsite" ? { onsiteRequired: "Y" } : { om: "배정필요" }, operator);
        const before = await f.snapshot(); assert.equal(await withActor(() => apply(f.repo, kind)), 0); assert.deepEqual(await f.snapshot(), before);
      });
      for (const writer of ["name", "status", "delete", "bulk"] as const) {
        await suite.test(`${kind}: actual ${writer} writer wins stale backfill read; conflict retry re-evaluates conditions`, async () => {
          const f = await fixture([{}], true), operations = await MongoOperationRepository.open(f.options), bulk = await MongoCourseAdminRepository.open(f.options);
          const requestId = randomUUID(), barrier = holdSessionRead(f.options.namespace, requestId), operationId = String(f.rows[0].operationId);
          const pending = withActor(() => apply(f.repo, kind), requestId); void pending.catch(() => {});
          try {
            await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Backfill barrier not reached"); })]));
            const observed = await wire(async () => {
              await withActor(async () => {
                if (writer === "name") await operations.updateOperation(operationId, { om: "배정필요" }, operator);
                else if (writer === "status") await operations.updateOperation(operationId, { operationStatus: "완료" }, operator);
                else if (writer === "delete") await operations.deleteOperation(operationId, operator);
                else assert.equal(await bulk.softDeleteCourseSessions(String(f.course.id), operator), 1);
              });
              barrier.release.resolve(); return pending;
            });
            assert.ok(observed.conflicts > 0);
            assert.equal(observed.result, kind === "onsite" && (writer === "name" || writer === "status") ? 1 : 0);
          } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
          const row = await f.store.one("OperationSession", { _id: String(f.rows[0].id) }); assert.ok(row);
          assert.equal(row.deletedAt !== null, writer === "delete" || writer === "bulk");
          if (writer === "name") assert.equal(row.omName, "배정필요");
          if (writer === "status") assert.equal(row.operationStatus, "DONE");
          const expectedBackfillWrites = kind === "onsite" && (writer === "name" || writer === "status") ? 1 : 0;
          assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), expectedBackfillWrites);
          assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1 + expectedBackfillWrites);
        });
      }
      for (const secondKind of kinds) {
        await suite.test(`${kind} held while ${secondKind} commits: same/different backfills retry without duplicate audits or lost fields`, async () => {
          const f = await fixture([{}]), before = await f.snapshot(), requestId = randomUUID(), barrier = holdSessionRead(f.options.namespace, requestId);
          let afterWinner: Record<string, Document[]> | undefined;
          const pending = withActor(() => apply(f.repo, kind), requestId); void pending.catch(() => {});
          try {
            await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Dual backfill barrier not reached"); })]));
            const observed = await wire(async () => {
              assert.equal(await withActor(() => apply(f.repo, secondKind)), 1);
              afterWinner = await f.snapshot();
              barrier.release.resolve(); return pending;
            });
            assert.ok(observed.conflicts > 0); assert.equal(observed.result, kind === secondKind ? 0 : 1);
          } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
          const row = await f.store.collection("OperationSession").findOne({ _id: String(f.rows[0].id) }); assert.ok(row);
          assert.equal(row.onsiteRequired, kind === "onsite" || secondKind === "onsite" ? "Y" : "N");
          assert.equal(row.operationStatus, kind === "om" || secondKind === "om" ? "ASSIGNMENT_PLANNED" : "ASSIGNMENT_NEEDED");
          for (const key of Object.keys(before.OperationSession[0])) if (!["onsiteRequired", "operationStatus", "updatedAt"].includes(key)) assert.deepEqual(row[key], before.OperationSession[0][key]);
          assert.equal(await f.store.collection("ActivityChange").countDocuments(), kind === secondKind ? 1 : 2);
          if (kind === secondKind) { assert.ok(afterWinner); assert.deepEqual(await f.snapshot(), afterWinner); }
        });
      }
      await suite.test(`${kind}: actual conflict retry cannot reset total30s; simulated20s+15s rolls back while preserving the winner`, async () => {
        const f = await fixture([{}], true), operations = await MongoOperationRepository.open(f.options), requestId = randomUUID();
        const held = signal(), release = signal(), originalWrite = Collection.prototype.updateOne, originalAudit = Collection.prototype.insertOne;
        const now = performance.now.bind(performance); let elapsed = 0, paused = false, conflicts = 0, retryAudits = 0;
        let afterWinner: Record<string, Document[]> | undefined;
        const clock = mock.method(performance, "now", () => now() + elapsed);
        const writePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          const ours = this.collectionName === `${f.options.namespace}_OperationSession` && activityContext.getStore()?.requestId === requestId;
          if (ours && !paused) { paused = true; held.resolve(); await release.promise; }
          try { return await originalWrite.apply(this, args); }
          catch (error) { if (ours && (error as { code?: number }).code === 112) { conflicts++; elapsed = 20_000; } throw error; }
        });
        const auditPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const result = await originalAudit.apply(this, args);
          if (this.collectionName === `${f.options.namespace}_ActivityChange` && activityContext.getStore()?.requestId === requestId) {
            assert.equal(conflicts, 1); retryAudits++; if (retryAudits === 1) elapsed += 15_000;
          }
          return result;
        });
        const pending = withActor(() => apply(f.repo, kind), requestId); void pending.catch(() => {});
        try {
          await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("First-write barrier not reached"); })]));
          const observed = await wire(async () => {
            await withActor(() => operations.updateOperation(String(f.rows[0].operationId), { om: "Synthetic private retained winner" }, operator));
            afterWinner = await f.snapshot(); release.resolve();
            await assert.rejects(pending, error => { safeError(error); assert.equal((error as MongoOperationError).code, "OPERATION_BACKFILL_TIMEOUT"); return true; });
          });
          assert.ok(observed.conflicts > 0);
        } finally { release.resolve(); await Promise.allSettled([pending]); auditPatch.mock.restore(); writePatch.mock.restore(); clock.mock.restore(); }
        assert.equal(conflicts, 1); assert.equal(retryAudits, 1); assert.equal(elapsed, 35_000);
        assert.ok(afterWinner); assert.deepEqual(await f.snapshot(), afterWinner);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), 0);
      });
    }
    for (const problem of ["validator", "index"] as const) {
      await suite.test(`unready ${problem} rejects open without DDL repair`, async () => {
        const f = await fixture(), collection = f.store.collection("OperationSession");
        if (problem === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "moderate" });
        else { const name = operationMongoIndexes("OperationSession")[0]?.name; assert.ok(name); await collection.dropIndex(name); }
        const observed = await wire(async () => { await assert.rejects(MongoOperationBackfillRepository.open(f.options)); });
        assert.ok(!observed.names.some(name => ["create", "createIndexes", "collMod", "insert", "update", "delete"].includes(name)));
      });
    }
  } finally {
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_operation_backfill_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
