import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { MongoClient } from "mongodb";
import pg from "pg";
import { activityContext } from "../activity/context";
import { getPrismaClient } from "./prisma";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { planCourseNameRestore as originalPlan, applyCourseNameRestore as originalApply, CourseNameRestoreConflict as OriginalConflict } from "./courseNameRestoreOriginalOracle.fixture";
import { planCourseNameRestore as publicPlan, applyCourseNameRestore as publicApply } from "./courseNameRestore";
import { CourseNameRestoreConflict, type CourseNameRestoreRepository, type CourseNameRestorePlan } from "./courseNameRestoreRepository";
import { PrismaCourseNameRestoreRepository } from "./prismaCourseNameRestoreRepository";
import { MongoCourseNameRestoreRepository, prepareMongoCourseNameRestoreStore } from "./mongoCourseNameRestoreRepository";

const url = process.env.COURSE_NAME_RESTORE_PG_TEST_DATABASE_URL;
const uri = process.env.MONGODB_COURSE_NAME_RESTORE_TEST_URI;
const id = (n: number) => `c0a533ab-0000-4000-8000-${String(n).padStart(12, "0")}`;
const op = (n: number) => `SYNTHETIC-${n}`;
const day = (n: number) => new Date(`2099-01-${String(n).padStart(2, "0")}T00:00:00.000Z`);
const models = ["Company", "Course", "OperationSession", "DataImportRun", "OperationSourceRecord", "Coach", "CoachEngagement", "ActivityChange"] as const;
const tables = ["companies", "courses", "operation_sessions", "data_import_runs", "operation_source_records", "coaches", "coach_engagements", "activity_changes"] as const;
const privateActor = "synthetic-restorer@example.invalid";
const actor = { requestId: id(9000), route: "/api/admin/course-name-restore", method: "POST", actorEmail: privateActor, actorName: "Synthetic private actor", actorType: "user" as const };
const RAW_ID = " \u200b533.0\ufeff ";
type Database = ReturnType<typeof getPrismaClient>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("frozen 95cdb6f courseNameRestore oracle remains byte-identical", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("./courseNameRestoreOriginalOracle.fixture.ts", import.meta.url))).digest("hex"), "7d1799b834f6407aef97fae8735e3fa11279398f94da8d884fc2c7b9db8be92c");
});

