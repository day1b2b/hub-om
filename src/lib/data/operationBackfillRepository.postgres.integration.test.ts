import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { MongoClient } from "mongodb";
import pg from "pg";
import { activityContext } from "../activity/context";
import { getPrismaClient } from "./prisma";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { PrismaOperationBackfillRepository } from "./prismaOperationBackfillRepository";
import { MongoOperationBackfillRepository, prepareMongoOperationBackfillStore, OPERATION_BACKFILL_MODELS } from "./mongoOperationBackfillRepository";

const pgUrl = process.env.OPERATION_BACKFILL_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_OPERATION_BACKFILL_TEST_URI;
const id = (n: number) => `bacf1111-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (n: number) => new Date(`2099-01-${String(n).padStart(2, "0")}T00:00:00.000Z`);
const models = ["Company", "Course", "CourseIdLabel", "OperationSession", "DataImportRun", "OperationSourceRecord", "Coach", "CoachEngagement", "ActivityChange"] as const;
const tables = ["companies", "courses", "course_id_labels", "operation_sessions", "data_import_runs", "operation_source_records", "coaches", "coach_engagements", "activity_changes"] as const;
type Database = ReturnType<typeof getPrismaClient>;
type Repository = {
  countOnsiteRequiredTargets(): Promise<number>; applyOnsiteRequiredBackfill(): Promise<number>;
  countOmAssignmentStatusTargets(): Promise<number>; applyOmAssignmentStatusBackfill(): Promise<number>;
};

/** Frozen 118e276 API queries, not the separate legacy CLI and not derive helpers. */
function originalRepository(db: Database): Repository {
  const onsiteWhere = { deletedAt: null, onsiteRequired: { not: "Y" as const } };
  const omWhere = { deletedAt: null, operationStatus: "ASSIGNMENT_NEEDED" as const, omName: { not: null, notIn: ["", "★배정필요", "배정필요"] } };
  return {
    countOnsiteRequiredTargets: () => db.operationSession.count({ where: onsiteWhere }),
    applyOnsiteRequiredBackfill: async () => (await db.operationSession.updateMany({ where: onsiteWhere, data: { onsiteRequired: "Y" } })).count,
    countOmAssignmentStatusTargets: () => db.operationSession.count({ where: omWhere }),
    applyOmAssignmentStatusBackfill: async () => (await db.operationSession.updateMany({ where: omWhere, data: { operationStatus: "ASSIGNMENT_PLANNED" } })).count
  };
}
// Expected membership is explicitly fixed, never computed by reproducing predicates.
const onsiteTargets = new Set([1, 2, 3, 5, 6, 7, 9, 10, 11, 12, 13, 15]);
const omTargets = new Set([5, 6, 7, 8, 15, 16]);
const cases = [
  [1, "N", "ASSIGNMENT_NEEDED", null], [2, "PARTIAL", "ASSIGNMENT_NEEDED", ""],
  [3, "UNKNOWN", "ASSIGNMENT_NEEDED", "★배정필요"], [4, "Y", "ASSIGNMENT_NEEDED", "배정필요"],
  [5, "N", "ASSIGNMENT_NEEDED", " "], [6, "PARTIAL", "ASSIGNMENT_NEEDED", " 배정필요 "],
  [7, "UNKNOWN", "ASSIGNMENT_NEEDED", " ★배정필요 "], [8, "Y", "ASSIGNMENT_NEEDED", "Synthetic assigned owner"],
  [9, "N", "ASSIGNMENT_PLANNED", "Synthetic planned owner"], [10, "PARTIAL", "ACTIVE", "Synthetic active owner"],
  [11, "UNKNOWN", "DONE", "Synthetic completed owner"], [12, "N", "RETROSPECTIVE_DONE", "Synthetic retrospective owner"],
  [13, "PARTIAL", "ARCHIVE_NEEDED", "Synthetic archived owner"], [14, "N", "ASSIGNMENT_NEEDED", "Synthetic deleted owner"],
  [15, "UNKNOWN", "ASSIGNMENT_NEEDED", "배정필요X"], [16, "Y", "ASSIGNMENT_NEEDED", "\t"]
] as const;
function fixture() {
  const data = new Map<string, MongoRow[]>();
  const add = (model: string, values: MongoRow) => data.set(model, [...(data.get(model) ?? []), coachFixtureRow(model, values)]);
  add("Company", { id: id(1000), name: "Synthetic preserved company", normalizedName: "synthetic-preserved-company" });
  add("Course", { id: id(1001), companyId: id(1000), processSeq: 533, courseId: "SYNTHETIC-COURSE", name: "Synthetic preserved course" });
  add("CourseIdLabel", { id: id(1002), companyId: id(1000), courseId: "SYNTHETIC-COURSE", label: "Synthetic preserved label" });
  for (const [n, onsiteRequired, operationStatus, omName] of cases) add("OperationSession", {
    id: id(n), operationId: `SYNTHETIC-BACKFILL-${n}`, courseRecordId: id(1001), onsiteRequired, operationStatus, omName,
    archiveStatus: n === 13 || n === 15 ? "DONE" : "NOT_READY", deletedAt: n === 14 ? day(2) : null,
    deletedBy: n === 14 ? "synthetic-deleter@example.invalid" : null,
    startDate: day(1), endDate: day(2), educationDates: [day(1), day(2)], createdAt: day(1), updatedAt: day(1),
    onsiteText: "Synthetic private onsite text must stay", updatedBy: "synthetic-last-editor@example.invalid",
    specialNotes: "Synthetic private session note", totalCost: "123.45"
  });
  add("DataImportRun", { id: id(1030), sourceType: "synthetic", sourceName: "Synthetic private source" });
  add("OperationSourceRecord", { id: id(1031), importRunId: id(1030), operationSessionId: id(5), sourceWorkbook: "Synthetic private workbook", sourceSheet: "Synthetic sheet", sourceRowNumber: 1, rowSnapshot: { synthetic: "private-source-value" } });
  add("Coach", { id: id(1040), sourceCoachId: "synthetic-related-coach", name: "Synthetic related coach" });
  add("CoachEngagement", { id: id(1041), sourceEngagementId: "synthetic-related-engagement", coachId: id(1040), operationSessionId: id(5), courseName: "Synthetic retained engagement", startDate: day(1), endDate: day(2) });
  return data;
}

/** Explicit env-i disposable endpoints only. Identical fixtures are reset before each
 * PG implementation; original queries, new PG and Mongo are checked independently.
 * No .env, schema changes, production access, process shutdown or helper-derived oracle.
 */
test("operation backfill: frozen PG queries/new PG/native Mongo parity, single-field updates and audit", { skip: !pgUrl || !mongoUri, timeout: 180_000 }, async suite => {
  const p = new URL(pgUrl!), m = new URL(mongoUri!);
  assert.ok(["postgres:", "postgresql:"].includes(p.protocol)); assert.equal(p.hostname, "127.0.0.1"); assert.equal(p.username, "synthetic");
  assert.equal(p.password, ""); assert.ok(p.port); assert.equal(p.pathname, "/operation_backfill_parity"); assert.equal(p.search, ""); assert.equal(p.hash, "");
  assert.equal(m.protocol, "mongodb:"); assert.equal(m.hostname, "127.0.0.1"); assert.ok(m.port); assert.equal(m.username, ""); assert.equal(m.password, "");
  assert.equal(m.pathname, "/"); assert.equal(m.hash, ""); assert.deepEqual([...m.searchParams.keys()], ["replicaSet"]); assert.ok(m.searchParams.get("replicaSet"));
  const names = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: pgUrl, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: pgUrl });
  const client = new MongoClient(mongoUri!, { serverSelectionTimeoutMS: 5000 });
  const namespace = `shadow_operation_backfill_pg_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName: "hub_om_shadow_operation_backfill_parity", namespace, allowShadowWrites: true as const };
  let db: Database | undefined, pgConnected = false, mongoConnected = false;
  try {
    await sql.connect(); pgConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0], { db: "operation_backfill_parity", usr: "synthetic" });
    await client.connect(); mongoConnected = true;
    const hello = await client.db("admin").command({ hello: 1 }); assert.equal(hello.isWritablePrimary, true); assert.equal(hello.setName, m.searchParams.get("replicaSet"));
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations");
    const migrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrations.length, 45);
    for (const migration of migrations) await sql.query(readFileSync(path.join(root, migration, "migration.sql"), "utf8"));
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    db = getPrismaClient(); const pgDb = db;
    await prepareMongoOperationBackfillStore(options);
    await prepareMongoReadStore(options, models.filter(model => !(OPERATION_BACKFILL_MODELS as readonly string[]).includes(model)));
    const store = new MongoOperationStore(options, models), mongo = await MongoOperationBackfillRepository.open(options);
    const data = fixture();
    const delegates = pgDb as unknown as Record<string, { createMany(args: { data: MongoRow[] }): Promise<unknown> }>;
    const seedPg = async () => {
      await sql.query(`TRUNCATE ${tables.join(", ")} CASCADE`);
      for (const [model, rows] of data) {
        const pgRows = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === MongoDbNull ? Prisma.DbNull : value === MongoJsonNull ? Prisma.JsonNull : value])));
        await delegates[model[0].toLowerCase() + model.slice(1)].createMany({ data: pgRows });
      }
    };
    for (const [model, rows] of data) await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    const actor = { requestId: id(9000), route: "/api/admin/onsite-required-backfill", method: "POST", actorEmail: "synthetic-admin@example.invalid", actorName: "Synthetic private admin", actorType: "user" as const };
    const omActor = { ...actor, requestId: id(9001), route: "/api/admin/om-assignment-status-backfill" };
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const rawPg = async (table: string) => (await sql.query(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY id`)).rows.map(entry => entry.row as MongoRow);
    const summaries: unknown[] = [];
    console.log(`[operation-backfill-pg] migrations=${migrations.length} baseline=118e276 fixtureSessions=16`);
    for (const backend of ["original PG", "new PG", "native Mongo"] as const) await suite.test(backend, async () => {
      const isMongo = backend === "native Mongo";
      if (!isMongo) await seedPg();
      const repo: Repository = isMongo ? mongo : backend === "new PG" ? new PrismaOperationBackfillRepository() : originalRepository(pgDb);
      const snapshot = async () => {
        const result: Record<string, string> = {};
        for (let index = 0; index < models.length; index++) result[models[index]] = hash(isMongo ? await store.collection(models[index]).find({}).sort({ _id: 1 }).toArray() : await rawPg(tables[index]));
        return result;
      };
      const sessionsRaw = async (): Promise<MongoRow[]> => isMongo ? await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray() : await rawPg("operation_sessions");
      const sessions = async (): Promise<MongoRow[]> => isMongo ? (await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray()).map(row => decodeMongoRuntimeDocument("OperationSession", row)) : await pgDb.operationSession.findMany({ orderBy: { id: "asc" } });
      const audits = async (): Promise<MongoRow[]> => isMongo ? (await store.collection("ActivityChange").find({}).toArray()).map(row => decodeMongoRuntimeDocument("ActivityChange", row)) : await pgDb.activityChange.findMany();
      const normalizeAudits = (rows: MongoRow[]) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "occurredAt", "actorEmailPiiIndex", "actorNamePiiIndex"].includes(key)))).sort((a, b) => `${a.targetId}:${a.route}`.localeCompare(`${b.targetId}:${b.route}`));
      const before = await snapshot();
      assert.equal(await activityContext.run(actor, () => repo.countOnsiteRequiredTargets()), 12);
      assert.equal(await activityContext.run(omActor, () => repo.countOmAssignmentStatusTargets()), 6);
      assert.deepEqual(await snapshot(), before, "both counts are read-only including timestamps/ciphertext/audit");
      for (const phase of ["onsite", "om"] as const) {
        const targets = phase === "onsite" ? onsiteTargets : omTargets;
        const rawBefore = await sessionsRaw(), logicalBefore = await sessions();
        const start = Date.now();
        const count = await activityContext.run(phase === "onsite" ? actor : omActor, () => phase === "onsite" ? repo.applyOnsiteRequiredBackfill() : repo.applyOmAssignmentStatusBackfill());
        assert.equal(count, phase === "onsite" ? 12 : 6);
        const finish = Date.now(), rawAfter = await sessionsRaw(), logicalAfter = await sessions();
        assert.equal(rawAfter.length, 16);
        for (const [index, [n]] of cases.entries()) {
          assert.equal(logicalAfter[index].id, id(n));
          if (!targets.has(n)) { assert.deepEqual(rawAfter[index], rawBefore[index], "non-target row is byte-for-byte unchanged"); continue; }
          const field = phase === "onsite" ? "onsiteRequired" : "operationStatus";
          assert.equal(logicalAfter[index][field], phase === "onsite" ? "Y" : "ASSIGNMENT_PLANNED");
          const timestamp = logicalAfter[index].updatedAt; assert.ok(timestamp instanceof Date);
          assert.notEqual(timestamp.getTime(), (logicalBefore[index].updatedAt as Date).getTime());
          assert.ok(timestamp.getTime() >= start && timestamp.getTime() <= finish);
          const rawField = isMongo ? field : phase === "onsite" ? "onsite_required" : "operation_status";
          const omit = (row: MongoRow) => Object.fromEntries(Object.entries(row).filter(([key]) => ![rawField, isMongo ? "updatedAt" : "updated_at"].includes(key)));
          assert.deepEqual(omit(rawAfter[index]), omit(rawBefore[index]), "only one business field and updatedAt may change; private ciphertext/onsiteText/updatedBy remain raw-identical");
        }
        // The other correction's target count is independent of this correction.
        assert.equal(await repo.countOnsiteRequiredTargets(), 0);
        assert.equal(await repo.countOmAssignmentStatusTargets(), phase === "onsite" ? 6 : 0);
        const after = await snapshot();
        assert.equal(await activityContext.run(phase === "onsite" ? actor : omActor, () => phase === "onsite" ? repo.applyOnsiteRequiredBackfill() : repo.applyOmAssignmentStatusBackfill()), 0);
        assert.deepEqual(await snapshot(), after, "zero-target replay does not update timestamps, ciphertext or audit");
      }
      const expectedAudits: MongoRow[] = [];
      for (const [n, onsiteRequired] of cases) if (onsiteTargets.has(n)) expectedAudits.push({ ...actor, targetType: "operation_sessions", targetId: id(n), action: "update", changes: { onsite_required: { before: onsiteRequired, after: "Y" } } });
      for (const n of omTargets) expectedAudits.push({ ...omActor, targetType: "operation_sessions", targetId: id(n), action: "update", changes: { operation_status: { before: "assignment_needed", after: "assignment_planned" } } });
      const observedAudits = normalizeAudits(await audits());
      assert.equal(observedAudits.length, 18); assert.deepEqual(observedAudits, normalizeAudits(expectedAudits));
      const after = await snapshot();
      for (const model of models) if (model !== "OperationSession" && model !== "ActivityChange") assert.equal(after[model], before[model], `${model} relation preserved`);
      const secrets = [actor.actorEmail, actor.actorName, "Synthetic assigned owner", "Synthetic private onsite text must stay", "synthetic-last-editor@example.invalid", "Synthetic private session note", "Synthetic private workbook", "private-source-value"];
      for (const [model, table] of [["OperationSession", "operation_sessions"], ["OperationSourceRecord", "operation_source_records"], ["ActivityChange", "activity_changes"]]) {
        const raw = JSON.stringify(isMongo ? await store.collection(model).find({}).toArray() : await rawPg(table));
        for (const secret of secrets) assert.equal(raw.includes(secret), false, `${backend} ${model} must not expose plaintext`);
      }
      const final = (await sessions()).map(row => ({ id: row.id, onsiteRequired: row.onsiteRequired, operationStatus: row.operationStatus, omName: row.omName, archiveStatus: row.archiveStatus, deletedAt: row.deletedAt }));
      const expectedFinal = cases.map(([n, onsiteRequired, operationStatus, omName]) => ({ id: id(n), onsiteRequired: onsiteTargets.has(n) ? "Y" : onsiteRequired,
        operationStatus: omTargets.has(n) ? "ASSIGNMENT_PLANNED" : operationStatus, omName, archiveStatus: n === 13 || n === 15 ? "DONE" : "NOT_READY", deletedAt: n === 14 ? day(2) : null }));
      assert.deepEqual(final, expectedFinal);
      summaries.push({ final, audits: observedAudits });
    });
    assert.equal(summaries.length, 3); assert.deepEqual(summaries[1], summaries[0]); assert.deepEqual(summaries[2], summaries[0]);
  } finally {
    try { if (db) await db.$disconnect(); }
    finally {
      try { if (pgConnected) await sql.end(); }
      finally {
        try {
          if (mongoConnected) {
            assert.match(namespace, /^shadow_operation_backfill_pg_[a-f0-9]{16}$/);
            const owned = await client.db(options.databaseName).listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray();
            for (const collection of owned) { assert.ok(collection.name.startsWith(`${namespace}_`)); await client.db(options.databaseName).collection(collection.name).drop(); }
          }
        } finally { await client.close(); for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
      }
    }
  }
});
