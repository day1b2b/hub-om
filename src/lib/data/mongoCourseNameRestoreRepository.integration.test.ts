import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { AbstractCursor, BSON, Collection, MongoClient, type CommandFailedEvent, type CommandStartedEvent, type CommandSucceededEvent, type Document } from "mongodb";
import { activityContext } from "../activity/context";
import { COURSE_NAME_RESTORE_MODELS, MongoCourseNameRestoreRepository, prepareMongoCourseNameRestoreStore } from "./mongoCourseNameRestoreRepository";
import { CourseNameRestoreConflict, type CourseNameRestorePlan, type CourseNameRestoreResult } from "./courseNameRestoreRepository";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoCourseAdminRepository } from "./mongoCourseAdminRepository";
import { MongoDeletedOperationRepository } from "./mongoDeletedOperationRepository";
import { MongoOperationBackfillRepository } from "./mongoOperationBackfillRepository";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationError, MongoOperationStore, completeMongoRow, prepareMongoOperationStore, operationMongoIndexes, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_COURSE_NAME_RESTORE_TEST_URI;
const actor = "synthetic-course-restore@example.invalid", oldDate = new Date("2090-01-01T00:00:00.000Z");
interface Restore {
  planCourseNameRestore(rawId: string): Promise<CourseNameRestorePlan>;
  applyCourseNameRestore(rawId: string, ids: string[], snapshot: string, actorEmail: string | null): Promise<CourseNameRestoreResult>;
}
const reason = {
  missing: "원천 과정명이 없습니다.", tied: "최신 원천 기록의 시각이 같아 복원 근거를 확정할 수 없습니다.",
  same: "원천 과정명과 현재 과정명이 같습니다.", duplicate: "같은 기업·코스ID·과정명의 대상이 여러 개입니다.",
  metadata: "새 과정에 복사할 유형·도구·매출 정보가 서로 다릅니다."
};
function attributed<T>(work: () => Promise<T>, requestId = randomUUID()) {
  return activityContext.run({ requestId, actorType: "user", actorEmail: actor, actorName: "Synthetic restore actor", route: "/api/admin/course-name-restore", method: "POST" }, work);
}
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic barrier deadline")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
function safeError(error: unknown) { assert.ok(error instanceof MongoOperationError || error instanceof CourseNameRestoreConflict); assert.doesNotMatch(String(error), /synthetic-course-restore@example.invalid|synthetic-injected-secret|Synthetic private/); return true; }