const missing = "원천 과정명이 없습니다.";
const tie = "최신 원천 기록의 시각이 같아 복원 근거를 확정할 수 없습니다.";
const same = "원천 과정명과 현재 과정명이 같습니다.";
const duplicate = "같은 기업·코스ID·과정명의 대상이 여러 개입니다.";
const metadataConflict = "새 과정에 복사할 유형·도구·매출 정보가 서로 다릅니다.";
// Explicit expected rows, not computed by a copy of the production decision tree.
const expectedRows = [
  [201, "A", "Current", "Existing", null], [202, "A", "Current", "New Shared", null], [203, "A", "Current", "New Shared", null],
  [204, "B", "Current", "Existing", null], [205, "A", "Current", null, missing], [206, "A", "Current", null, missing],
  [207, "A", "Current", "Current", tie], [208, "A", "Current", "Current", same], [209, "A", "Current", "Duplicate", duplicate],
  [210, "A", "Current", "Meta New", metadataConflict], [211, "A", "Different metadata", "Meta New", metadataConflict],
  [213, "A", "Current", null, missing], [214, "A", "Current", null, missing], [215, "A", "Current", null, missing],
  [216, "A", "Current", "Existing", null], [217, "A", "Current", null, missing]
] as const;
const courseSpecs = [
  [101, 1, " 533.0 ", "Current", "source-tool"], [102, 1, "533\u200b", "Existing", "existing-tool"],
  [103, 2, "533", "Current", "source-tool"], [104, 2, "533", "Existing", "existing-company-B-tool"],
  [105, 1, "533", "Different metadata", "different-tool"], [106, 1, "533", "Duplicate", "source-tool"],
  [107, 1, "533\u200b", "Duplicate", "source-tool"], [108, 1, "OTHER", "Existing", "other-tool"],
  [109, 1, "533", "Zero sessions", "source-tool"], [110, 1, "533", "Current", "source-tool"]
] as const;
function fixture() {
  const data = new Map<string, MongoRow[]>();
  const add = (model: string, values: MongoRow) => data.set(model, [...(data.get(model) ?? []), coachFixtureRow(model, values)]);
  for (const n of [1, 2]) add("Company", { id: id(n), name: `Synthetic company ${n === 1 ? "A" : "B"}`, normalizedName: `synthetic-company-${n}`, createdAt: day(1), updatedAt: day(1) });
  for (const [n, company, courseId, name, tools] of courseSpecs) add("Course", { id: id(n), processSeq: n, companyId: id(company), courseId, name, tools,
    operationType: "LONG", courseCategory: "synthetic-category", revenue: "1234.50", revenueRaw: "synthetic-revenue-source", createdAt: day(1), updatedAt: day(1) });
  for (let n = 201; n <= 217; n++) add("OperationSession", { id: id(n), operationId: op(n), courseRecordId: id(n === 204 ? 103 : n === 211 ? 105 : 101),
    startDate: day(1), endDate: day(2), educationDates: [day(1), day(2)], roundNo: n === 201 ? null : String(n),
    createdAt: day(1), updatedAt: day(1), updatedBy: "synthetic-previous@example.invalid", deletedAt: n === 212 ? day(2) : null,
    onsiteText: "Synthetic private onsite", specialNotes: "Synthetic private notes", totalCost: "12.34" });
  add("DataImportRun", { id: id(300), sourceType: "synthetic", sourceName: "Synthetic private import" });
  let next = 400;
  const source = (session: number, mappedFields: unknown, createdAt = day(4), rowId = next++) => add("OperationSourceRecord", {
    id: id(rowId), importRunId: id(300), operationSessionId: id(session), sourceWorkbook: "Synthetic private workbook", sourceSheet: "synthetic", sourceRowNumber: rowId,
    rowSnapshot: { synthetic: "private-source-value" }, mappedFields, createdAt
  });
  source(201, { courseName: "Old ignored third" }, day(2)); source(201, { courseName: "Older ignored" }, day(3)); source(201, { courseName: " Existing " });
  source(202, { courseName: " New Shared " }); source(203, { courseName: "New Shared" }); source(204, { courseName: "Existing" });
  source(206, { courseName: "No fallback" }, day(3)); source(206, MongoJsonNull);
  source(207, { courseName: "Other tie" }, day(4), 700); source(207, { courseName: "Current" }, day(4), 701);
  source(208, { courseName: "Current" }); source(209, { courseName: "Duplicate" });
  source(210, { courseName: "Meta New" }); source(211, { courseName: "Meta New" }); source(212, { courseName: "Existing" });
  source(213, { courseName: "No SQL-null fallback" }, day(3)); source(213, MongoDbNull);
  source(214, [{ courseName: "Not an object" }]); source(215, { courseName: "   " }); source(216, { courseName: "Existing" }); source(217, { courseName: 42 });
  add("Coach", { id: id(800), sourceCoachId: "synthetic-related-coach", name: "Synthetic related coach" });
  add("CoachEngagement", { id: id(801), sourceEngagementId: "synthetic-related-engagement", coachId: id(800), operationSessionId: id(201), courseName: "Synthetic preserved relation", startDate: day(1), endDate: day(2) });
  return data;
}
function assertFixedPlan(plan: CourseNameRestorePlan) {
  assert.match(plan.snapshot, /^[a-f0-9]{64}$/); assert.equal(plan.courseId, "533");
  assert.deepEqual(plan.companyNames, ["Synthetic company A", "Synthetic company B"]);
  assert.deepEqual(plan.rows, expectedRows.map(([n, company, currentCourseName, sourceCourseName, blockedReason]) => ({
    companyName: `Synthetic company ${company}`, currentCourseName, sourceCourseName, blockedReason, restorable: blockedReason === null,
    operationId: op(n), roundNo: n === 201 ? "" : String(n), startDate: "2099-01-01", endDate: "2099-01-02", updatedAt: day(1).toISOString(), updatedBy: "synthetic-previous@example.invalid"
  })));
  assert.deepEqual(plan.courses, courseSpecs.filter(([n]) => n !== 108).map(([n, company, , courseName]) => ({ id: id(n), companyName: `Synthetic company ${company === 1 ? "A" : "B"}`, courseName,
    sessionCount: n === 101 ? 14 : n === 103 || n === 105 ? 1 : 0, updatedAt: day(1).toISOString() })));
}
const withoutHash = (plan: CourseNameRestorePlan) => ({ companyNames: plan.companyNames, courseId: plan.courseId, courses: plan.courses, rows: plan.rows });

