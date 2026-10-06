// Public/empty Course/Company reads CANNOT establish encryption-key validity.
// Revenue uses actual admin updateCell; category uses updateOperation because updateCell rejects it.
// PG/original parity and actual HTTP handlers belong to the other workers.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { Collection, MongoClient, type CommandFailedEvent, type CommandStartedEvent, type CommandSucceededEvent, type Document } from "mongodb";
import { activityContext } from "../activity/context";
import type { SalesRecord, SourceReadResult } from "../sourceReads/sourceReadTypes";
import { MongoSalesRevenueSyncRepository, prepareMongoSalesRevenueSyncStore, SALES_REVENUE_MODELS } from "./mongoSalesRevenueSyncRepository";
import { MongoAdminDatabaseRepository, prepareMongoAdminDatabaseStore } from "./mongoAdminDatabaseRepository";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationStore, prepareMongoOperationStore, OPERATION_MODELS, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";
import { runSalesRevenueSyncWithRepositories as run } from "./salesRevenueSync";

const uri = process.env.MONGODB_SALES_REVENUE_TEST_URI;
const actor = "synthetic-revenue@example.invalid", epoch = new Date("2099-01-01T00:00:00.000Z");
function attributed<T>(work: () => Promise<T>, requestId = randomUUID()) {
  return activityContext.run({ requestId, actorType: "user", actorEmail: actor, actorName: "Synthetic actor", route: "/api/admin/sales-revenue", method: "POST" }, work);
}
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic barrier deadline")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
const sale = (revenue = 20): SalesRecord => ({ sourceRecordId: "synthetic-sale", courseId: "SYNTHETIC", revenue });
function source(items = [sale()]) {
  let reads = 0;
  return { isConfigured: () => true, get reads() { return reads; }, async readSalesRecords(): Promise<SourceReadResult<SalesRecord>> {
    reads++; return { source: "sales", status: "ok", readAt: epoch.toISOString(), items, issues: [] };
  } };
}
function safe(error: unknown) {
  assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /synthetic-injected-secret|synthetic-revenue@example.invalid/);
  assert.equal((error as Error & { cause?: unknown }).cause, undefined); return true;
}

