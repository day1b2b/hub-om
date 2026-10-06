import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { MongoClient } from "mongodb";
import pg from "pg";
import { activityContext, type ActivityContext } from "../activity/context";
import { isEncrypted } from "../privacy/crypto";
import { getPrismaClient } from "./prisma";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";
import { PrismaCourseAdminRepository } from "./prismaCourseAdminRepository";
import { MongoCourseAdminRepository, prepareMongoCourseAdminStore } from "./mongoCourseAdminRepository";

const pgUrl = process.env.COURSE_ADMIN_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_COURSE_ADMIN_TEST_URI;
const id = (n: number) => `c0aabbcc-0000-4000-8000-${String(n).padStart(12, "0")}`;
const originalDate = new Date("2099-01-01T00:00:00.000Z");
const oldDeletion = new Date("2099-01-02T00:00:00.000Z");
const models = ["Company", "Course", "CourseIdLabel", "OperationSession", "DataImportRun", "OperationSourceRecord", "Coach", "CoachEngagement", "ActivityChange"] as const;
const tables = ["companies", "courses", "course_id_labels", "operation_sessions", "data_import_runs", "operation_source_records", "coaches", "coach_engagements", "activity_changes"] as const;
type Database = ReturnType<typeof getPrismaClient>;

/** Frozen d964cb2 route queries; do not call the new adapters/shared formatter.
 * In particular DELETE deliberately remains two statements, not a new transaction.
 * HTTP parsing/admin auth/request audit are tested by the separate handler suite.
 */
async function originalLookup(db: Database, processSeq: number) {
  const course = await db.course.findUnique({ where: { processSeq }, select: {
    id: true, processSeq: true, name: true, company: { select: { name: true } },
    sessions: { where: { deletedAt: null }, select: { id: true } }
  } });
  return course ? { courseRecordId: course.id, processId: `PRC-${String(course.processSeq).padStart(6, "0")}`, companyName: course.company.name, courseName: course.name, activeSessionCount: course.sessions.length } : null;
}
async function originalDelete(db: Database, courseId: string, deletedBy: string | null) {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return null;
  const result = await db.operationSession.updateMany({ where: { courseRecordId: courseId, deletedAt: null }, data: { deletedAt: new Date(), deletedBy } });
  return result.count;
}

/** Separate fixed IDs let original PG, new PG and Mongo run independently.
 * Only this known ID mapping is normalized in the ORIGINAL-vs-adapter comparison.
 * New PG-vs-Mongo IDs and DTOs are compared exactly.
 */
function fixture(base: number) {
  const data = new Map<string, MongoRow[]>();
  const add = (model: string, values: MongoRow) => data.set(model, [...(data.get(model) ?? []), coachFixtureRow(model, values)]);
  const company = id(base), mixed = id(base + 1), deleted = id(base + 2), empty = id(base + 3), nullActor = id(base + 4), other = id(base + 5);
  add("Company", { id: company, name: "Synthetic course company", normalizedName: `synthetic-course-company-${base}`, createdAt: originalDate, updatedAt: originalDate });
  for (const [offset, name] of [[1, "Mixed"], [2, "All deleted"], [3, "Empty"], [4, "Null actor"], [5, "Unrelated"]] as const) {
    // All courses intentionally share the external courseId; only record UUID scopes deletion.
    add("Course", { id: id(base + offset), companyId: company, processSeq: base + offset, courseId: "SYNTHETIC-SHARED-EXTERNAL-ID", name, createdAt: originalDate, updatedAt: originalDate });
  }
  add("CourseIdLabel", { id: id(base + 10), companyId: company, courseId: "SYNTHETIC-SHARED-EXTERNAL-ID", label: "Synthetic label stays", createdAt: originalDate, updatedAt: originalDate });
  for (const [offset, courseRecordId, deletedAt] of [[20, mixed, null], [21, mixed, null], [22, mixed, oldDeletion], [23, deleted, oldDeletion], [24, nullActor, null], [25, other, null]] as const) {
    add("OperationSession", { id: id(base + offset), operationId: `SYNTHETIC-OP-${base + offset}`, courseRecordId,
      startDate: originalDate, endDate: originalDate, educationDates: [originalDate], createdAt: originalDate, updatedAt: originalDate,
      deletedAt, deletedBy: deletedAt || offset === 24 ? "synthetic-prior@example.invalid" : null,
      omName: "Synthetic Private Owner", specialNotes: "Synthetic private session note", totalCost: "123.45" });
  }
  add("DataImportRun", { id: id(base + 30), sourceType: "synthetic", sourceName: "Synthetic private source" });
  add("OperationSourceRecord", { id: id(base + 31), importRunId: id(base + 30), operationSessionId: id(base + 20), sourceWorkbook: "Synthetic private workbook", sourceSheet: "Synthetic sheet", sourceRowNumber: 1, rowSnapshot: { synthetic: "private-source-value" } });
  add("Coach", { id: id(base + 40), sourceCoachId: `synthetic-related-${base}`, name: "Synthetic related coach" });
  add("CoachEngagement", { id: id(base + 41), sourceEngagementId: `synthetic-related-engagement-${base}`, coachId: id(base + 40), operationSessionId: id(base + 20), courseName: "Synthetic retained engagement", startDate: originalDate, endDate: originalDate });
  return { base, data, mixed, deleted, empty, nullActor, other };
}
const expectedLookup = (base: number, offset: number, name: string, count: number) => ({ courseRecordId: id(base + offset), processId: `PRC-${String(base + offset).padStart(6, "0")}`, companyName: "Synthetic course company", courseName: name, activeSessionCount: count });