// No dotenv, shared-server shutdown or production access. The named synthetic DB
// alone is reset; each implementation starts from the same fixed logical fixture.
test("course-name restore: frozen PG/new PG/native Mongo plan, apply, stale, metadata and privacy parity", { skip: !url || !uri, timeout: 240_000 }, async suite => {
  const p = new URL(url!), m = new URL(uri!);
  assert.ok(["postgres:", "postgresql:"].includes(p.protocol)); assert.equal(p.hostname, "127.0.0.1"); assert.equal(p.username, "synthetic");
  assert.equal(p.password, ""); assert.ok(p.port); assert.equal(p.pathname, "/course_name_restore_parity"); assert.equal(p.search, ""); assert.equal(p.hash, "");
  assert.equal(m.protocol, "mongodb:"); assert.equal(m.hostname, "127.0.0.1"); assert.ok(m.port); assert.equal(m.username, ""); assert.equal(m.password, "");
  assert.equal(m.pathname, "/"); assert.equal(m.hash, ""); assert.deepEqual([...m.searchParams.keys()], ["replicaSet"]); assert.ok(m.searchParams.get("replicaSet"));
  const names = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: url, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: url }); const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const namespace = `shadow_course_restore_pg_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName: "hub_om_shadow_course_name_restore_parity", namespace, allowShadowWrites: true as const, processSequenceHighWater: 1000 };
  let db: Database | undefined, pgConnected = false, mongoConnected = false;
  try {
    await sql.connect(); pgConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0], { db: "course_name_restore_parity", usr: "synthetic" });
    await client.connect(); mongoConnected = true;
    const hello = await client.db("admin").command({ hello: 1 }); assert.equal(hello.isWritablePrimary, true); assert.equal(hello.setName, m.searchParams.get("replicaSet"));
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations"); const migrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrations.length, 45);
    for (const migration of migrations) await sql.query(readFileSync(path.join(root, migration, "migration.sql"), "utf8"));
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    db = getPrismaClient(); const pgDb = db;
    await prepareMongoCourseNameRestoreStore(options);
    await prepareMongoReadStore(options, ["DataImportRun", "Coach", "CoachEngagement"]);
    const store = new MongoOperationStore(options, models), mongo = await MongoCourseNameRestoreRepository.open(options);
    const data = fixture();
    const delegates = pgDb as unknown as Record<string, { createMany(args: { data: MongoRow[] }): Promise<unknown> }>;
    const seedPg = async () => {
      await sql.query(`TRUNCATE ${tables.join(", ")} CASCADE`);
      for (const [model, rows] of data) await delegates[model[0].toLowerCase() + model.slice(1)].createMany({ data: rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === MongoDbNull ? Prisma.DbNull : value === MongoJsonNull ? Prisma.JsonNull : value]))) });
      await sql.query("SELECT setval('courses_process_seq_seq', 1000, true)");
    };
    for (const [model, rows] of data) await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    const rawPg = async (table: string): Promise<MongoRow[]> => (await sql.query(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY id`)).rows.map(entry => entry.row);
    const summaries: unknown[] = []; let baselineSnapshot: string | undefined;
    console.log(`[course-name-restore-pg] migrations=${migrations.length} oracle=95cdb6f sequence=1000`);
    for (const backend of ["original PG", "new PG", "native Mongo"] as const) await suite.test(backend, async () => {
      const isMongo = backend === "native Mongo";
      if (!isMongo) await seedPg();
      const repo: CourseNameRestoreRepository = isMongo ? mongo : backend === "new PG" ? new PrismaCourseNameRestoreRepository(pgDb) : {
        planCourseNameRestore: raw => originalPlan(raw, pgDb), applyCourseNameRestore: (raw, ids, snapshot, email) => originalApply(raw, ids, snapshot, email, pgDb)
      };
      const rawRows = async (model: string): Promise<MongoRow[]> => isMongo ? await store.collection(model).find({}).sort({ _id: 1 }).toArray() : await rawPg(tables[models.indexOf(model as typeof models[number])]);
      const logicalRows = async (model: string): Promise<MongoRow[]> => {
        if (isMongo) return (await store.collection(model).find({}).sort({ _id: 1 }).toArray()).map(row => decodeMongoRuntimeDocument(model, row));
        const delegate = pgDb as unknown as Record<string, { findMany(args: unknown): Promise<MongoRow[]> }>;
        return delegate[model[0].toLowerCase() + model.slice(1)].findMany({ orderBy: { id: "asc" } });
      };
      const snapshotRaw = async () => {
        const state: Record<string, string> = {};
        for (const model of models) state[model] = digest(await rawRows(model));
        if (isMongo) {
          const collections = await store.db.listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray();
          for (const { name } of collections) state[name] = digest(await store.db.collection(name).find({}).sort({ _id: 1 }).toArray());
        }
        return state;
      };
      const before = await snapshotRaw(), plan = await repo.planCourseNameRestore(RAW_ID);
      assertFixedPlan(plan);
      assert.deepEqual(await repo.planCourseNameRestore("533"), plan);
      assert.deepEqual(await snapshotRaw(), before, "GET does not change raw rows, guard or counter");
      if (!isMongo) {
        assert.deepEqual(plan, await originalPlan(RAW_ID, pgDb), "new PG hash bytes/DTO match frozen oracle");
        assert.deepEqual(await publicPlan(RAW_ID, pgDb), plan, "legacy explicit-db facade remains compatible");
        if (backend === "original PG") baselineSnapshot = plan.snapshot; else assert.equal(plan.snapshot, baselineSnapshot);
      }
      const emptyPlan = await repo.planCourseNameRestore("missing-synthetic-course");
      assert.deepEqual(withoutHash(emptyPlan), { courseId: "missing-synthetic-course", companyNames: [], courses: [], rows: [] });
      const conflict = (error: unknown) => error instanceof OriginalConflict || error instanceof CourseNameRestoreConflict;
      for (const selection of [[], [op(201), op(201)], [op(201), "missing-operation"], [op(201), op(212)], [op(210)], [op(201), op(206)], Array.from({ length: 101 }, (_, n) => `outside-${n}`)]) {
        await assert.rejects(repo.applyCourseNameRestore(RAW_ID, selection, plan.snapshot, privateActor), conflict);
        assert.deepEqual(await snapshotRaw(), before, "invalid/blocked selection is all-or-nothing, including all-plan metadata conflict");
      }
      await assert.rejects(repo.applyCourseNameRestore(RAW_ID, [op(201)], "0".repeat(64), privateActor), conflict);
      assert.deepEqual(await snapshotRaw(), before);
      const originalCourses = await rawRows("Course"), originalSessions = await rawRows("OperationSession");
      const selected = [201, 202, 203, 204], started = Date.now();
      const result = await activityContext.run(actor, () => backend === "new PG"
        ? publicApply(RAW_ID, selected.map(op), plan.snapshot, privateActor, pgDb)
        : repo.applyCourseNameRestore(RAW_ID, selected.map(op), plan.snapshot, privateActor));
      assert.deepEqual(result, { moved: [{ operationId: op(201), from: "Current", to: "Existing" }, { operationId: op(202), from: "Current", to: "New Shared" }, { operationId: op(203), from: "Current", to: "New Shared" }, { operationId: op(204), from: "Current", to: "Existing" }], skipped: [] });
      const afterCourses = await logicalRows("Course"), added = afterCourses.filter(row => !courseSpecs.some(([n]) => id(n) === row.id));
      assert.equal(added.length, 1); const target = added[0];
      assert.deepEqual({ companyId: target.companyId, courseId: target.courseId, name: target.name, processSeq: target.processSeq, operationType: target.operationType, courseCategory: target.courseCategory, tools: target.tools, revenue: String(target.revenue), revenueRaw: target.revenueRaw },
        { companyId: id(1), courseId: "533", name: "New Shared", processSeq: 1001, operationType: "LONG", courseCategory: "synthetic-category", tools: "source-tool", revenue: isMongo ? "1234.50" : "1234.5", revenueRaw: "synthetic-revenue-source" });
      const rawAfterCourses = await rawRows("Course");
      for (const row of originalCourses) assert.deepEqual(rawAfterCourses.find(next => (next.id ?? next._id) === (row.id ?? row._id)), row, "existing target/source course unchanged");
      const sessions = await logicalRows("OperationSession"), rawAfterSessions = await rawRows("OperationSession");
      for (let n = 201; n <= 217; n++) {
        const row = sessions.find(value => value.id === id(n))!, raw = rawAfterSessions.find(value => (value.id ?? value._id) === id(n))!, old = originalSessions.find(value => (value.id ?? value._id) === id(n))!;
        if (!selected.includes(n)) { assert.deepEqual(raw, old); continue; }
        assert.equal(row.courseRecordId, n === 201 ? id(102) : n === 204 ? id(104) : target.id); assert.equal(row.updatedBy, privateActor);
        assert.ok(row.updatedAt instanceof Date && row.updatedAt.getTime() >= started && row.updatedAt.getTime() <= Date.now());
        const allowed = isMongo ? ["courseRecordId", "updatedBy", "updatedByPiiIndex", "updatedAt"] : ["course_record_id", "updated_by", "updated_by_pii_index", "updated_at"];
        const omit = (value: MongoRow) => Object.fromEntries(Object.entries(value).filter(([key]) => !allowed.includes(key)));
        assert.deepEqual(omit(raw), omit(old), "selected session unrelated ciphertext/raw preserved");
      }
      const after = await snapshotRaw();
      for (const model of models) if (model !== "Course" && model !== "OperationSession" && model !== "ActivityChange") assert.equal(after[model], before[model], `${model} relation/source unchanged`);
      await assert.rejects(repo.applyCourseNameRestore(RAW_ID, [op(201)], plan.snapshot, null), conflict);
      const fresh = await repo.planCourseNameRestore(RAW_ID);
      await assert.rejects(repo.applyCourseNameRestore(RAW_ID, [op(201)], fresh.snapshot, null), conflict);
      assert.deepEqual(await snapshotRaw(), after, "replay/stale failures roll back guard/counter/audit as well");
      const audit = await logicalRows("ActivityChange"); assert.equal(audit.length, 5);
      assert.equal(audit.filter(row => row.targetType === "courses" && row.action === "create").length, 1);
      assert.equal(audit.filter(row => row.targetType === "operation_sessions" && row.action === "update").length, 4);
      for (const row of audit) { assert.equal(row.actorEmail, privateActor); assert.equal(row.requestId, actor.requestId); }
      const canonicalAudit = audit.map(row => {
        const fields = Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "occurredAt", "actorEmailPiiIndex", "actorNamePiiIndex"].includes(key)));
        return JSON.parse(JSON.stringify(fields).replaceAll(String(target.id), "NEW_TARGET_A")) as MongoRow;
      }).sort((a, b) => `${a.targetType}:${a.targetId}`.localeCompare(`${b.targetType}:${b.targetId}`));
      for (const model of ["OperationSession", "OperationSourceRecord", "ActivityChange"]) {
        const raw = JSON.stringify(await rawRows(model));
        for (const secret of [privateActor, actor.actorName, "synthetic-previous@example.invalid", "Synthetic private onsite", "Synthetic private notes", "Synthetic private workbook", "private-source-value"]) assert.equal(raw.includes(secret), false);
      }
      summaries.push({ plan: withoutHash(plan), result, audit: canonicalAudit });
      // A committed change to an UNSELECTED session still invalidates the whole plan.
      const stale = await repo.planCourseNameRestore(RAW_ID);
      if (isMongo) await store.collection("OperationSession").updateOne({ _id: id(205) }, { $set: { updatedAt: day(9) } });
      else await pgDb.operationSession.update({ where: { id: id(205) }, data: { updatedAt: day(9) } });
      const changed = await snapshotRaw();
      await assert.rejects(repo.applyCourseNameRestore(RAW_ID, [op(216)], stale.snapshot, privateActor), conflict);
      assert.deepEqual(await snapshotRaw(), changed);
    });
    assert.equal(summaries.length, 3); assert.deepEqual(summaries[1], summaries[0]); assert.deepEqual(summaries[2], summaries[0]);

    for (const implementation of ["frozen original", "new PG"] as const) await suite.test(`${implementation}: actual SSI barrier, disjoint selections, existing target, one conflict`, async () => {
      await seedPg();
      const plan = await originalPlan(RAW_ID, pgDb);
      let readers = 0, release!: () => void, timer: ReturnType<typeof setTimeout>;
      const gate = new Promise<void>((resolve, reject) => { release = resolve; timer = setTimeout(() => reject(new Error("synthetic SSI read barrier timed out")), 5000); });
      const competing = new Proxy(pgDb, { get(target, property) {
        if (property !== "$transaction") { const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; }
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: Parameters<PrismaClient["$transaction"]>[1]) => target.$transaction(tx => callback(new Proxy(tx, { get(client, model) {
          if (model !== "course") return Reflect.get(client, model);
          return new Proxy(client.course, { get(delegate, operation) {
            const fn = Reflect.get(delegate, operation);
            if (operation !== "findMany") return typeof fn === "function" ? fn.bind(delegate) : fn;
            return async (...args: unknown[]) => {
              const rows = await fn.apply(delegate, args);
              if (args[0] && typeof args[0] === "object" && "include" in args[0]) { if (++readers === 2) release(); await gate; }
              return rows;
            };
          } });
        } })), options);
      } });
      try {
        const results = await Promise.allSettled([201, 216].map(n => activityContext.run(actor, () => implementation === "frozen original"
          ? originalApply(RAW_ID, [op(n)], plan.snapshot, privateActor, competing)
          : new PrismaCourseNameRestoreRepository(competing).applyCourseNameRestore(RAW_ID, [op(n)], plan.snapshot, privateActor))));
        assert.equal(readers, 2, "both complete predicate reads precede either write");
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
        const failure = results.find(result => result.status === "rejected"); assert.ok(failure?.status === "rejected");
        // The frozen baseline can leak adapter-pg's COMMIT serialization error.
        // Keep that observed limitation explicit; only the new adapter must map it to 409.
        if (implementation === "frozen original") assert.ok(failure.reason instanceof OriginalConflict
          || failure.reason?.name === "DriverAdapterError" && failure.reason?.cause?.kind === "TransactionWriteConflict" && failure.reason?.cause?.originalCode === "40001");
        else assert.ok(failure.reason instanceof CourseNameRestoreConflict, "new PG serialization conflict must map to domain 409 class");
        assert.equal(await pgDb.course.count(), courseSpecs.length, "existing target: no creation/unique/counter race");
        assert.equal(await pgDb.operationSession.count({ where: { id: { in: [id(201), id(216)] }, courseRecordId: id(102) } }), 1);
        assert.equal(await pgDb.activityChange.count(), 1);
        assert.equal(Number((await sql.query("SELECT last_value FROM courses_process_seq_seq")).rows[0].last_value), 1000);
      } finally { clearTimeout(timer!); release(); }
    });
  } finally {
    try { if (db) await db.$disconnect(); }
    finally {
      try { if (pgConnected) await sql.end(); }
      finally {
        try {
          if (mongoConnected) {
            assert.match(namespace, /^shadow_course_restore_pg_[a-f0-9]{16}$/);
            const owned = await client.db(options.databaseName).listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray();
            for (const collection of owned) { assert.ok(collection.name.startsWith(`${namespace}_`)); await client.db(options.databaseName).collection(collection.name).drop(); }
          }
        } finally { await client.close(); for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
      }
    }
  }
});