test("sales revenue native replica transactions (explicit isolated opt-in)", { skip: !uri, timeout: 300_000, concurrency: false }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const databaseName = `hub_om_shadow_sales_revenue_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  const keys = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: keys, PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture(n = 1) {
    const options = { client, databaseName, namespace: `shadow_revenue_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoSalesRevenueSyncStore(options); await prepareMongoAdminDatabaseStore(options);
    await prepareMongoOperationStore({ ...options, processSequenceHighWater: 1000 });
    const store = new MongoOperationStore(options, SALES_REVENUE_MODELS);
    async function add(model: string, values: MongoRow) {
      const row = coachFixtureRow(model, { id: randomUUID(), createdAt: epoch, updatedAt: epoch, ...values });
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
    }
    const company = await add("Company", { name: "Synthetic company", normalizedName: "synthetic company" });
    let seq = 0;
    const addCourse = () => add("Course", { companyId: company.id, processSeq: ++seq, courseId: "SYNTHETIC", name: `Synthetic course ${seq}`, operationType: "SHORT", courseCategory: "Synthetic original", revenue: "10.00", revenueRaw: "10" });
    const courses: MongoRow[] = []; for (let i = 0; i < n; i++) courses.push(await addCourse());
    const repo = await MongoSalesRevenueSyncRepository.open(options), manual = await MongoAdminDatabaseRepository.open(options);
    const operationStore = new MongoOperationStore(options, OPERATION_MODELS), operationId = `SYNTHETIC-${randomUUID()}`;
    const session = coachFixtureRow("OperationSession", { id: randomUUID(), operationId, courseRecordId: courses[0].id,
      startDate: epoch, endDate: epoch, educationDates: [], deletedAt: null, updatedBy: actor, updatedAt: epoch });
    await operationStore.collection("OperationSession").insertOne(encodeMongoRuntimeDocument("OperationSession", session));
    const operations = await MongoOperationRepository.open(options);
    // Current admin editable fields exclude courseCategory: use its real existing writer.
    const edit = async (field: "courseCategory" | "revenue", value: string | number) => {
      if (field === "courseCategory") await operations.updateOperation(operationId, { courseCategory: String(value) }, actor);
      else await manual.updateCell({ table: "courses", rowId: String(courses[0].id), field, value, updatedBy: actor });
    };
    const row = () => store.one("Course", { _id: String(courses[0].id) });
    const snapshot = async (): Promise<Record<string, Document[]>> => Object.fromEntries(await Promise.all(SALES_REVENUE_MODELS.map(async model => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()])));
    return { options, store, repo, manual, courses, addCourse, edit, row, snapshot };
  }
  async function observe<T>(work: () => Promise<T>) {
    const names: string[] = []; let conflicts = 0;
    const start = (event: CommandStartedEvent) => { if (event.databaseName === databaseName) names.push(event.commandName); };
    const fail = (event: CommandFailedEvent) => { if ((event.failure as { code?: number }).code === 112) conflicts++; };
    const done = (event: CommandSucceededEvent) => { for (const error of (event.reply as Document).writeErrors ?? []) if (error.code === 112) conflicts++; };
    client.on("commandStarted", start); client.on("commandFailed", fail); client.on("commandSucceeded", done);
    try { return { result: await work(), names, conflicts }; }
    finally { client.off("commandStarted", start); client.off("commandFailed", fail); client.off("commandSucceeded", done); }
  }
  // Pause ONLY after an actual transactional Course read, never replace its result.
  function hold(namespace: string, requestId: string) {
    const held = signal(), release = signal(), original = MongoOperationStore.prototype.one; let reads = 0;
    const patch = mock.method(MongoOperationStore.prototype, "one", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["one"]>) {
      const result = await original.apply(this, args);
      if (this.namespace === namespace && args[0] === "Course" && args[2] && activityContext.getStore()?.requestId === requestId) {
        if (++reads === 1) { held.resolve(); await release.promise; }
      }
      return result;
    });
    return { held, release, patch, get reads() { return reads; } };
  }
  try {
    await client.connect(); connected = true;
    await suite.test("open + dry-run preserve all bytes and issue no DDL/writes", async () => {
      const f = await fixture(), before = await f.snapshot();
      const observed = await observe(async () => run({ apply: false, actorEmail: actor }, await MongoSalesRevenueSyncRepository.open(f.options), source()));
      assert.equal(observed.result.applied, false); assert.equal(observed.result.changed, 1); assert.equal(observed.result.updatedRows, 0);
      assert.ok(!observed.names.some(name => ["create", "createIndexes", "collMod", "insert", "update", "delete", "findAndModify", "drop"].includes(name)));
      assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("two Courses commit with encrypted actual-change audits and separately encrypted sync log", async () => {
      const f = await fixture(2), requestId = randomUUID();
      const result = await attributed(() => run({ apply: true, actorEmail: actor }, f.repo, source()), requestId);
      assert.equal(result.updatedRows, 2); assert.equal(result.applied, true);
      const rows = await f.store.scan("Course"), audits = await f.store.scan("ActivityChange", { requestId });
      assert.ok(rows.every(row => Number(row.revenue) === 20 && row.revenueRaw === "20")); assert.equal(audits.length, 2);
      for (const audit of audits) {
        assert.equal(audit.actorEmail, actor); assert.equal(audit.targetType, "courses"); assert.equal(audit.action, "update");
        assert.deepEqual(audit.changes, { revenue: { before: 10, after: 20 }, revenue_raw: { redacted: true } });
      }
      const raw = await f.snapshot(), logs = await f.store.scan("SalesRevenueSyncLog"); assert.equal(logs.length, 1); assert.equal(logs[0].triggeredBy, actor);
      assert.doesNotMatch(JSON.stringify([raw.ActivityChange, raw.SalesRevenueSyncLog]), /synthetic-revenue@example.invalid|Synthetic actor/);
      assert.equal(raw.ActivityChange[0].actorEmailPiiIndex, mongoRuntimeBlindIndex("ActivityChange", "actorEmail", actor));
      assert.equal(raw.SalesRevenueSyncLog[0].triggeredByPiiIndex, mongoRuntimeBlindIndex("SalesRevenueSyncLog", "triggeredBy", actor));
    });
    for (const phase of ["second-course", "inserted-audit"] as const) await suite.test(`${phase} throws AFTER native write: both Courses and audits roll back, no sync log`, async () => {
      const f = await fixture(2), before = await f.snapshot(), update = Collection.prototype.updateOne, insert = Collection.prototype.insertOne;
      let writes = 0, audits = 0;
      const writePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const result = await update.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_Course` && ++writes === 2 && phase === "second-course") throw new Error("synthetic-injected-secret");
        return result;
      });
      const auditPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await insert.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++audits === 2 && phase === "inserted-audit") throw new Error("synthetic-injected-secret");
        return result;
      });
      try { await assert.rejects(attributed(() => run({ apply: true, actorEmail: actor }, f.repo, source())), safe); }
      finally { writePatch.mock.restore(); auditPatch.mock.restore(); }
      assert.equal(writes, 2); assert.equal(audits, phase === "second-course" ? 1 : 2); assert.deepEqual(await f.snapshot(), before);
    });
    for (const field of ["courseCategory", "revenue"] as const) for (const syncLast of [true, false]) await suite.test(`real ${field === "revenue" ? "updateCell" : "updateOperation"} ${field}; sync commits ${syncLast ? "last" : "first"}; code112 and fresh audit`, async () => {
      const f = await fixture(), requestId = randomUUID(), barrier = hold(f.options.namespace, requestId), input = source();
      const sync = () => run({ apply: true, actorEmail: actor }, f.repo, input);
      const manual = () => f.edit(field, field === "revenue" ? 99 : "Synthetic manual");
      const pending = attributed(async () => syncLast ? sync() : manual(), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Read barrier not reached"); })]));
        const observed = await observe(async () => { await attributed(async () => syncLast ? manual() : sync()); barrier.release.resolve(); await pending; });
        assert.ok(observed.conflicts > 0, "must observe actual Mongo code112"); assert.ok(barrier.reads >= 2, "retry re-reads current Course");
      } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      const row = await f.row(); assert.equal(Number(row?.revenue), field === "revenue" && !syncLast ? 99 : 20);
      assert.equal(row?.courseCategory, field === "courseCategory" ? "Synthetic manual" : "Synthetic original"); assert.equal(row?.revenueRaw, "20");
      const audits = await f.store.scan("ActivityChange"); assert.equal(audits.length, 2); assert.equal(input.reads, 1);
      const delayed = audits.find(row => row.requestId === requestId); assert.ok(delayed);
      const expected = syncLast ? { revenue: { before: field === "revenue" ? 99 : 10, after: 20 }, revenue_raw: { redacted: true } }
        : field === "revenue" ? { revenue: { before: 20, after: 99 } } : { course_category: { before: "Synthetic original", after: "Synthetic manual" } };
      assert.deepEqual(delayed.changes, expected); assert.equal(await f.store.collection("SalesRevenueSyncLog").countDocuments(), 1);
    });
    await suite.test("admin updateCell currently rejects courseCategory (no broadened product contract)", async () => {
      const f = await fixture(), before = await f.snapshot();
      await assert.rejects(f.manual.updateCell({ table: "courses", rowId: String(f.courses[0].id), field: "courseCategory", value: "Synthetic manual", updatedBy: actor }), { code: "READ_ONLY_FIELD" });
      assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("actual conflict retry preserves duplicate pending, snapshot response and ordered audit edges", async () => {
      const f = await fixture(), requestId = randomUUID(), barrier = hold(f.options.namespace, requestId), input = source([sale(20), sale(30)]);
      const pending = attributed(() => run({ apply: true, actorEmail: actor }, f.repo, input), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Read barrier not reached"); })]));
        const observed = await observe(async () => { await attributed(() => f.edit("revenue", 99)); barrier.release.resolve(); return pending; });
        assert.ok(observed.conflicts > 0); assert.ok(barrier.reads >= 3); assert.equal(input.reads, 1);
        assert.equal(observed.result.updatedRows, 2); assert.deepEqual(observed.result.changes.map(row => row.before), [10, 10]);
      } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      const audits = await f.store.scan("ActivityChange", { requestId }); assert.equal(audits.length, 2);
      assert.deepEqual(audits.map(row => (row.changes as Document).revenue).sort((a, b) => a.after - b.after), [{ before: 99, after: 20 }, { before: 20, after: 30 }]);
      assert.equal(Number((await f.row())?.revenue), 30);
    });
    await suite.test("updatedAt-only application does not create a logical change audit", async () => {
      const f = await fixture(), update = [{ id: String(f.courses[0].id), revenue: 20 }];
      await attributed(() => f.repo.applyUpdates(update)); const requestId = randomUUID();
      await attributed(() => f.repo.applyUpdates(update), requestId);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), 0);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
    });
    for (const variant of ["pending", "same", "duplicate", "already-target", "new-course", "source-change", "missing-row"] as const) await suite.test(`initial snapshot retained: ${variant}`, async () => {
      const f = await fixture(), input = source(variant === "same" ? [sale(10)] : variant === "duplicate" ? [sale(20), sale(30)] : [sale()]);
      let added: MongoRow | undefined, afterInterference: Record<string, Document[]> | undefined;
      const repo = {
        async listCourses() {
          const rows = await f.repo.listCourses();
          if (variant === "new-course") { added = await f.addCourse(); input.readSalesRecords = async () => { throw new Error("Source must not be reread"); }; }
          else if (variant === "source-change") input.readSalesRecords = async () => ({ source: "sales", status: "ok", readAt: epoch.toISOString(), items: [sale(99)], issues: [] });
          else if (variant === "missing-row") await f.store.collection("Course").deleteOne({ _id: String(f.courses[0].id) });
          else await attributed(() => f.edit("revenue", variant === "already-target" ? 20 : 99));
          afterInterference = await f.snapshot(); return rows;
        },
        applyUpdates: f.repo.applyUpdates.bind(f.repo), recordLog: f.repo.recordLog.bind(f.repo)
      };
      const requestId = randomUUID(), work = () => attributed(() => run({ apply: true, actorEmail: actor }, repo, input), requestId);
      if (variant === "missing-row") { await assert.rejects(work(), safe); assert.deepEqual(await f.snapshot(), afterInterference); return; }
      const result = await work(); assert.equal(result.applied, true); assert.equal(input.reads, 1);
      assert.deepEqual(result.changes.map(change => change.before), variant === "duplicate" ? [10, 10] : [10]);
      assert.equal(result.updatedRows, variant === "same" ? 0 : variant === "duplicate" ? 2 : 1);
      assert.equal(Number((await f.row())?.revenue), variant === "same" ? 99 : variant === "duplicate" ? 30 : 20);
      const audits = await f.store.scan("ActivityChange", { requestId }); assert.equal(audits.length, variant === "same" ? 0 : variant === "duplicate" ? 2 : 1);
      const edges = audits.map(row => (row.changes as Document).revenue).filter(Boolean);
      if (variant === "pending") assert.deepEqual(edges, [{ before: 99, after: 20 }]);
      if (variant === "duplicate") assert.deepEqual(edges.sort((a, b) => a.after - b.after), [{ before: 99, after: 20 }, { before: 20, after: 30 }]);
      if (variant === "already-target") assert.deepEqual(audits[0].changes, { revenue_raw: { redacted: true } });
      if (variant === "source-change") assert.equal(result.changes[0].after, 20);
      if (added) assert.equal(Number((await f.store.one("Course", { _id: String(added.id) }))?.revenue), 10);
    });
    await suite.test("initial pending survives another writer setting both revenue and raw to the target", async () => {
      const f = await fixture(), requestId = randomUUID();
      const repo = {
        async listCourses() {
          const rows = await f.repo.listCourses();
          await attributed(() => f.repo.applyUpdates([{ id: String(f.courses[0].id), revenue: 20 }]));
          return rows;
        }, applyUpdates: f.repo.applyUpdates.bind(f.repo), recordLog: f.repo.recordLog.bind(f.repo)
      };
      const result = await attributed(() => run({ apply: true, actorEmail: actor }, repo, source()), requestId);
      assert.equal(result.changes[0].before, 10); assert.equal(result.changed, 1); assert.equal(result.updatedRows, 1);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), 0);
      assert.equal((await f.row())?.revenueRaw, "20");
    });
    await suite.test("Course and Company projections share one native read snapshot under concurrent edits", async () => {
      const f = await fixture(), original = MongoOperationStore.prototype.scan, held = signal(), release = signal(); let paused = false;
      const patch = mock.method(MongoOperationStore.prototype, "scan", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["scan"]>) {
        const rows = await original.apply(this, args);
        if (this.namespace === f.options.namespace && args[0] === "Course" && args[2] && !paused) { paused = true; held.resolve(); await release.promise; }
        return rows;
      });
      const pending = f.repo.listCourses(); void pending.catch(() => {});
      try {
        await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Snapshot barrier not reached"); })]));
        await f.store.collection("Company").updateOne({ _id: String(f.courses[0].companyId) }, { $set: { name: "Synthetic changed company" } });
        await f.edit("revenue", 99); release.resolve();
        const rows = await pending; assert.equal(rows[0].company?.name, "Synthetic company"); assert.equal(Number(rows[0].revenue), 10);
        const fresh = await f.repo.listCourses(); assert.equal(fresh[0].company?.name, "Synthetic changed company"); assert.equal(Number(fresh[0].revenue), 99);
      } finally { release.resolve(); await Promise.allSettled([pending]); patch.mock.restore(); }
    });
    await suite.test("actual conflict retries share a 120-second total deadline and leave no failed-attempt writes", async () => {
      const f = await fixture(), requestId = randomUUID(), held = signal(), release = signal();
      const one = MongoOperationStore.prototype.one, now = performance.now.bind(performance); let offset = 0, reads = 0;
      const clock = mock.method(performance, "now", () => now() + offset);
      const patch = mock.method(MongoOperationStore.prototype, "one", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["one"]>) {
        const row = await one.apply(this, args);
        if (this.namespace === f.options.namespace && args[0] === "Course" && args[2] && activityContext.getStore()?.requestId === requestId) {
          reads++;
          if (reads === 1) { held.resolve(); await release.promise; }
          else if (reads === 2) offset = 120_002;
        }
        return row;
      });
      const pending = attributed(() => run({ apply: true, actorEmail: actor }, f.repo, source()), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Deadline barrier not reached"); })]));
        await attributed(() => f.edit("revenue", 99)); const before = await f.snapshot();
        const result = await observe(async () => { offset = 60_001; release.resolve(); await assert.rejects(pending, { message: "SALES_REVENUE_SYNC_FAILED" }); });
        offset = 0; assert.ok(reads >= 2); assert.ok(result.conflicts > 0);
        assert.deepEqual(await f.snapshot(), before);
      } finally { release.resolve(); await Promise.allSettled([pending]); patch.mock.restore(); clock.mock.restore(); }
    });
    await suite.test("sync log failure leaves workflow response and committed business/audit intact", async () => {
      const f = await fixture(), preview = await run({ apply: false, actorEmail: actor }, f.repo, source()), insert = Collection.prototype.insertOne; let attempted = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        if (this.collectionName === `${f.options.namespace}_SalesRevenueSyncLog`) { attempted++; throw new Error("synthetic-injected-secret"); }
        return insert.apply(this, args);
      });
      try { const result = await attributed(() => run({ apply: true, actorEmail: actor }, f.repo, source())); assert.deepEqual(result, { ...preview, applied: true, updatedRows: 1 }); }
      finally { patch.mock.restore(); }
      assert.equal(attempted, 1); assert.equal(Number((await f.row())?.revenue), 20);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1); assert.equal(await f.store.collection("SalesRevenueSyncLog").countDocuments(), 0);
    });
    for (const damage of ["wrong-key", "corrupt-log", "aad"] as const) await suite.test(`${damage}: private log decode fails; public Courses and later sync remain usable`, async () => {
      const f = await fixture(); await attributed(() => run({ apply: true, actorEmail: actor }, f.repo, source()));
      const log = await f.store.collection("SalesRevenueSyncLog").findOne({}); assert.ok(log);
      if (damage === "wrong-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
      else if (damage === "aad") {
        const audit = await f.store.collection("ActivityChange").findOne({}); assert.ok(audit);
        await f.store.collection("SalesRevenueSyncLog").updateOne({ _id: log._id }, { $set: { triggeredBy: audit.actorEmail } });
      } else await f.store.collection("SalesRevenueSyncLog").updateOne({ _id: log._id }, { $set: { triggeredBy: "synthetic-corrupt-plaintext" } }, { bypassDocumentValidation: true });
      try {
        await assert.rejects(f.store.one("SalesRevenueSyncLog", { _id: log._id }));
        assert.equal((await f.repo.listCourses()).length, 1);
        const result = await attributed(() => run({ apply: true, actorEmail: actor }, f.repo, source([sale(30)])));
        assert.equal(result.applied, true); assert.equal(result.updatedRows, 1); assert.equal(Number((await f.row())?.revenue), 30);
      } finally { process.env.PII_ENCRYPTION_KEYS = keys; }
    });
    await suite.test("missing key with activity context fails before business writes", async () => {
      const f = await fixture(), before = await f.snapshot(), update = Collection.prototype.updateOne; let writes = 0;
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const result = await update.apply(this, args); if (this.collectionName === `${f.options.namespace}_Course`) writes++; return result;
      });
      delete process.env.PII_ENCRYPTION_KEYS;
      try { await assert.rejects(attributed(() => f.repo.applyUpdates([{ id: String(f.courses[0].id), revenue: 20 }])), safe); }
      finally { process.env.PII_ENCRYPTION_KEYS = keys; patch.mock.restore(); }
      assert.equal(writes, 0); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("NaN and infinities retain original null storage plus raw String(number)", async () => {
      for (const amount of [NaN, Infinity, -Infinity]) {
        const f = await fixture(), result = await attributed(() => run({ apply: true, actorEmail: actor }, f.repo, source([sale(amount)])));
        assert.equal(result.updatedRows, 1); assert.ok(Object.is(result.changes[0].after, amount));
        const row = await f.row(); assert.equal(row?.revenue, null); assert.equal(row?.revenueRaw, String(amount));
        const audits = await f.store.scan("ActivityChange"); assert.equal(audits.length, 1);
        assert.deepEqual((audits[0].changes as Document).revenue, { before: 10, after: null });
      }
    });
  } finally {
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_sales_revenue_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
