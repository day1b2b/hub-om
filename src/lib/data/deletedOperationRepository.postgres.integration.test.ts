import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "@prisma/client";
import { MongoClient } from "mongodb";
import pg from "pg";
import { activityContext } from "../activity/context";
import { isEncrypted } from "../privacy/crypto";
import { getPrismaClient } from "./prisma";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { PrismaDeletedOperationRepository } from "./prismaDeletedOperationRepository";
import { MongoDeletedOperationRepository, prepareMongoDeletedOperationStore, DELETED_OPERATION_MODELS } from "./mongoDeletedOperationRepository";

const pgUrl = process.env.DELETED_OPERATION_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_DELETED_OPERATION_TEST_URI;
const id = (n: number) => `de1e7ed0-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (n: number) => new Date(`2099-01-${String(n).padStart(2, "0")}T00:00:00.000Z`);
const models = ["Company", "Course", "CourseIdLabel", "OperationSession", "DataImportRun", "OperationSourceRecord", "Coach", "CoachEngagement", "ActivityChange"] as const;
const tables = ["companies", "courses", "course_id_labels", "operation_sessions", "data_import_runs", "operation_source_records", "coaches", "coach_engagements", "activity_changes"] as const;
type Database = ReturnType<typeof getPrismaClient>;
type DeletedDTO = { operationId: string; companyName: string; courseName: string; roundNo: string | null; startDate: string; endDate: string; deletedAt: string | null; deletedBy: string | null };
type Repository = { listDeletedOperations(): Promise<DeletedDTO[]>; restoreOperation(operationId: string): Promise<{ operationId: string }> };

/** Frozen b401626 GET/PUT queries, independent of the new adapters and DTO helpers.
 * Route parsing, admin authorization and request audit belong to the handler suite.
 */
async function originalList(db: Database): Promise<DeletedDTO[]> {
  const sessions = await db.operationSession.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" }, include: { course: { include: { company: true } } } });
  return sessions.map(session => ({ operationId: session.operationId, companyName: session.course.company.name, courseName: session.course.name,
    roundNo: session.roundNo, startDate: session.startDate.toISOString().slice(0, 10), endDate: session.endDate.toISOString().slice(0, 10),
    deletedAt: session.deletedAt?.toISOString() ?? null, deletedBy: session.deletedBy }));
}
function originalRestore(db: Database, operationId: string) {
  return db.operationSession.update({ where: { operationId }, data: { deletedAt: null, deletedBy: null }, select: { operationId: true } });
}

// Fixed DTOs are not derived from the fixture, repository or baseline implementation.
const dto = (operationId: string, deletedAt: string, roundNo: string | null, deletedBy: string | null): DeletedDTO => ({ operationId,
  companyName: "Synthetic retained company", courseName: "Synthetic retained course", roundNo,
  startDate: "2099-01-01", endDate: "2099-01-02", deletedAt, deletedBy });
const priorActor = "synthetic-prior-deleter@example.invalid";
const expectedInitial: DeletedDTO[] = [
  dto("Case-ID", "2099-01-09T00:00:00.000Z", "1", priorActor),
  dto("case-id", "2099-01-08T00:00:00.000Z", "", null),
  dto(" Case-ID ", "2099-01-07T00:00:00.000Z", null, priorActor),
  dto("", "2099-01-06T00:00:00.000Z", "4", priorActor),
  dto(" ", "2099-01-05T00:00:00.000Z", "5", priorActor),
  dto("tie-A", "2099-01-04T00:00:00.000Z", "6", priorActor),
  dto("tie-B", "2099-01-04T00:00:00.000Z", "7", priorActor)
];
const operationIds = ["Case-ID", "case-id", " Case-ID ", "", " ", "tie-A", "tie-B", "live", "live-stale-deleter"];
function fixture() {
  const data = new Map<string, MongoRow[]>();
  const add = (model: string, values: MongoRow) => data.set(model, [...(data.get(model) ?? []), coachFixtureRow(model, values)]);
  add("Company", { id: id(1), name: "Synthetic retained company", normalizedName: "synthetic-retained-company", updatedAt: day(1) });
  add("Course", { id: id(2), companyId: id(1), processSeq: 533, courseId: "SYNTHETIC-COURSE", name: "Synthetic retained course", updatedAt: day(1) });
  add("CourseIdLabel", { id: id(3), companyId: id(1), courseId: "SYNTHETIC-COURSE", label: "Synthetic retained label" });
  const dates = [9, 8, 7, 6, 5, 4, 4, null, null];
  for (let index = 0; index < operationIds.length; index++) add("OperationSession", {
    id: id(20 + index), operationId: operationIds[index], courseRecordId: id(2), startDate: day(1), endDate: day(2), educationDates: [day(1), day(2)],
    roundNo: index === 1 ? "" : index === 2 ? null : String(index + 1),
    deletedAt: dates[index] === null ? null : day(dates[index]!), deletedBy: index === 1 || index === 7 ? null : priorActor,
    createdAt: day(1), updatedAt: day(1), omName: "Synthetic private owner", specialNotes: "Synthetic private session note", totalCost: "123.45"
  });
  add("DataImportRun", { id: id(30), sourceType: "synthetic", sourceName: "Synthetic private source" });
  add("OperationSourceRecord", { id: id(31), importRunId: id(30), operationSessionId: id(20), sourceWorkbook: "Synthetic private workbook", sourceSheet: "Synthetic sheet", sourceRowNumber: 1, rowSnapshot: { synthetic: "private-source-value" } });
  add("Coach", { id: id(40), sourceCoachId: "synthetic-related-coach", name: "Synthetic related coach" });
  add("CoachEngagement", { id: id(41), sourceEngagementId: "synthetic-related-engagement", coachId: id(40), operationSessionId: id(20), courseName: "Synthetic retained engagement", startDate: day(1), endDate: day(2) });
  return data;
}

/** Validate descending order BEFORE normalizing members within equal-date blocks.
 * PG does not specify a tie-break; neither input order nor operationId is a new contract.
 */
function canonical(rows: DeletedDTO[]) {
  const blocks: DeletedDTO[][] = [];
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["operationId", "companyName", "courseName", "roundNo", "startDate", "endDate", "deletedAt", "deletedBy"].sort());
    assert.ok(row.deletedAt);
    const previous = blocks.at(-1);
    if (previous) assert.ok(previous[0].deletedAt! >= row.deletedAt, "deletedAt must descend");
    if (previous?.[0].deletedAt === row.deletedAt) previous.push(row); else blocks.push([row]);
  }
  return blocks.flatMap(block => [...block].sort((a, b) => a.operationId.localeCompare(b.operationId)));
}

// Only the exact disposable PG DB may be reset. No .env loading or server shutdown.
// Each backend runs the same scenario from a fresh fixture, preserving literal IDs.
// The original and new PG adapters run sequentially; Mongo owns a random namespace.
test("deleted operations: original PG query parity with new PG/native Mongo, privacy, audit and restoration", { skip: !pgUrl || !mongoUri, timeout: 180_000 }, async suite => {
  const p = new URL(pgUrl!), m = new URL(mongoUri!);
  assert.ok(["postgres:", "postgresql:"].includes(p.protocol)); assert.equal(p.hostname, "127.0.0.1"); assert.equal(p.username, "synthetic");
  assert.equal(p.password, ""); assert.ok(p.port); assert.equal(p.pathname, "/deleted_operation_parity"); assert.equal(p.search, ""); assert.equal(p.hash, "");
  assert.equal(m.protocol, "mongodb:"); assert.equal(m.hostname, "127.0.0.1"); assert.ok(m.port); assert.equal(m.username, ""); assert.equal(m.password, "");
  assert.equal(m.pathname, "/"); assert.equal(m.hash, ""); assert.deepEqual([...m.searchParams.keys()], ["replicaSet"]); assert.ok(m.searchParams.get("replicaSet"));
  const names = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: pgUrl, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: pgUrl });
  const client = new MongoClient(mongoUri!, { serverSelectionTimeoutMS: 5000 });
  const namespace = `shadow_deleted_pg_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName: "hub_om_shadow_deleted_operation_parity", namespace, allowShadowWrites: true as const };
  let db: Database | undefined, pgConnected = false, mongoConnected = false;
  try {
    await sql.connect(); pgConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0], { db: "deleted_operation_parity", usr: "synthetic" });
    await client.connect(); mongoConnected = true;
    const hello = await client.db("admin").command({ hello: 1 }); assert.equal(hello.isWritablePrimary, true); assert.equal(hello.setName, m.searchParams.get("replicaSet"));
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations");
    const migrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrations.length, 45);
    for (const migration of migrations) await sql.query(readFileSync(path.join(root, migration, "migration.sql"), "utf8"));
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    db = getPrismaClient(); const pgDb = db;
    await prepareMongoDeletedOperationStore(options);
    await prepareMongoReadStore(options, models.filter(model => !(DELETED_OPERATION_MODELS as readonly string[]).includes(model)));
    const store = new MongoOperationStore(options, models);
    const mongo = await MongoDeletedOperationRepository.open(options);
    const data = fixture();
    const delegates = pgDb as unknown as Record<string, { createMany(args: { data: MongoRow[] }): Promise<unknown> }>;
    const seedPg = async () => {
      // No other suite shares this named disposable database. Retain migrations/triggers.
      await sql.query(`TRUNCATE ${tables.join(", ")} CASCADE`);
      for (const [model, rows] of data) {
        const pgRows = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === MongoDbNull ? Prisma.DbNull : value === MongoJsonNull ? Prisma.JsonNull : value])));
        await delegates[model[0].toLowerCase() + model.slice(1)].createMany({ data: pgRows });
      }
    };
    for (const [model, rows] of data) await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    const actor = { requestId: id(9000), route: "/api/admin/deleted-operations", method: "PUT", actorEmail: "synthetic-restorer@example.invalid", actorName: "Synthetic private restorer", actorType: "user" as const };
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const rawPg = async (table: string) => (await sql.query(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY id`)).rows.map(entry => entry.row as MongoRow);
    const summaries: unknown[] = [];
    console.log(`[deleted-operations-pg] migrations=${migrations.length} baseline=b401626 fixtureSessions=9`);
    for (const backend of ["original PG", "new PG", "native Mongo"] as const) await suite.test(backend, async () => {
      const isMongo = backend === "native Mongo";
      if (!isMongo) await seedPg();
      const repo: Repository = isMongo ? mongo : backend === "new PG" ? new PrismaDeletedOperationRepository() : {
        listDeletedOperations: () => originalList(pgDb), restoreOperation: operationId => originalRestore(pgDb, operationId)
      };
      const snapshot = async () => {
        const result: Record<string, string> = {};
        for (let index = 0; index < models.length; index++) result[models[index]] = hash(isMongo ? await store.collection(models[index]).find({}).sort({ _id: 1 }).toArray() : await rawPg(tables[index]));
        return result;
      };
      const sessionRaw = async (n: number): Promise<MongoRow> => {
        if (isMongo) { const row = await store.collection("OperationSession").findOne({ _id: id(n) }); assert.ok(row); return row; }
        const row = (await sql.query("SELECT row_to_json(t) AS row FROM operation_sessions t WHERE id=$1", [id(n)])).rows[0]?.row;
        assert.ok(row); return row;
      };
      const logical = async (n: number): Promise<MongoRow> => isMongo ? (await store.one("OperationSession", { _id: id(n) }))! : await pgDb.operationSession.findUniqueOrThrow({ where: { id: id(n) } });
      const audits = async (): Promise<MongoRow[]> => isMongo ? (await store.collection("ActivityChange").find({}).toArray()).map(row => decodeMongoRuntimeDocument("ActivityChange", row)) : await pgDb.activityChange.findMany();
      const unrelated = (row: MongoRow) => Object.fromEntries(Object.entries(row).filter(([key]) => !(isMongo ? ["deletedAt", "deletedBy", "deletedByPiiIndex", "updatedAt"] : ["deleted_at", "deleted_by", "deleted_by_pii_index", "updated_at"]).includes(key)));
      const before = await snapshot();
      assert.deepEqual(canonical(await repo.listDeletedOperations()), canonical(expectedInitial));
      assert.deepEqual(await snapshot(), before, "list must not mutate any source/audit row");
      const rawBefore = await sessionRaw(20);
      assert.ok(isEncrypted(rawBefore[isMongo ? "deletedBy" : "deleted_by"]));
      const secrets = [priorActor, actor.actorEmail, actor.actorName, "Synthetic private owner", "Synthetic private session note", "Synthetic private workbook", "private-source-value"];
      const assertRawPrivacy = async () => {
        for (const [model, table] of [["OperationSession", "operation_sessions"], ["OperationSourceRecord", "operation_source_records"], ["ActivityChange", "activity_changes"]]) {
          const raw = JSON.stringify(isMongo ? await store.collection(model).find({}).toArray() : await rawPg(table));
          for (const secret of secrets) assert.equal(raw.includes(secret), false, `${backend} ${model} must not expose private values`);
        }
      };
      await assertRawPrivacy();
      // Missing exact strings are errors, not null/success; similar existing IDs stay intact.
      for (const missing of ["CASE-ID", "Case-ID ", "  ", "missing-operation"]) await assert.rejects(activityContext.run(actor, () => repo.restoreOperation(missing)));
      assert.deepEqual(await snapshot(), before);
      const results: Array<{ operationId: string }> = [];
      const remaining = [...expectedInitial];
      for (let index = 0; index < 7; index++) {
        const operationId = operationIds[index], recordId = 20 + index;
        const allBefore = await Promise.all(operationIds.map((_, offset) => sessionRaw(20 + offset)));
        const old = await logical(recordId), started = Date.now();
        const result = await activityContext.run(actor, () => repo.restoreOperation(operationId));
        assert.deepEqual(result, { operationId }); results.push(result);
        const row = await logical(recordId), raw = await sessionRaw(recordId);
        assert.equal(row.deletedAt, null); assert.equal(row.deletedBy, null);
        assert.equal(raw[isMongo ? "deletedByPiiIndex" : "deleted_by_pii_index"], null);
        assert.ok(row.updatedAt instanceof Date); assert.notEqual(row.updatedAt.getTime(), (old.updatedAt as Date).getTime());
        assert.ok(row.updatedAt.getTime() >= started && row.updatedAt.getTime() <= Date.now());
        assert.deepEqual(unrelated(raw), unrelated(allBefore[index]), "restore changes only deletion fields and updatedAt, including raw ciphertext");
        for (let offset = 0; offset < operationIds.length; offset++) if (offset !== index) assert.deepEqual(await sessionRaw(20 + offset), allBefore[offset], "exact-text ID must not touch neighboring IDs");
        remaining.splice(remaining.findIndex(entry => entry.operationId === operationId), 1);
        assert.deepEqual(canonical(await repo.listDeletedOperations()), canonical(remaining));
        assert.equal((await audits()).length, index + 1);
      }
      assert.deepEqual(await repo.listDeletedOperations(), []);
      const expectedAudits = operationIds.slice(0, 7).map((_, index) => ({ ...actor, targetType: "operation_sessions", targetId: id(20 + index), action: "restore", changes: { deleted_at: { redacted: true } } }));
      const normalizeAudits = (rows: MongoRow[]) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "occurredAt", "actorEmailPiiIndex", "actorNamePiiIndex"].includes(key)))).sort((a, b) => String(a.targetId).localeCompare(String(b.targetId)));
      assert.deepEqual(normalizeAudits(await audits()), expectedAudits);
      const auditBeforeRepeat = (await snapshot()).ActivityChange;
      // An already-live row can retain a stale actor. PG explicitly excludes
      // deleted_by from logical change audit even when clearing its private index.
      const staleBefore = await sessionRaw(28), staleLogical = await logical(28);
      assert.equal(staleLogical.deletedAt, null); assert.equal(staleLogical.deletedBy, priorActor);
      assert.ok(staleBefore[isMongo ? "deletedByPiiIndex" : "deleted_by_pii_index"]);
      const staleStarted = Date.now();
      assert.deepEqual(await activityContext.run(actor, () => repo.restoreOperation("live-stale-deleter")), { operationId: "live-stale-deleter" });
      const staleAfter = await sessionRaw(28), staleCleared = await logical(28);
      assert.equal(staleCleared.deletedAt, null); assert.equal(staleCleared.deletedBy, null);
      assert.equal(staleAfter[isMongo ? "deletedByPiiIndex" : "deleted_by_pii_index"], null);
      assert.ok(staleCleared.updatedAt instanceof Date);
      assert.notEqual(staleCleared.updatedAt.getTime(), (staleLogical.updatedAt as Date).getTime());
      assert.ok(staleCleared.updatedAt.getTime() >= staleStarted && staleCleared.updatedAt.getTime() <= Date.now());
      assert.deepEqual(unrelated(staleAfter), unrelated(staleBefore));
      assert.equal((await snapshot()).ActivityChange, auditBeforeRepeat, "clearing only a stale deletedBy has no PG logical audit");
      // Ensure the wall clock crosses millisecond resolution; not a throughput assertion.
      for (const recordId of [20, 27, 28, 20, 27]) {
        const old = await logical(recordId), raw = await sessionRaw(recordId);
        await delay(15);
        const started = Date.now();
        assert.deepEqual(await activityContext.run(actor, () => repo.restoreOperation(operationIds[recordId - 20])), { operationId: operationIds[recordId - 20] });
        const row = await logical(recordId);
        assert.ok(row.updatedAt instanceof Date); assert.notEqual(row.updatedAt.getTime(), (old.updatedAt as Date).getTime());
        assert.ok(row.updatedAt.getTime() >= started && row.updatedAt.getTime() <= Date.now());
        assert.equal(row.deletedAt, null); assert.equal(row.deletedBy, null);
        const next = await sessionRaw(recordId);
        const withoutTime = (value: MongoRow) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== (isMongo ? "updatedAt" : "updated_at")));
        assert.deepEqual(withoutTime(next), withoutTime(raw), "repeat/live updates timestamp only");
      }
      const after = await snapshot();
      assert.equal(after.ActivityChange, auditBeforeRepeat, "live/repeat has no logical-change audit");
      for (const model of models) if (model !== "OperationSession" && model !== "ActivityChange") assert.equal(after[model], before[model], `${model} relation unchanged`);
      await assertRawPrivacy();
      summaries.push({ results, audits: normalizeAudits(await audits()), finalList: await repo.listDeletedOperations() });
    });
    assert.equal(summaries.length, 3);
    assert.deepEqual(summaries[1], summaries[0]); assert.deepEqual(summaries[2], summaries[0]);
  } finally {
    try { if (db) await db.$disconnect(); }
    finally {
      try { if (pgConnected) await sql.end(); }
      finally {
        try {
          if (mongoConnected) {
            assert.match(namespace, /^shadow_deleted_pg_[a-f0-9]{16}$/);
            const owned = await client.db(options.databaseName).listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray();
            for (const collection of owned) { assert.ok(collection.name.startsWith(`${namespace}_`)); await client.db(options.databaseName).collection(collection.name).drop(); }
          }
        } finally { await client.close(); for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
      }
    }
  }
});