test("course name restore repository on an isolated Mongo replica set", { skip: !uri, timeout: 240_000 }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const databaseName = `hub_om_shadow_course_name_restore_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_course_restore_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoCourseNameRestoreStore({ ...options, processSequenceHighWater: 1000 });
    await prepareMongoOperationStore({ ...options, processSequenceHighWater: 1000 });
    const store = new MongoOperationStore(options, COURSE_NAME_RESTORE_MODELS);
    const repo: Restore = await MongoCourseNameRestoreRepository.open(options);
    let sequence = 100;
    const insert = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    const replace = async (model: string, id: string, values: MongoRow) => {
      const row = await store.one(model, { _id: id }); assert.ok(row);
      await store.collection(model).replaceOne({ _id: id }, encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...row, ...values })));
    };
    const company = await insert("Company", { name: "Synthetic A", normalizedName: "synthetic-a", updatedAt: oldDate });
    const course = async (values: MongoRow = {}) => insert("Course", { companyId: company.id, courseId: "123", name: `Synthetic current ${sequence}`, processSeq: sequence++, operationType: "LONG", courseCategory: "Synthetic category", tools: "Synthetic tool", revenue: "1234.00", revenueRaw: "Synthetic private revenue", updatedAt: oldDate, ...values });
    const session = async (courseRecordId: unknown, values: MongoRow = {}) => insert("OperationSession", { operationId: `SYNTHETIC-${randomUUID()}`, courseRecordId, startDate: new Date("2099-09-01"), endDate: new Date("2099-09-02"), roundNo: null, educationDates: [], deletedAt: null, deletedBy: null, updatedAt: oldDate, updatedBy: null, omName: "Synthetic private owner", onsiteRequired: "N", operationStatus: "ASSIGNMENT_NEEDED", onsiteText: "Synthetic private onsite", ...values });
    const source = async (operationSessionId: unknown, values: MongoRow = {}) => insert("OperationSourceRecord", { operationSessionId, mappedFields: { courseName: "Synthetic original" }, rowSnapshot: { private: "Synthetic private source" }, createdAt: new Date("2099-01-03"), ...values });
    const group = async (key = "123", companyId: unknown = company.id, existing = true, count = 2) => {
      const current = await course({ courseId: key, companyId });
      const target = existing ? await course({ courseId: `${key}\u200b`, companyId, name: "Synthetic original", tools: "Synthetic existing target" }) : null;
      const sessions: MongoRow[] = [], sources: MongoRow[] = [];
      for (let n = 0; n < count; n++) { const row = await session(current.id); sessions.push(row); sources.push(await source(row.id)); }
      return { key, current, target, sessions, sources };
    };
    const snapshot = async (): Promise<Record<string, Document[]>> => {
      const names = (await store.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).filter(name => name.startsWith(`${options.namespace}_`)).sort();
      return Object.fromEntries(await Promise.all(names.map(async name => [name.slice(options.namespace.length + 1), await store.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
    };
    const counter = () => store.db.collection<{ _id: string; value: number }>(`${options.namespace}___counter`).findOne({ _id: "Course.processSeq" });
    return { options, store, repo, insert, replace, company, course, session, source, group, snapshot, counter };
  }
  async function wire<T>(work: () => Promise<T>) {
    const names: string[] = [], commands: Array<{ name: string; collection: string; session: string | undefined }> = [];
    const reads = new Map<number, string>(), batches: Array<{ collection: string; count: number; bytes: number }> = [];
    let conflicts = 0;
    const start = (event: CommandStartedEvent) => {
      if (event.databaseName !== databaseName) return;
      names.push(event.commandName); commands.push({ name: event.commandName, collection: String(event.command.find ?? event.command.update ?? event.command.insert ?? event.command.findAndModify ?? event.command.aggregate ?? ""), session: event.command.lsid?.id?.toString() });
      if (event.commandName === "find" || event.commandName === "aggregate") reads.set(event.requestId, String(event.command.find ?? event.command.aggregate));
    };
    const failed = (event: CommandFailedEvent) => { if ([112, 11000].includes((event.failure as { code?: number }).code ?? 0)) conflicts++; };
    const done = (event: CommandSucceededEvent) => {
      const reply = event.reply as Document;
      if (reply.writeErrors?.some((row: { code: number }) => [112, 11000].includes(row.code))) conflicts++;
      const collection = reads.get(event.requestId); if (collection && reply.cursor?.firstBatch) batches.push({ collection, count: reply.cursor.firstBatch.length, bytes: BSON.calculateObjectSize(reply) }); reads.delete(event.requestId);
    };
    client.on("commandStarted", start); client.on("commandFailed", failed); client.on("commandSucceeded", done);
    try { return { result: await work(), names, commands, batches, get conflicts() { return conflicts; } }; }
    finally { client.off("commandStarted", start); client.off("commandFailed", failed); client.off("commandSucceeded", done); }
  }
  try {
    await client.connect(); connected = true;
    await suite.test("normalization, companies, zero-session courses, DTO and read-only deterministic logical snapshot", async () => {
      const f = await fixture(), a = await f.group(), companyB = await f.insert("Company", { name: "Synthetic B", normalizedName: "synthetic-b" });
      const b = await f.group("123.0", companyB.id, true, 1);
      const deleted = await f.session(a.current.id, { deletedAt: oldDate }); await f.source(deleted.id);
      const before = await f.snapshot(), observed = await wire(() => f.repo.planCourseNameRestore(" \u200b123.0\ufeff "));
      const plan = observed.result; assert.equal(plan.courseId, "123"); assert.match(plan.snapshot, /^[a-f0-9]{64}$/);
      assert.deepEqual(plan.companyNames, ["Synthetic A", "Synthetic B"]); assert.equal(plan.courses.length, 4); assert.equal(plan.rows.length, 3);
      assert.deepEqual(plan.courses.filter(row => row.sessionCount === 0).map(row => row.id).sort(), [a.target!.id, b.target!.id].sort());
      const row = plan.rows.find(row => row.operationId === a.sessions[0].operationId); assert.ok(row);
      assert.deepEqual(row, { companyName: "Synthetic A", blockedReason: null, currentCourseName: a.current.name, sourceCourseName: "Synthetic original", restorable: true, operationId: a.sessions[0].operationId, roundNo: "", updatedBy: null, updatedAt: oldDate.toISOString(), startDate: "2099-09-01", endDate: "2099-09-02" });
      assert.deepEqual(await f.repo.planCourseNameRestore("123"), plan); assert.deepEqual(await f.snapshot(), before);
      assert.ok(!observed.names.some(name => ["update", "insert", "delete", "create", "createIndexes", "collMod"].includes(name)));
    });
    await suite.test("latest two records and reason precedence never fall back from malformed latest", async () => {
      const f = await fixture(), current = await f.course();
      for (const mappedFields of [MongoDbNull, MongoJsonNull, [], {}, { courseName: " " }, { courseName: 3 }]) {
        const row = await f.session(current.id); await f.source(row.id, { createdAt: new Date("2099-01-01") });
        await f.source(row.id, { mappedFields });
        const result = (await f.repo.planCourseNameRestore("123")).rows.find(item => item.operationId === row.operationId); assert.equal(result?.blockedReason, reason.missing);
      }
      const tied = await f.session(current.id); await f.source(tied.id, { mappedFields: { courseName: current.name } }); await f.source(tied.id);
      const same = await f.session(current.id); await f.source(same.id, { mappedFields: { courseName: ` ${current.name} ` } });
      const noSource = await f.session(current.id);
      await f.course({ courseId: "123", name: "Synthetic duplicate" }); await f.course({ courseId: "123\u200b", name: "Synthetic duplicate" });
      const duplicate = await f.session(current.id); await f.source(duplicate.id, { mappedFields: { courseName: "Synthetic duplicate" } });
      const rows = (await f.repo.planCourseNameRestore("123")).rows;
      for (const [row, expected] of [[tied, reason.tied], [same, reason.same], [noSource, reason.missing], [duplicate, reason.duplicate]] as const) assert.equal(rows.find(item => item.operationId === row.operationId)?.blockedReason, expected);
    });
    await suite.test("metadata conflicts are assessed across unselected entries; equivalent decimals and null metadata are compatible", async () => {
      const f = await fixture(), a = await f.group("123", f.company.id, false, 1), b = await f.group("123", f.company.id, false, 1);
      await f.replace("Course", String(a.current.id), { revenue: "1234.00", tools: null });
      await f.replace("Course", String(b.current.id), { revenue: "1234", tools: null });
      assert.ok((await f.repo.planCourseNameRestore("123")).rows.every(row => row.restorable));
      await f.replace("Course", String(b.current.id), { tools: "Synthetic conflicting metadata" });
      const plan = await f.repo.planCourseNameRestore("123"); assert.ok(plan.rows.every(row => row.blockedReason === reason.metadata));
      const before = await f.snapshot(); await assert.rejects(f.repo.applyCourseNameRestore("123", [String(a.sessions[0].operationId)], plan.snapshot, null), CourseNameRestoreConflict); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("unrelated projections, re-encryption, decimal representation and JSON key order preserve snapshot", async () => {
      const f = await fixture(), g = await f.group(), selected = g.sessions[0];
      const older = await f.source(selected.id, { createdAt: new Date("2099-01-01") }); await f.source(selected.id, { createdAt: new Date("2099-01-02") });
      const deleted = await f.session(g.current.id, { deletedAt: oldDate }); const other = await f.group("unrelated", f.company.id, true, 1);
      await f.replace("OperationSourceRecord", String(g.sources[0].id), { mappedFields: { courseName: "Synthetic original", extra: { a: 1, b: null } } });
      const plan = await f.repo.planCourseNameRestore("123");
      await f.replace("OperationSession", String(selected.id), { omName: "Synthetic changed private owner" });
      await f.replace("OperationSession", String(deleted.id), { updatedAt: new Date(), roundNo: "changed" });
      await f.replace("OperationSourceRecord", String(older.id), { mappedFields: { courseName: "Ignored old name" } });
      await f.replace("OperationSourceRecord", String(g.sources[0].id), { rowSnapshot: { changed: true }, mappedFields: { extra: { b: null, a: 1 }, courseName: "Synthetic original" } });
      await f.replace("Course", String(g.current.id), { revenue: "1234" });
      await f.replace("Course", String(other.current.id), { tools: "unrelated change" });
      assert.equal((await f.repo.planCourseNameRestore("123")).snapshot, plan.snapshot);
    });
    for (const existing of [true, false]) {
      await suite.test(`${existing ? "reuse immutable existing" : "create one metadata-preserving new"} target with selected-only partial writes and atomic audits`, async () => {
        const f = await fixture(), g = await f.group("123", f.company.id, existing, 3);
        const deleted = await f.session(g.current.id, { deletedAt: oldDate }); await f.source(deleted.id);
        const plan = await f.repo.planCourseNameRestore("123"), before = await f.snapshot(), counterBefore = await f.counter();
        const ids = g.sessions.slice(0, 2).map(row => String(row.operationId));
        const observed = await wire(() => attributed(() => f.repo.applyCourseNameRestore("123.0", ids, plan.snapshot, actor)));
        assert.deepEqual(observed.result, { moved: ids.map(operationId => ({ operationId, from: g.current.name, to: "Synthetic original" })), skipped: [] });
        const firstCommand = observed.commands[0]; assert.ok(firstCommand?.collection.endsWith("_CourseNameRestoreGuard")); assert.equal(firstCommand.name, "update");
        const reads = observed.commands.filter(command => ["find", "aggregate"].includes(command.name)); assert.ok(reads.length > 0); assert.ok(reads.every(command => command.session === firstCommand.session));
        const after = await f.snapshot(), targets = await f.store.scan("Course", { name: "Synthetic original" }); assert.equal(targets.length, 1);
        const target = targets[0]; assert.equal(target.companyId, f.company.id);
        if (existing) {
          assert.equal(target.id, g.target!.id); assert.deepEqual(after.Course, before.Course); assert.deepEqual(await f.counter(), counterBefore);
        } else {
          assert.equal(target.processSeq, 1001); assert.equal((await f.counter())?.value, 1001);
          for (const key of ["operationType", "courseCategory", "tools", "revenueRaw"]) assert.deepEqual(target[key], g.current[key]);
          assert.equal(Number(target.revenue), 1234); assert.equal(target.courseId, "123");
          assert.deepEqual(after.Course.filter(row => row._id !== target.id), before.Course);
        }
        for (const original of before.OperationSession) {
          const current = after.OperationSession.find(row => row._id === original._id); assert.ok(current);
          if (!g.sessions.slice(0, 2).some(row => row.id === original._id)) { assert.deepEqual(current, original); continue; }
          assert.equal(current.courseRecordId, target.id); assert.equal(current.updatedByPiiIndex, mongoRuntimeBlindIndex("OperationSession", "updatedBy", actor)); assert.notDeepEqual(current.updatedAt, oldDate);
          for (const key of Object.keys(original)) if (!["courseRecordId", "updatedBy", "updatedByPiiIndex", "updatedAt"].includes(key)) assert.deepEqual(current[key], original[key]);
        }
        assert.deepEqual(after.Company, before.Company); assert.deepEqual(after.OperationSourceRecord, before.OperationSourceRecord);
        const audits = await f.store.scan("ActivityChange", {}); assert.equal(audits.length, existing ? 2 : 3);
        assert.equal(audits.filter(row => row.targetType === "operation_sessions" && row.action === "update").length, 2);
        assert.doesNotMatch(JSON.stringify(after.ActivityChange), /synthetic-course-restore@example.invalid|Synthetic private/);
        await assert.rejects(f.repo.applyCourseNameRestore("123", ids, plan.snapshot, actor), CourseNameRestoreConflict);
        assert.deepEqual(await f.snapshot(), after);
      });
    }
    await suite.test("invalid selections fail wholly and roll back guard; operation IDs remain exact", async () => {
      const f = await fixture(), g = await f.group(), blocked = await f.session(g.current.id);
      const plan = await f.repo.planCourseNameRestore("123"), id = String(g.sessions[0].operationId), before = await f.snapshot();
      for (const ids of [[], [id, id], [id, "outside"], [id, String(blocked.operationId)], [` ${id}`], [id.toLowerCase()], Array.from({ length: 101 }, (_, n) => `outside-${n}`)]) {
        await assert.rejects(f.repo.applyCourseNameRestore("123", ids, plan.snapshot, null), CourseNameRestoreConflict); assert.deepEqual(await f.snapshot(), before);
      }
    });
    for (const mutation of ["source", "course", "unselected", "new-target"] as const) {
      await suite.test(`completed ${mutation} change makes the saved plan stale without partial writes`, async () => {
        const f = await fixture(), g = await f.group("123", f.company.id, false), plan = await f.repo.planCourseNameRestore("123");
        if (mutation === "source") await f.replace("OperationSourceRecord", String(g.sources[0].id), { mappedFields: { courseName: "Changed original" } });
        if (mutation === "course") await f.replace("Course", String(g.current.id), { tools: "Changed tool" });
        if (mutation === "unselected") await f.replace("OperationSession", String(g.sessions[1].id), { roundNo: "changed" });
        if (mutation === "new-target") await f.course({ name: "Synthetic original" });
        const before = await f.snapshot(); await assert.rejects(f.repo.applyCourseNameRestore("123", [String(g.sessions[0].operationId)], plan.snapshot, null), CourseNameRestoreConflict); assert.deepEqual(await f.snapshot(), before);
      });
    }
    for (const failAt of ["session", "audit"] as const) {
      await suite.test(`late actual ${failAt} failure restores new target, moved rows, audits, counter and guard bytes`, async () => {
        const f = await fixture(), g = await f.group("123", f.company.id, false), plan = await f.repo.planCourseNameRestore("123"), before = await f.snapshot();
        const originalWrite = Collection.prototype.updateOne, originalAudit = Collection.prototype.insertOne; let writes = 0, audits = 0;
        const writePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          const result = await originalWrite.apply(this, args);
          if (this.collectionName === `${f.options.namespace}_OperationSession` && ++writes === 2 && failAt === "session") throw new Error("synthetic-injected-secret");
          return result;
        });
        const auditPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const result = await originalAudit.apply(this, args);
          if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++audits === 3 && failAt === "audit") throw new Error("synthetic-injected-secret");
          return result;
        });
        try { await assert.rejects(attributed(() => f.repo.applyCourseNameRestore("123", g.sessions.map(row => String(row.operationId)), plan.snapshot, actor)), safeError); }
        finally { writePatch.mock.restore(); auditPatch.mock.restore(); }
        assert.equal(writes, 2); assert.equal(audits, failAt === "audit" ? 3 : 2); assert.deepEqual(await f.snapshot(), before);
      });
    }
    // The first successful guard write stays uncommitted until a competing real
    // guard command reports WriteConflict/duplicate upsert. No synthetic error labels.
    for (const variant of ["same-company-existing", "cross-company-existing", "same-key-new", "different-key-new"] as const) {
      await suite.test(`${variant}: singleton first-upsert contention rechecks the originally submitted plans`, async () => {
        const f = await fixture(), existing = variant.endsWith("existing"), first = await f.group("123", f.company.id, existing, 1);
        const secondCompany = variant === "cross-company-existing" ? await f.insert("Company", { name: "Synthetic B", normalizedName: "synthetic-b" }) : f.company;
        // Same-company existing uses the same current/target with disjoint selected rows.
        let second: typeof first;
        if (variant === "same-company-existing") {
          const row = await f.session(first.current.id); await f.source(row.id); second = { ...first, sessions: [row] };
        } else second = await f.group(variant === "different-key-new" ? "456" : "123", secondCompany.id, existing, 1);
        const firstPlan = await f.repo.planCourseNameRestore(first.key), secondPlan = await f.repo.planCourseNameRestore(second.key), counterBefore = await f.counter();
        const held = signal(), conflictSeen = signal(), release = signal(), original = Collection.prototype.updateOne;
        let paused = false, guardWrites = 0;
        const onFailure = (event: CommandFailedEvent) => { if ([112, 11000].includes((event.failure as { code?: number }).code ?? 0)) conflictSeen.resolve(); };
        const onSuccess = (event: CommandSucceededEvent) => { if ((event.reply as Document).writeErrors?.some((error: { code: number }) => [112, 11000].includes(error.code))) conflictSeen.resolve(); };
        const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          const result = await original.apply(this, args);
          if (this.collectionName === `${f.options.namespace}_CourseNameRestoreGuard`) {
            guardWrites++; if (!paused) { paused = true; held.resolve(); await release.promise; }
          }
          return result;
        });
        client.on("commandFailed", onFailure); client.on("commandSucceeded", onSuccess);
        const a = attributed(() => f.repo.applyCourseNameRestore(first.key, [String(first.sessions[0].operationId)], firstPlan.snapshot, actor)); void a.catch(() => {});
        let b: Promise<CourseNameRestoreResult> | undefined;
        try {
          await bounded(Promise.race([held.promise, a.then(() => { throw new Error("Guard barrier not reached"); })]));
          b = attributed(() => f.repo.applyCourseNameRestore(second.key, [String(second.sessions[0].operationId)], secondPlan.snapshot, actor)); void b.catch(() => {});
          await bounded(Promise.race([conflictSeen.promise, b.then(() => { throw new Error("Missing real guard conflict"); })])); release.resolve();
          const results = await Promise.allSettled([a, b]);
          assert.equal(results.filter(row => row.status === "fulfilled").length, variant === "different-key-new" ? 2 : 1);
          if (variant !== "different-key-new") { const failed = results.find(row => row.status === "rejected"); assert.ok(failed?.status === "rejected" && failed.reason instanceof CourseNameRestoreConflict); }
        } finally { release.resolve(); await Promise.allSettled(b ? [a, b] : [a]); patch.mock.restore(); client.off("commandFailed", onFailure); client.off("commandSucceeded", onSuccess); }
        assert.ok(guardWrites >= 2, "retry must write the guard before re-reading its plan");
        if (existing) assert.deepEqual(await f.counter(), counterBefore);
        else assert.equal((await f.counter())?.value, variant === "different-key-new" ? 1002 : 1001);
        const audits = await f.store.scan("ActivityChange", {}); assert.equal(audits.filter(row => row.targetType === "operation_sessions").length, variant === "different-key-new" ? 2 : 1);
        assert.equal(await f.store.db.collection(`${f.options.namespace}_CourseNameRestoreGuard`).countDocuments(), 1);
        assert.equal(await f.store.collection("Course").countDocuments({ name: "Synthetic original" }), variant === "cross-company-existing" || variant === "different-key-new" ? 2 : 1);
      });
    }
    for (const writer of ["update", "delete", "bulk", "restore", "backfill"] as const) {
      await suite.test(`selected real ${writer} writer commits after plan read; apply conflict retry rejects the saved snapshot`, async () => {
        const f = await fixture(), g = await f.group(), plan = await f.repo.planCourseNameRestore("123"), requestId = randomUUID();
        const operations = await MongoOperationRepository.open(f.options), bulk = await MongoCourseAdminRepository.open(f.options), restore = await MongoDeletedOperationRepository.open(f.options), backfill = await MongoOperationBackfillRepository.open(f.options);
        const held = signal(), release = signal(), original = Collection.prototype.updateOne; let paused = false;
        const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          if (!paused && this.collectionName === `${f.options.namespace}_OperationSession` && activityContext.getStore()?.requestId === requestId) { paused = true; held.resolve(); await release.promise; }
          return original.apply(this, args);
        });
        const pending = attributed(() => f.repo.applyCourseNameRestore("123", [String(g.sessions[0].operationId)], plan.snapshot, actor), requestId); void pending.catch(() => {});
        let committed: Record<string, Document[]> | undefined;
        try {
          await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Selected-write barrier not reached"); })]));
          const observed = await wire(async () => {
            await attributed(async () => {
              const id = String(g.sessions[0].operationId);
              if (writer === "update") await operations.updateOperation(id, { om: "Synthetic private winner" }, actor);
              else if (writer === "delete") await operations.deleteOperation(id, actor);
              else if (writer === "bulk") assert.equal(await bulk.softDeleteCourseSessions(String(g.current.id), actor), 2);
              else if (writer === "restore") await restore.restoreOperation(id);
              else assert.equal(await backfill.applyOnsiteRequiredBackfill(), 2);
            });
            committed = await f.snapshot(); release.resolve(); await assert.rejects(pending, CourseNameRestoreConflict);
          });
          assert.ok(observed.conflicts > 0);
        } finally { release.resolve(); await Promise.allSettled([pending]); patch.mock.restore(); }
        assert.ok(committed); assert.deepEqual(await f.snapshot(), committed);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), 0);
        assert.equal((await f.store.one("OperationSession", { _id: String(g.sessions[0].id) }))?.courseRecordId, g.current.id);
      });
    }
    await suite.test("101 rows remain readable and exactly 100 selected rows move with no getMore", async () => {
      const f = await fixture(), g = await f.group("123", f.company.id, true, 101);
      const observed = await wire(async () => {
        const plan = await f.repo.planCourseNameRestore("123"); assert.equal(plan.rows.length, 101);
        return f.repo.applyCourseNameRestore("123", g.sessions.slice(0, 100).map(row => String(row.operationId)), plan.snapshot, null);
      });
      assert.equal(observed.result.moved.length, 100); assert.deepEqual(observed.result.skipped, []); assert.ok(!observed.names.includes("getMore"));
      assert.equal(await f.store.collection("OperationSession").countDocuments({ courseRecordId: g.target!.id }), 100);
      assert.equal((await f.store.one("OperationSession", { _id: String(g.sessions[100].id) }))?.courseRecordId, g.current.id);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0);
    });
    await suite.test("actual BSON-short session pages do not truncate the plan or request getMore", async () => {
      const f = await fixture(), g = await f.group("123", f.company.id, true, 3);
      for (const row of g.sessions) await f.replace("OperationSession", String(row.id), { operationDetail: "x".repeat(5 * 1024 * 1024) });
      const observed = await wire(() => f.repo.planCourseNameRestore("123")); assert.equal(observed.result.rows.length, 3); assert.ok(!observed.names.includes("getMore"));
      const pages = observed.batches.filter(row => row.collection === `${f.options.namespace}_OperationSession`);
      assert.ok(pages.some(row => row.count > 0 && row.count < 3 && row.bytes > 6 * 1024 * 1024)); assert.ok(pages.filter(row => row.count > 0).length >= 2);
    });
    await suite.test("real scan byte limit refuses plan/apply without committing guard or a partial result", async () => {
      const f = await fixture(), g = await f.group("123", f.company.id, true, 6), plan = await f.repo.planCourseNameRestore("123");
      for (const row of g.sessions) await f.replace("OperationSession", String(row.id), { operationDetail: "x".repeat(5 * 1024 * 1024) });
      const before = await f.snapshot();
      await assert.rejects(f.repo.planCourseNameRestore("123"), /SCAN_LIMIT_EXCEEDED/);
      await assert.rejects(f.repo.applyCourseNameRestore("123", [String(g.sessions[0].operationId)], plan.snapshot, null), /SCAN_LIMIT_EXCEEDED/); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("simulated scan15s and total30s deadlines reject late completion with complete raw rollback", async () => {
      const f = await fixture(), g = await f.group("123", f.company.id, false, 1), plan = await f.repo.planCourseNameRestore("123"), before = await f.snapshot();
      for (const phase of ["scan", "transaction"] as const) {
        const now = performance.now.bind(performance); let elapsed = 0, audits = 0;
        const clock = mock.method(performance, "now", () => now() + elapsed), close = AbstractCursor.prototype.close, insert = Collection.prototype.insertOne;
        const cursorPatch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) {
          await close.apply(this, args); if (phase === "scan" && this.namespace.collection === `${f.options.namespace}_OperationSession`) elapsed = 16_001;
        });
        const auditPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const result = await insert.apply(this, args); if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++audits === 2 && phase === "transaction") elapsed = 30_001; return result;
        });
        try { await assert.rejects(attributed(() => f.repo.applyCourseNameRestore("123", [String(g.sessions[0].operationId)], plan.snapshot, actor)), error => { safeError(error); assert.match(String(error), /TIMEOUT/); return true; }); }
        finally { cursorPatch.mock.restore(); auditPatch.mock.restore(); clock.mock.restore(); }
        assert.equal(elapsed, phase === "scan" ? 16_001 : 30_001); assert.deepEqual(await f.snapshot(), before);
      }
    });
    await suite.test("guard conflict retry keeps total30s: virtual20s+15s rejects the later independent plan without undoing its winner", async () => {
      const f = await fixture(), a = await f.group("123", f.company.id, true, 1), b = await f.group("456", f.company.id, true, 1);
      const planA = await f.repo.planCourseNameRestore("123"), planB = await f.repo.planCourseNameRestore("456"), laterId = randomUUID();
      const held = signal(), release = signal(), conflict = signal(), original = Collection.prototype.updateOne;
      const now = performance.now.bind(performance); let elapsed = 0, firstGuard = false, retryWrites = 0, realConflicts = 0;
      let afterWinner: Record<string, Document[]> | undefined;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const later = activityContext.getStore()?.requestId === laterId;
        if (later && this.collectionName === `${f.options.namespace}_OperationSession` && !afterWinner) afterWinner = await f.snapshot();
        try {
          const result = await original.apply(this, args);
          if (this.collectionName === `${f.options.namespace}_CourseNameRestoreGuard` && !firstGuard) { firstGuard = true; held.resolve(); await release.promise; }
          if (later && this.collectionName === `${f.options.namespace}_OperationSession`) { retryWrites++; elapsed = 35_000; }
          return result;
        } catch (error) {
          if (later && [112, 11000].includes((error as { code?: number }).code ?? 0)) { realConflicts++; elapsed = 20_000; conflict.resolve(); }
          throw error;
        }
      });
      const winner = attributed(() => f.repo.applyCourseNameRestore("123", [String(a.sessions[0].operationId)], planA.snapshot, actor)); void winner.catch(() => {});
      let pending: Promise<CourseNameRestoreResult> | undefined;
      try {
        await bounded(Promise.race([held.promise, winner.then(() => { throw new Error("Deadline guard barrier not reached"); })]));
        pending = attributed(() => f.repo.applyCourseNameRestore("456", [String(b.sessions[0].operationId)], planB.snapshot, actor), laterId); void pending.catch(() => {});
        await bounded(conflict.promise); release.resolve(); await winner;
        // The competing transaction can only obtain the guard after winner commits.
        // Its failed session write must leave the same committed winner state.
        await assert.rejects(pending, error => { safeError(error); assert.match(String(error), /TIMEOUT/); return true; });
      } finally { release.resolve(); await Promise.allSettled(pending ? [winner, pending] : [winner]); patch.mock.restore(); clock.mock.restore(); }
      assert.ok(realConflicts > 0); assert.equal(retryWrites, 1); assert.equal(elapsed, 35_000);
      assert.ok(afterWinner); assert.deepEqual(await f.snapshot(), afterWinner);
      assert.equal((await f.store.one("OperationSession", { _id: String(a.sessions[0].id) }))?.courseRecordId, a.target!.id);
      assert.equal((await f.store.one("OperationSession", { _id: String(b.sessions[0].id) }))?.courseRecordId, b.current.id);
      assert.equal(afterWinner.ActivityChange.length, 1); assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId: laterId }), 0);
      assert.equal((await f.counter())?.value, 1000);
    });
    for (const problem of ["guard-validator", "business-index", "counter-high-water"] as const) {
      await suite.test(`unready ${problem} rejects open without repairing DDL or data`, async () => {
        const f = await fixture();
        if (problem === "guard-validator") await f.store.db.command({ collMod: `${f.options.namespace}_CourseNameRestoreGuard`, validator: {}, validationLevel: "moderate" });
        else if (problem === "business-index") { const name = operationMongoIndexes("Course")[0]?.name; assert.ok(name); await f.store.collection("Course").dropIndex(name); }
        else { await f.course({ processSeq: 1500 }); }
        const before = await f.snapshot(), observed = await wire(async () => { await assert.rejects(MongoCourseNameRestoreRepository.open(f.options)); });
        assert.ok(!observed.names.some(name => ["create", "createIndexes", "collMod", "insert", "update", "delete"].includes(name))); assert.deepEqual(await f.snapshot(), before);
      });
    }
  } finally {
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_course_name_restore_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