/** Explicit env-i disposable endpoints only. Reset is confined to this exact PG DB
 * and verified synthetic user. Never loads .env or shuts down shared processes.
 */
test("course admin: original two-query PG behavior, privacy/audit and native Mongo parity", { skip: !pgUrl || !mongoUri, timeout: 180_000 }, async suite => {
  const p = new URL(pgUrl!), m = new URL(mongoUri!);
  assert.ok(["postgres:", "postgresql:"].includes(p.protocol)); assert.equal(p.hostname, "127.0.0.1");
  assert.equal(p.username, "synthetic"); assert.equal(p.password, ""); assert.ok(p.port);
  assert.equal(p.pathname, "/course_admin_parity"); assert.equal(p.search, ""); assert.equal(p.hash, "");
  assert.equal(m.protocol, "mongodb:"); assert.equal(m.hostname, "127.0.0.1"); assert.ok(m.port);
  assert.equal(m.username, ""); assert.equal(m.password, ""); assert.equal(m.pathname, "/"); assert.equal(m.hash, "");
  assert.deepEqual([...m.searchParams.keys()], ["replicaSet"]); assert.ok(m.searchParams.get("replicaSet"));
  const names = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: pgUrl, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: pgUrl });
  const client = new MongoClient(mongoUri!, { serverSelectionTimeoutMS: 5000 });
  const namespace = `shadow_course_admin_pg_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName: "hub_om_shadow_course_admin_parity", namespace, allowShadowWrites: true as const };
  let db: Database | undefined, pgConnected = false, mongoConnected = false;
  try {
    await sql.connect(); pgConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0], { db: "course_admin_parity", usr: "synthetic" });
    await client.connect(); mongoConnected = true;
    const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.isWritablePrimary, true); assert.equal(hello.setName, m.searchParams.get("replicaSet"));
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations");
    const migrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrations.length, 45);
    for (const migration of migrations) await sql.query(readFileSync(path.join(root, migration, "migration.sql"), "utf8"));
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    db = getPrismaClient(); const pgDb = db;
    await prepareMongoCourseAdminStore(options);
    // Extra relations belong only to the fixture, not the course-admin adapter contract.
    await prepareMongoReadStore(options, models.filter(model => !["Company", "Course", "OperationSession", "ActivityChange"].includes(model)));
    const store = new MongoOperationStore(options, models);
    const repository = new PrismaCourseAdminRepository(), mongo = await MongoCourseAdminRepository.open(options);
    const original = fixture(1000), adapter = fixture(2000);
    const delegates = pgDb as unknown as Record<string, { createMany(args: { data: MongoRow[] }): Promise<unknown> }>;
    for (const set of [original, adapter]) for (const [model, rows] of set.data) {
      const pgRows = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === MongoDbNull ? Prisma.DbNull : value === MongoJsonNull ? Prisma.JsonNull : value])));
      await delegates[model[0].toLowerCase() + model.slice(1)].createMany({ data: pgRows });
      if (set === adapter) await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    }
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const snapshot = async () => {
      const result: Record<string, string> = {};
      for (const table of tables) result[`pg:${table}`] = hash((await sql.query(`SELECT row_to_json(t) FROM ${table} t ORDER BY id`)).rows);
      const collections = await store.db.listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray();
      for (const { name } of collections) result[`mongo:${name}`] = hash(await store.db.collection(name).find({}).sort({ _id: 1 }).toArray());
      return result;
    };
    const immutableRelations = (state: Record<string, string>) => Object.fromEntries(Object.entries(state).filter(([key]) => !key.endsWith("operation_sessions") && !key.endsWith("activity_changes") && !key.endsWith("_OperationSession") && !key.endsWith("_ActivityChange")));
    const beforeAll = await snapshot();
    const rawPgSession = async (sessionId: string) => (await sql.query("SELECT row_to_json(t) AS row FROM operation_sessions t WHERE id = $1", [sessionId])).rows[0].row as Record<string, unknown>;
    const unrelatedPg = await rawPgSession(id(2025));
    const priorDeletedPg = await rawPgSession(id(2022));
    const unrelatedMongo = await store.collection("OperationSession").findOne({ _id: id(2025) });
    const priorDeletedMongo = await store.collection("OperationSession").findOne({ _id: id(2022) });
    const actor: ActivityContext = { requestId: id(9000), route: "/api/admin/courses/[courseId]", method: "DELETE", actorEmail: "synthetic-admin@example.invalid", actorName: "Synthetic private admin", actorType: "user" };
    const nullActor: ActivityContext = { ...actor, requestId: id(9001), actorEmail: null, actorName: null };
    console.log(`[course-admin-pg] migrations=${migrations.length} baseline=d964cb2 original=two-statements`);

    await suite.test("lookup DTO: active-only count, all-deleted/empty still found, absent process null, reads unchanged", async () => {
      for (const [offset, name, count] of [[1, "Mixed", 2], [2, "All deleted", 0], [3, "Empty", 0], [4, "Null actor", 1], [5, "Unrelated", 1]] as const) {
        assert.deepEqual(await originalLookup(pgDb, 1000 + offset), expectedLookup(1000, offset, name, count));
        const expected = expectedLookup(2000, offset, name, count);
        assert.deepEqual(await originalLookup(pgDb, 2000 + offset), expected);
        assert.deepEqual(await repository.findCourse(2000 + offset), expected);
        assert.deepEqual(await mongo.findCourse(2000 + offset), expected);
      }
      for (const missingSeq of [0, -1, -2147483648, 2147483647]) {
        assert.equal(await originalLookup(pgDb, missingSeq), null);
        assert.equal(await repository.findCourse(missingSeq), null);
        assert.equal(await mongo.findCourse(missingSeq), null);
      }
      assert.deepEqual(await snapshot(), beforeAll);
    });
    await suite.test("PG Int overflow remains an error; compact/braced UUIDs resolve the same existing course", async () => {
      const before = await snapshot();
      for (const seq of [2147483648, -2147483649]) {
        // Infinity is rejected by the route parser; these integers reach the DB.
        await assert.rejects(originalLookup(pgDb, seq));
        await assert.rejects(repository.findCourse(seq));
        await assert.rejects(mongo.findCourse(seq));
      }
      const forms = (value: string) => [value.toUpperCase(), value.replaceAll("-", ""), `{${value}}`, `{${value.toUpperCase()}}`, value.replaceAll("-", "").match(/.{4}/g)!.join("-")];
      for (let index = 0; index < forms(original.empty).length; index++) {
        assert.equal(await originalDelete(pgDb, forms(original.empty)[index], null), 0);
        assert.equal(await repository.softDeleteCourseSessions(forms(adapter.empty)[index], null), 0);
        assert.equal(await mongo.softDeleteCourseSessions(forms(adapter.empty)[index], null), 0);
      }
      for (const invalid of ["invalid-synthetic-uuid", ` ${adapter.empty}`, `${adapter.empty} `, `{${adapter.empty}`, `${adapter.empty}-`]) {
        await assert.rejects(originalDelete(pgDb, invalid, null));
        await assert.rejects(repository.softDeleteCourseSessions(invalid, null));
        await assert.rejects(mongo.softDeleteCourseSessions(invalid, null));
      }
      assert.deepEqual(await snapshot(), before);
    });
    await suite.test("uppercase UUID deletes exactly active sessions; fixed audit semantics and raw unrelated fields preserved", async () => {
      const beforePg = await rawPgSession(id(2020));
      const beforeMongo = await store.collection("OperationSession").findOne({ _id: id(2020) }); assert.ok(beforeMongo);
      const started = Date.now();
      assert.equal(await activityContext.run(actor, () => originalDelete(pgDb, original.mixed.toUpperCase(), actor.actorEmail)), 2);
      assert.equal(await activityContext.run(actor, () => repository.softDeleteCourseSessions(adapter.mixed.toUpperCase(), actor.actorEmail)), 2);
      assert.equal(await activityContext.run(actor, () => mongo.softDeleteCourseSessions(adapter.mixed.toUpperCase(), actor.actorEmail)), 2);
      const finished = Date.now();
      for (const base of [1000, 2000]) for (const offset of [20, 21]) {
        const row = await pgDb.operationSession.findUniqueOrThrow({ where: { id: id(base + offset) } });
        assert.equal(row.deletedBy, actor.actorEmail); assert.ok(row.deletedAt);
        assert.ok(row.deletedAt.getTime() >= started && row.deletedAt.getTime() <= finished);
      }
      for (const offset of [20, 21]) {
        const row = await store.one("OperationSession", { _id: id(2000 + offset) }); assert.ok(row);
        assert.equal(row.deletedBy, actor.actorEmail); assert.ok(row.deletedAt instanceof Date);
        assert.ok(row.deletedAt.getTime() >= started && row.deletedAt.getTime() <= finished);
      }
      const strip = (row: Record<string, unknown>, excluded: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.includes(key)));
      assert.deepEqual(strip(await rawPgSession(id(2020)), ["deleted_at", "deleted_by", "deleted_by_pii_index", "updated_at"]), strip(beforePg, ["deleted_at", "deleted_by", "deleted_by_pii_index", "updated_at"]));
      const afterMongo = await store.collection("OperationSession").findOne({ _id: id(2020) }); assert.ok(afterMongo);
      assert.deepEqual(strip(afterMongo, ["deletedAt", "deletedBy", "deletedByPiiIndex", "updatedAt"]), strip(beforeMongo, ["deletedAt", "deletedBy", "deletedByPiiIndex", "updatedAt"]));
      assert.deepEqual(await repository.findCourse(2001), expectedLookup(2000, 1, "Mixed", 0));
      assert.deepEqual(await mongo.findCourse(2001), expectedLookup(2000, 1, "Mixed", 0));
    });
    await suite.test("reapply/all-deleted/empty return zero; missing UUID returns null; no audit/timestamp/ciphertext churn", async () => {
      const before = await snapshot();
      for (const [originalId, adapterId, expected] of [[original.mixed, adapter.mixed, 0], [original.deleted, adapter.deleted, 0], [original.empty, adapter.empty, 0], [id(99998), id(99999), null]] as const) {
        assert.equal(await activityContext.run(actor, () => originalDelete(pgDb, originalId, "synthetic-retry@example.invalid")), expected);
        assert.equal(await activityContext.run(actor, () => repository.softDeleteCourseSessions(adapterId, "synthetic-retry@example.invalid")), expected);
        assert.equal(await activityContext.run(actor, () => mongo.softDeleteCourseSessions(adapterId, "synthetic-retry@example.invalid")), expected);
      }
      assert.deepEqual(await snapshot(), before);
    });
    await suite.test("null email remains null and clears an old deletedBy/index; all relations and previous deletions survive", async () => {
      assert.equal(await activityContext.run(nullActor, () => originalDelete(pgDb, original.nullActor, null)), 1);
      assert.equal(await activityContext.run(nullActor, () => repository.softDeleteCourseSessions(adapter.nullActor, null)), 1);
      assert.equal(await activityContext.run(nullActor, () => mongo.softDeleteCourseSessions(adapter.nullActor, null)), 1);
      const pgRow = await pgDb.operationSession.findUniqueOrThrow({ where: { id: id(2024) } });
      assert.equal(pgRow.deletedBy, null); assert.ok(pgRow.deletedAt);
      const rawPg = await rawPgSession(id(2024)); assert.equal(rawPg.deleted_by, null); assert.equal(rawPg.deleted_by_pii_index, null);
      const rawMongo = await store.collection("OperationSession").findOne({ _id: id(2024) }); assert.ok(rawMongo);
      assert.equal(rawMongo.deletedBy, null); assert.equal(rawMongo.deletedByPiiIndex, null); assert.ok(rawMongo.deletedAt);
      assert.deepEqual(await rawPgSession(id(2025)), unrelatedPg); assert.deepEqual(await rawPgSession(id(2022)), priorDeletedPg);
      assert.deepEqual(await store.collection("OperationSession").findOne({ _id: id(2025) }), unrelatedMongo);
      assert.deepEqual(await store.collection("OperationSession").findOne({ _id: id(2022) }), priorDeletedMongo);
      assert.deepEqual(immutableRelations(await snapshot()), immutableRelations(beforeAll));
    });
    await suite.test("real PG trigger and Mongo audit agree; actor/deletedBy/private relation data are encrypted at rest", async () => {
      const pgAudits = await pgDb.activityChange.findMany();
      const mongoAudits = (await store.collection("ActivityChange").find({}).toArray()).map(row => decodeMongoRuntimeDocument("ActivityChange", row));
      assert.equal(pgAudits.length, 6); assert.equal(mongoAudits.length, 3);
      for (const [audits, base] of [[pgAudits.filter(row => [id(1020), id(1021), id(1024)].includes(row.targetId)), 1000], [pgAudits.filter(row => [id(2020), id(2021), id(2024)].includes(row.targetId)), 2000], [mongoAudits, 2000]] as const) {
        assert.equal(audits.length, 3);
        assert.deepEqual(audits.map(row => row.targetId).sort(), [id(base + 20), id(base + 21), id(base + 24)]);
        for (const row of audits) {
          const context = row.targetId === id(base + 24) ? nullActor : actor;
          assert.equal(row.action, "delete"); assert.equal(row.targetType, "operation_sessions");
          assert.equal(row.requestId, context.requestId); assert.equal(row.actorEmail, context.actorEmail); assert.equal(row.actorName, context.actorName);
          assert.equal(row.actorType, context.actorType); assert.equal(row.route, context.route); assert.equal(row.method, context.method);
          assert.deepEqual(row.changes, { deleted_at: { redacted: true } });
        }
      }
      const rawPg = await rawPgSession(id(2020));
      const rawMongo = await store.collection("OperationSession").findOne({ _id: id(2020) }); assert.ok(rawMongo);
      assert.ok(isEncrypted(rawPg.deleted_by)); assert.ok(isEncrypted(rawMongo.deletedBy));
      assert.equal(rawMongo.deletedByPiiIndex, mongoRuntimeBlindIndex("OperationSession", "deletedBy", actor.actorEmail));
      const plaintext = [actor.actorEmail!, actor.actorName!, "synthetic-prior@example.invalid", "Synthetic Private Owner", "Synthetic private session note", "Synthetic private workbook", "private-source-value"];
      for (const table of ["operation_sessions", "operation_source_records", "activity_changes"]) {
        const raw = JSON.stringify((await sql.query(`SELECT row_to_json(t) FROM ${table} t`)).rows);
        for (const value of plaintext) assert.equal(raw.includes(value), false, `${table} raw must not expose private values`);
      }
      for (const model of ["OperationSession", "OperationSourceRecord", "ActivityChange"]) {
        const raw = JSON.stringify(await store.collection(model).find({}).toArray());
        for (const value of plaintext) assert.equal(raw.includes(value), false, `${model} raw must not expose private values`);
      }
    });
  } finally {
    try { if (db) await db.$disconnect(); }
    finally {
      try { if (pgConnected) await sql.end(); }
      finally {
        try {
          if (mongoConnected) {
            assert.match(namespace, /^shadow_course_admin_pg_[a-f0-9]{16}$/);
            const owned = await client.db(options.databaseName).listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray();
            for (const collection of owned) { assert.ok(collection.name.startsWith(`${namespace}_`)); await client.db(options.databaseName).collection(collection.name).drop(); }
          }
        } finally { await client.close(); for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
      }
    }
  }
});
