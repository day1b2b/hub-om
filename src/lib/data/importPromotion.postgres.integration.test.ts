/**
 * C1/C2/C3: frozen original PG / current PG / native Mongo repository oracle.
 * Execution belongs to the coordinator. No model PG, dotenv or current core in
 * expected-value computation. Both exact opt-ins and an empty PG are required.
 *
 * PREDECLARED comparison rules (promotion plan-v2 / validation-v2):
 * - Validate generated UUID uniqueness and every FK before replacing only new
 *   Company/Course/OperationSession IDs and their declared references.
 * - Check changed createdAt/updatedAt and audit occurredAt against the real call
 *   interval; only those generated timestamps receive labels. Fixed dates stay.
 * - Generated Course.processSeq may differ after uniqueness/high-water checks.
 *   Existing sequence values remain exact. PG nextval gaps are observed apart
 *   from failed-write snapshots; Mongo counter/guard rollback is raw exact.
 * - Only no-fingerprint generated operationId suffixes may receive labels, after
 *   syntax/uniqueness/source-link checks. Deterministic IDs remain exact.
 *   The two-writer serial oracle additionally registers the ordinary writer's
 *   returned manual-UUID after syntax, stored identity and FK checks; only that
 *   generated value and its exact audit references receive a manual label.
 *   Each writer's changed timestamps are checked against its OWN call interval.
 * - SQL enum/date/decimal storage is decoded independently. SQL array NULL is
 *   NEVER converted to []; educationDates physical and Prisma reads are recorded
 *   separately. JSON null, key order, array order and blocked reason order stay.
 * - Audit rows are an exact multiset (including duplicate events), with only
 *   generated audit UUID/time labels. JSONB change-field maps have no key order;
 *   their complete key/value sets, array order and actor/request fields survive.
 * - Multiple business-key candidates are checked against an explicit allowed
 *   set, never relabelled into a fictitious common selected OperationSession.
 * - Failed writes compare ciphertext/times/IDs plus audits and Mongo internals
 *   byte-for-byte at the driver-value level, without normalizing failed state.
 * Four native Company insert races compare to complete frozen PG serial tuples;
 * concurrent PG two-operation outcomes remain separate, never normalized to one.
 * Other guard races/retries/budgets and actual route/Calendar/request-audit
 * boundaries belong to separate suites and are NOT claimed by this file.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { mock, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma, type PrismaClient } from "@prisma/client";
import { Collection, MongoClient, MongoServerError } from "mongodb";
import pg from "pg";
import { activityContext } from "../activity/context";
import { decryptField, privacyFields } from "../privacy/fields";
import { getDataRepositoryOverride, runWithDataRepositories } from "./dataRepositoryContext";
import type { ImportPromotionResult } from "./importPromotionOriginal.fixture";
import type { CreateOperationInput, OperationSession } from "./operationTypes";
import { completeMongoRow, MongoOperationStore, prepareMongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";

const PG_URL = "postgresql://synthetic@127.0.0.1:56739/import_promotion_parity";
const MONGO_URI = "mongodb://127.0.0.1:27839/?replicaSet=importpromotion20260930";
const pgUrl = process.env.IMPORT_PROMOTION_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_IMPORT_PROMOTION_TEST_URI;
const ORACLE_SHA = "2d98a237b295c973ad0d9c8e12b726989341f390d513aad9ede055045ad73aa9";
function assertOracleIntegrity() {
  assert.equal(createHash("sha256").update(readFileSync(new URL("./importPromotionOriginal.fixture.ts", import.meta.url))).digest("hex"), ORACLE_SHA);
}
test("import promotion byte-frozen original SHA", assertOracleIntegrity);

const MODELS = ["Company", "Course", "OperationSession", "DataImportRun", "OperationSourceRecord", "Member", "TeamUser", "ActivityChange"] as const;
type Model = typeof MODELS[number];
type Row = MongoRow;
type Snapshot = Record<Model, Row[]>;
type Backend = "original" | "current" | "mongo";
const id = (n: number) => `aabbccdd-0930-4000-8000-${String(n).padStart(12, "0")}`;
const fingerprint = (n: number) => createHash("sha256").update(`synthetic-promotion-${n}`).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OLD = new Date("2020-01-01T00:00:00.000Z");
const START = new Date("2030-01-01T00:00:00.000Z"), END = new Date("2030-01-02T00:00:00.000Z");
const PRIVATE = "SYNTHETIC_PROMOTION_PRIVATE", OM = `${PRIVATE}_OM`, LD = `${PRIVATE}_LD`;
const HIGH_WATER = 100;
const EMPTY: ImportPromotionResult = { blocked: 0, blockedReasons: {}, created: 0, eligible: 0, linkedExisting: 0, revived: 0, sourceRows: 0 };
const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const dmmf = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
const schemaModels = new Map([...schema.matchAll(/^model (\w+)\s*\{([\s\S]*?)^\}/gm)].map(([, name, body]) => [name, body]));
const enums = new Map([...schema.matchAll(/^enum (\w+)\s*\{([^}]+)\}/gm)].map(([, name, body]) => [name,
  new Map([...body.matchAll(/^\s*(\w+)\s*(?:@map\("([^"]+)"\))?\s*$/gm)].map(([, value, stored]) => [stored ?? value, value]))]));
function info(model: Model) { const value = dmmf.get(model); assert.ok(value); return value; }
function table(model: Model) { return info(model).dbName ?? model; }
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
function listField(model: Model, field: string) {
  const body = schemaModels.get(model); assert.ok(body);
  return new RegExp(`^\\s*${field}\\s+\\w+\\[\\]`, "m").test(body);
}
// Do not ask the current promotion core/field builder to compute oracle values.
function logical(model: Model, raw: Row, mongo: boolean): Row {
  const decoded = mongo ? decodeMongoRuntimeDocument(model, raw) : raw;
  const fields = info(model).fields.filter(field => field.kind !== "object");
  if (!mongo) assert.deepEqual(Object.keys(raw).sort(), fields.map(field => field.dbName ?? field.name).sort(), `${model}: physical column drift`);
  return Object.fromEntries(fields.filter(field => !field.name.endsWith("PiiIndex") && !field.name.endsWith("Encrypted")).map(field => {
    let value = decoded[mongo ? field.name : field.dbName ?? field.name];
    if (!mongo && privacyFields[model]?.fields[field.name]) value = decryptField(model, field.name, value);
    if (value === MongoDbNull || value === MongoJsonNull) value = null;
    assert.notEqual(value, undefined, `${model}.${field.name}: missing scalar`);
    if (value !== null && field.type === "Json") value = structuredClone(value); // normalization must never mutate raw audit JSON
    if (value !== null && !mongo && field.kind === "enum") {
      const values = enums.get(field.type); assert.ok(values); assert.ok(values.has(String(value)));
      value = values.get(String(value));
    }
    if (value !== null && field.type === "DateTime") {
      if (listField(model, field.name)) { assert.ok(Array.isArray(value)); value = value.map(item => new Date(item)); }
      else value = new Date(value as string | Date);
    }
    if (value !== null && field.type === "Decimal") {
      const decimal = new Prisma.Decimal(String(value));
      assert.ok(decimal.isFinite() && decimal.decimalPlaces() <= 2, `${model}.${field.name}: stored numeric scale`);
      value = decimal.toFixed(2);
    }
    return [field.name, value];
  }));
}
function blank(): Snapshot { return Object.fromEntries(MODELS.map(model => [model, []])) as unknown as Snapshot; }
function fixture(): Snapshot {
  const data = blank();
  data.Company = [completeMongoRow("Company", { id: id(1), name: "Synthetic company", normalizedName: "synthetic company", createdAt: OLD, updatedAt: OLD })];
  data.Course = [completeMongoRow("Course", { id: id(2), companyId: id(1), processSeq: 17, courseId: "synthetic-course",
    name: "Synthetic course", operationType: "LONG", createdAt: OLD, updatedAt: OLD })];
  data.TeamUser = ([ [5, OM, "OM"], [6, LD, "LD"] ] as const).map(([n, name, role]) => completeMongoRow("TeamUser", {
    id: id(n), name, email: `synthetic-${n}@example.invalid`, slackId: `synthetic-${n}`, role, team: "1팀", createdAt: OLD
  }));
  data.DataImportRun = [completeMongoRow("DataImportRun", { id: id(100), sourceType: "synthetic-json", sourceTeam: "TEAM_1",
    sourceName: "Synthetic promotion", status: "COMPLETED", rowCount: 999, successCount: 998, errorCount: 1, startedAt: OLD })];
  return data;
}
function operation(n: number, fields: Row = {}): Row {
  return completeMongoRow("OperationSession", { id: id(n), courseRecordId: id(2), operationId: `synthetic-operation-${n}`,
    sourceFingerprint: fingerprint(n), startDate: START, endDate: END, operationStatus: "ASSIGNMENT_NEEDED", archiveStatus: "NOT_READY",
    educationFormat: "NEEDS_REVIEW", operationChannel: "NEEDS_REVIEW", onsiteRequired: "UNKNOWN", hasSatisfactionSurvey: "NEEDS_REVIEW",
    hasResultReport: "NEEDS_REVIEW", createdAt: OLD, updatedAt: OLD, ...fields });
}
function fields(overrides: Row = {}): Row {
  return { companyName: "Synthetic company", courseName: "Synthetic course", courseId: "synthetic-course", om: OM, ld: LD,
    startDate: "2030-01-01", endDate: "2030-01-02", ...overrides };
}
function source(n: number, mapped: Row = {}, overrides: Row = {}): Row {
  return completeMongoRow("OperationSourceRecord", { id: id(n), importRunId: id(100), sourceTeam: "TEAM_1",
    sourceWorkbook: "Synthetic workbook", sourceSheet: "합성", sourceRowNumber: n, headerRowNumber: 1,
    sourceFingerprint: fingerprint(n), rowSnapshot: { z: PRIVATE, a: ["z", "a"] }, mappedFields: fields(mapped),
    unmappedFields: { z: false, a: 0 }, validationErrors: [], createdAt: OLD, ...overrides });
}
function manualRaceInput(sameBusinessKey: boolean): CreateOperationInput {
  return {
    companyName: "Synthetic race company", courseName: "Synthetic race course", courseId: "race",
    startDate: sameBusinessKey ? "2030-01-01" : "2031-01-01", endDate: sameBusinessKey ? "2030-01-02" : "2031-01-02",
    archiveStatus: "아카이빙전", operationStatus: "배정필요", operationType: "검토필요", educationFormat: "검토필요",
    onsiteRequired: "UNKNOWN", om: OM, ld: LD, revenue: null, totalCost: null, instructorCost: null, operationCost: null,
    coach: "", companyWikiLink: "", costRaw: "", driveLink: "", educationDays: "", instructorWikiLink: "",
    instructors: "", lectureManagementLink: "", operationDetail: "", operationIssue: "", padletLink: "", region: "",
    resultReportLink: "", roundNo: "", specialNotes: "", timeText: ""
  };
}
// Audit is a field-set contract (SQL jsonb); this preserves every value/array.
function auditKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(auditKey).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${auditKey(item)}`).join(",")}}`;
  const encoded = JSON.stringify(value); assert.notEqual(encoded, undefined); return encoded;
}
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Promotion parity barrier timed out: ${label}`)), 10_000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

test("actual frozen PG / current PG / Mongo import promotion parity", {
  skip: pgUrl === undefined && mongoUri === undefined, concurrency: false, timeout: 600_000
}, async suite => {
  assert.equal(pgUrl, PG_URL); assert.equal(mongoUri, MONGO_URI); assertOracleIntegrity();
  const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url);
  const migrations = readdirSync(migrationRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.equal(migrations.length, 45, "review migration baseline drift");
  const migrationSql = migrations.map(name => readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8"));
  for (const key of ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID",
    "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "NOTION_API_KEY", "SLACK_BOT_TOKEN", "SALESMAP_API_TOKEN"])
    assert.equal(process.env[key], undefined, `${key}: coordinator must supply a clean environment`);
  const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
  assert.equal(globalForPrisma.prisma, undefined);
  const env = { TZ: "UTC", DATABASE_URL: PG_URL, OPERATION_DATA_SOURCE: "postgres", PII_ACTIVE_KEY_ID: "fixture",
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  const sql = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
  const client = new MongoClient(MONGO_URI, { directConnection: true, serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const options = { client, databaseName: `hub_om_shadow_promotion_pg_${randomBytes(8).toString("hex")}`,
    namespace: `shadow_promotion_${randomBytes(6).toString("hex")}`, allowShadowWrites: true as const };
  let db: PrismaClient | undefined, sqlConnected = false, pgOwned = false, mongoOwned = false;
  const alternateCalls = { local: 0, notion: 0 };
  const tripwires: Array<ReturnType<typeof mock.module>> = [];
  try {
    tripwires.push(mock.module("./localJsonTeamMemberRepository", { namedExports: {
      LocalJsonTeamMemberRepository: class { constructor() { alternateCalls.local++; throw new Error("LOCAL_ROSTER_TRIPWIRE"); } }
    } }));
    const refuseNotion = () => { alternateCalls.notion++; throw new Error("NOTION_ROSTER_TRIPWIRE"); };
    tripwires.push(mock.module("./notionTeamMemberRepository", { namedExports: {
      getNotionTeamMemberRepository: refuseNotion, NotionTeamMemberRepository: class { constructor() { refuseNotion(); } }
    } }));
    const original = await import("./importPromotionOriginal.fixture");
    const current = await import("./importPromotionService");
    const { getPrismaClient } = await import("./prisma");
    const { MongoImportPromotionRepository, prepareMongoImportPromotionStore, IMPORT_PROMOTION_MODELS } = await import("./mongoImportPromotionRepository");
    assert.deepEqual(new Set(IMPORT_PROMOTION_MODELS), new Set(["Company", "Course", "OperationSession", "DataImportRun", "OperationSourceRecord", "ActivityChange"]));
    await sql.connect(); sqlConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0], { db: "import_promotion_parity", usr: "synthetic" });
    const occupied = await sql.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    assert.equal(occupied.rowCount, 0, "refuse populated public schema"); pgOwned = true;
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.isWritablePrimary, true); assert.equal(hello.setName, "importpromotion20260930");
    assert.equal((await client.db(options.databaseName).listCollections({}, { nameOnly: true }).toArray()).length, 0); mongoOwned = true;
    await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const migration of migrationSql) await sql.query(migration);
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    await prepareMongoImportPromotionStore({ ...options, processSequenceHighWater: HIGH_WATER });
    await prepareMongoReadStore(options, TEAM_READ_MODELS);
    let promotion = await MongoImportPromotionRepository.open(options);
    const teamMembers = await MongoTeamMemberRepository.open(options);
    const mongoStore = new MongoOperationStore(options, MODELS);
    let operationInserts = 0;
    const pendingOperationInserts = new Set<number>();
    client.on("commandSucceeded", event => {
      // Only collection-level successful insert counts are observed below via
      // matching request IDs; no documents, plaintext or ciphertext are logged.
      if (!pendingOperationInserts.delete(event.requestId)) return;
      const reply = event.reply;
      if (!reply || typeof reply !== "object" || !("n" in reply) || typeof reply.n !== "number" || reply.n <= 0) return;
      const writeErrors = "writeErrors" in reply ? reply.writeErrors : [];
      if (!Array.isArray(writeErrors) || writeErrors.length > 0) return;
      operationInserts++;
    });
    client.on("commandStarted", event => {
      if (event.databaseName === options.databaseName && event.commandName === "insert"
        && event.command.insert === `${options.namespace}_OperationSession` && event.command.autocommit === false)
        pendingOperationInserts.add(event.requestId);
    });
    client.on("commandFailed", event => { pendingOperationInserts.delete(event.requestId); });
    const reference = new Map<string, unknown>();
    const compare = (backend: Backend, label: string, value: unknown) => {
      if (backend === "original") { assert.equal(reference.has(label), false); reference.set(label, value); }
      else { assert.ok(reference.has(label), `missing frozen oracle: ${label}`); assert.deepEqual(value, reference.get(label), `${backend}: ${label}`); }
    };
    for (const backend of ["original", "current", "mongo"] as const) {
      if (db) { await db.$disconnect(); delete globalForPrisma.prisma; db = undefined; }
      if (backend !== "mongo") { db = getPrismaClient(); assert.equal(db, globalForPrisma.prisma); }
      const promote = (run = id(100)) => activityContext.run({ requestId: id(9999), actorEmail: "synthetic@example.invalid",
        actorName: PRIVATE, actorType: "user", route: "/api/admin/imports/[id]/promote", method: "POST" }, () =>
        backend === "mongo" ? runWithDataRepositories({ importPromotion: promotion, teamMembers }, () => promotion.promoteReadyImportRows(run))
          : backend === "original" ? original.promoteReadyImportRows(run) : current.promoteReadyImportRows(run));
      const seed = async (data: Snapshot) => {
        if (backend === "mongo") {
          for (const model of [...MODELS].reverse()) await mongoStore.collection(model).deleteMany({});
          for (const model of MODELS) if (data[model].length)
            await mongoStore.collection(model).insertMany(data[model].map(row => encodeMongoRuntimeDocument(model, row)));
          await mongoStore.collection("__counter").updateOne({ _id: "Course.processSeq" }, { $set: { value: HIGH_WATER } });
        } else {
          assert.ok(db);
          await sql.query(`TRUNCATE ${MODELS.map(model => quote(table(model))).join(",")} RESTART IDENTITY CASCADE`);
          const delegates = db as unknown as Record<string, { createMany(args: { data: Row[] }): Promise<unknown> }>;
          for (const model of MODELS) if (data[model].length)
            await delegates[model[0].toLowerCase() + model.slice(1)].createMany({ data: data[model].map(row => Object.fromEntries(Object.entries(row)
              .map(([key, value]) => [key, value === MongoDbNull ? Prisma.DbNull : value === MongoJsonNull ? Prisma.JsonNull : value]))) });
          await sql.query("SELECT setval(pg_get_serial_sequence('courses','process_seq'), $1, true)", [HIGH_WATER]);
        }
      };
      const raw = async (): Promise<Snapshot> => {
        const state = blank();
        for (const model of MODELS) state[model] = backend === "mongo" ? await mongoStore.collection(model).find({}).sort({ _id: 1 }).toArray()
          : (await sql.query(`SELECT * FROM ${quote(table(model))} ORDER BY id`)).rows;
        return state;
      };
      const internals = async () => {
        if (backend !== "mongo") return null;
        const result: Record<string, Row[]> = {};
        const collections = await client.db(options.databaseName).listCollections({}, { nameOnly: true }).toArray();
        for (const { name } of collections.filter(item => item.name.startsWith(`${options.namespace}_`) && !MODELS.some(model => item.name === `${options.namespace}_${model}`)))
          result[name] = await client.db(options.databaseName).collection(name).find({}).sort({ _id: 1 }).toArray();
        return result;
      };
      const decoded = (state: Snapshot): Snapshot => Object.fromEntries(MODELS.map(model => [model, state[model].map(row => logical(model, row, backend === "mongo"))])) as unknown as Snapshot;
      const assertCallTimes = (before: Snapshot, after: Snapshot, start: number, end: number, writer: string) => {
        const oldState = decoded(before), state = decoded(after);
        for (const model of MODELS) for (const row of state[model]) {
          const old = oldState[model].find(item => item.id === row.id);
          for (const field of model === "ActivityChange" ? ["occurredAt"] : ["createdAt", "updatedAt"]) {
            if (!Object.hasOwn(row, field) || old?.[field] instanceof Date && row[field] instanceof Date
              && (old[field] as Date).getTime() === (row[field] as Date).getTime()) continue;
            assert.ok(row[field] instanceof Date);
            assert.ok((row[field] as Date).getTime() >= start && (row[field] as Date).getTime() <= end, `${writer}:${model}.${field}: own call interval`);
          }
        }
        for (const oldAudit of before.ActivityChange)
          assert.deepEqual(after.ActivityChange.find(row => (row._id ?? row.id) === (oldAudit._id ?? oldAudit.id)), oldAudit, "a later writer must preserve earlier raw audits");
      };
      const sequence = async () => backend === "mongo" ? Number((await mongoStore.collection("__counter").findOne({ _id: "Course.processSeq" }))?.value)
        : Number((await sql.query("SELECT last_value FROM courses_process_seq_seq")).rows[0].last_value);
      const rollback = async (work: () => Promise<unknown>, pgCode?: string) => {
        const before = await raw(), internalBefore = await internals();
        await assert.rejects(work, (error: unknown) => {
          assert.ok(error instanceof Error);
          if (backend !== "mongo" && pgCode) { assert.ok(error instanceof Prisma.PrismaClientKnownRequestError); assert.equal(error.code, pgCode); }
          if (backend === "mongo") assert.equal(error.message.includes(PRIVATE), false);
          return true;
        });
        assert.deepEqual(await raw(), before, "failed transaction changed full raw business/audit state");
        assert.deepEqual(await internals(), internalBefore, "failed transaction changed raw counter/guard state");
      };
      const normalized = (before: Snapshot, after: Snapshot, start: number, end: number, manualOperationId?: string) => {
        const previous = decoded(before), state = decoded(after), ids = new Map<string, string>(), randomOperations = new Map<string, string>();
        const allIds = new Set<string>();
        for (const model of MODELS) for (const row of state[model]) {
          assert.match(String(row.id), UUID); assert.equal(allIds.has(String(row.id)), false, "UUID collision"); allIds.add(String(row.id));
        }
        for (const row of state.Company) if (!previous.Company.some(old => old.id === row.id)) ids.set(String(row.id), `<company:${row.normalizedName}>`);
        const mapped = (value: unknown) => ids.get(String(value)) ?? value;
        for (const row of state.Course) {
          assert.ok(state.Company.some(company => company.id === row.companyId));
          const old = previous.Course.find(old => old.id === row.id);
          if (old) assert.equal(row.processSeq, old.processSeq);
          else { assert.ok(Number.isInteger(row.processSeq) && Number(row.processSeq) > HIGH_WATER); ids.set(String(row.id), `<course:${mapped(row.companyId)}:${row.courseId}:${row.name}>`); }
        }
        assert.equal(new Set(state.Course.map(row => row.processSeq)).size, state.Course.length);
        assert.equal(new Set(state.OperationSession.map(row => row.operationId)).size, state.OperationSession.length);
        for (const row of state.OperationSession) {
          assert.ok(state.Course.some(course => course.id === row.courseRecordId));
          if (!previous.OperationSession.some(old => old.id === row.id)) {
            if (row.operationId === manualOperationId) {
              assert.ok(manualOperationId); assert.ok(manualOperationId.startsWith("manual-")); assert.match(manualOperationId.slice(7), UUID);
              assert.equal(row.sourceFingerprint, null);
              assert.equal(state.OperationSession.filter(item => item.operationId === manualOperationId).length, 1);
              randomOperations.set(manualOperationId, "<manual-operation-id>");
              ids.set(String(row.id), "<manual-operation-uuid>");
              continue;
            }
            const children = state.OperationSourceRecord.filter(child => child.operationSessionId === row.id);
            assert.ok(children.length > 0); const child = [...children].sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
            if (!row.sourceFingerprint) {
              assert.match(String(row.operationId), /^SRC-(TEAM1|TEAM2|UNKNOWN)-[0-9A-F]{12}$/);
              randomOperations.set(String(row.operationId), `<random-operation:${child.id}>`);
            } else assert.equal(row.operationId, `SRC-${String(child.sourceTeam).replace("_", "").toUpperCase()}-${String(row.sourceFingerprint).slice(0, 12).toUpperCase()}`);
            ids.set(String(row.id), `<operation:${child.id}>`);
          }
        }
        assert.equal(new Set(ids.values()).size, ids.size, "generated logical identities must be unique");
        for (const row of state.OperationSourceRecord) {
          assert.ok(state.DataImportRun.some(run => run.id === row.importRunId));
          if (row.operationSessionId !== null) assert.ok(state.OperationSession.some(operation => operation.id === row.operationSessionId));
        }
        for (const model of MODELS) for (const row of state[model]) {
          const old = previous[model].find(old => old.id === row.id);
          for (const field of model === "ActivityChange" ? ["occurredAt"] : ["createdAt", "updatedAt"]) {
            if (!Object.hasOwn(row, field)) continue;
            if (old?.[field] instanceof Date && row[field] instanceof Date && (old[field] as Date).getTime() === (row[field] as Date).getTime()) continue;
            assert.ok(row[field] instanceof Date);
            assert.ok((row[field] as Date).getTime() >= start && (row[field] as Date).getTime() <= end, `${model}.${field}: outside actual call`);
            row[field] = `<call:${field}>`;
          }
          for (const field of ["companyId", "courseRecordId", "operationSessionId"]) if (Object.hasOwn(row, field)) row[field] = mapped(row[field]);
          if (model === "Course" && !old) row.processSeq = `<sequence:${mapped(row.id)}>`;
          if (model === "OperationSession") row.operationId = randomOperations.get(String(row.operationId)) ?? row.operationId;
          if (model !== "ActivityChange") row.id = mapped(row.id);
          if (model === "OperationSourceRecord" || model === "DataImportRun")
            for (const field of info(model).fields.filter(field => field.type === "Json")) row[field.name] = JSON.stringify(row[field.name]);
          if (model === "ActivityChange") {
            assert.ok([table("Company"), table("Course"), table("OperationSession")].includes(String(row.targetType)), "staging model mutation audit forbidden");
            const target = MODELS.find(model => table(model) === row.targetType); assert.ok(target);
            assert.ok(after[target].some(raw => (backend === "mongo" ? raw._id : raw.id) === row.targetId));
            assert.ok(row.requestId === id(9999) || manualOperationId !== undefined && row.requestId === id(9998));
            assert.equal(row.actorEmail, "synthetic@example.invalid"); assert.equal(row.actorName, PRIVATE);
            assert.equal(row.actorType, "user"); assert.equal(row.method, "POST");
            assert.equal(row.route, row.requestId === id(9998) ? "/api/operations" : "/api/admin/imports/[id]/promote");
            row.targetId = mapped(row.targetId); row.id = "<audit-uuid>";
            const changes = row.changes as Record<string, unknown>;
            for (const field of ["company_id", "course_record_id", "operation_id"]) {
              const change = changes[field];
              if (change && typeof change === "object") for (const side of ["before", "after"]) {
                const pair = change as Row;
                if (Object.hasOwn(pair, side)) pair[side] = field === "operation_id" ? randomOperations.get(String(pair[side])) ?? pair[side] : mapped(pair[side]);
              }
            }
          }
        }
        for (const model of MODELS) state[model].sort((a, b) => (model === "ActivityChange" ? auditKey(a) : String(a.id)).localeCompare(model === "ActivityChange" ? auditKey(b) : String(b.id)));
        return state;
      };
      const invoke = async (label: string, run = id(100)) => {
        const before = await raw(), start = Date.now(); const result = await promote(run); const end = Date.now(), after = await raw();
        assert.equal(result.blocked + result.eligible, result.sourceRows);
        assert.equal(result.created + result.linkedExisting + result.revived, result.eligible);
        assert.deepEqual(after.DataImportRun, before.DataImportRun, "promotion must not rewrite run counters");
        for (const model of ["Member", "TeamUser"] as const) assert.deepEqual(after[model], before[model]);
        for (const model of ["OperationSession", "OperationSourceRecord", "ActivityChange"] as const)
          assert.equal(JSON.stringify(after[model]).includes(PRIVATE), false, `${model}: private plaintext in raw store`);
        compare(backend, `${label}:summary`, result);
        compare(backend, `${label}:blocked-order`, Object.entries(result.blockedReasons));
        // Register all normalized evidence at once, retaining exact audit changes.
        compare(backend, `${label}:state`, normalized(before, after, start, end));
        return { result, state: decoded(after), before, after };
      };

      await suite.test(`${backend}: generated defaults, Unicode, numeric(14,2), exact create/update audits and arrays`, async () => {
        const data = fixture();
        data.OperationSourceRecord = [source(200, { companyName: "  SYNTHETIC   company ", operationType: "단기", revenue: "1.005", totalCost: "-1.005",
          instructorCost: "NaN", operationCost: "Infinity", operationStatus: "진행 중", educationFormat: "블랜디드", onsiteText: "일부필요",
          om: `${OM.toLowerCase()} (synthetic)`, specialNotes: { z: ["가", "나"], a: true }, sessionDurationDays: "2.5" }),
        source(201, { companyName: "New 합성 기업", courseName: "New 합성 과정", courseId: "new", revenue: "999999999999.994",
          totalCost: "1,234.56", operationType: "unknown", startDate: "2030/2/3", endDate: "2030.2.3", om: "Unlisted OM", ld: "Unlisted LD" }),
        source(202, { companyName: "No fingerprint company", courseName: "No fingerprint course" }, { sourceFingerprint: null })];
        await seed(data);
        const before = await raw(), start = Date.now(); const result = await promote(); const end = Date.now(), after = await raw(), state = decoded(after);
        assert.deepEqual(result, { ...EMPTY, created: 3, eligible: 3, sourceRows: 3 });
        const first = state.OperationSession.find(row => row.sourceFingerprint === fingerprint(200)); assert.ok(first);
        assert.equal(first.totalCost, "-1.01"); assert.equal(first.instructorCost, null); assert.equal(first.operationCost, null);
        assert.equal(first.omName, OM); assert.equal(first.sessionDurationDays, 3); assert.equal(first.sessionDurationType, "NEEDS_REVIEW");
        assert.equal(first.specialNotes, '{"z":["가","나"],"a":true}');
        assert.equal(state.Course.find(row => row.id === id(2))?.revenue, "1.01");
        assert.equal(state.Course.find(row => row.courseId === "new")?.revenue, "999999999999.99");
        assert.ok(state.ActivityChange.some(row => row.targetType === table("Company") && row.action === "create"));
        assert.ok(state.ActivityChange.some(row => row.targetType === table("Course") && row.action === "create"));
        assert.equal(state.ActivityChange.filter(row => row.targetType === table("OperationSession") && row.action === "create").length, 3);
        assert.deepEqual(after.DataImportRun, before.DataImportRun);
        for (const model of ["OperationSession", "OperationSourceRecord", "ActivityChange"] as const)
          assert.equal(JSON.stringify(after[model]).includes(PRIVATE), false, `${model}: private plaintext in raw store`);
        if (backend !== "mongo") {
          assert.ok(db);
          const projected = await db.operationSession.findUniqueOrThrow({ where: { id: String(first.id) }, select: { educationDates: true } });
          suite.diagnostic(`${backend}: educationDates SQL=${JSON.stringify(first.educationDates)} Prisma=${JSON.stringify(projected.educationDates)}`);
          compare(backend, "educationDates physical-vs-Prisma", { physical: first.educationDates, prisma: projected.educationDates });
        } else suite.diagnostic(`mongo: educationDates codec=${JSON.stringify(first.educationDates)}; SQL NULL is not silently replaced`);
        compare(backend, "create:summary", result);
        compare(backend, "create:state", normalized(before, after, start, end));
        const replayBefore = await raw(); assert.deepEqual(await promote(), EMPTY); assert.deepEqual(await raw(), replayBefore);
      });

      await suite.test(`${backend}: same-value restore reencrypts PII but preserves PG audit field selection`, async () => {
        const data = fixture();
        data.OperationSession = [operation(3, { deletedAt: OLD, deletedBy: PRIVATE, omName: OM, ldName: LD,
          operationMonth: "2030-01", sessionDurationDays: 2, sessionDurationType: "NEEDS_REVIEW", validationErrors: [] })];
        data.OperationSourceRecord = [source(214, {}, { sourceFingerprint: fingerprint(3) })];
        await seed(data);
        const { result, state, before, after } = await invoke("same-value-restore");
        assert.deepEqual(result, { ...EMPTY, eligible: 1, revived: 1, sourceRows: 1 });
        assert.equal(state.OperationSession[0].omName, OM); assert.equal(state.OperationSession[0].ldName, LD);
        const omField = backend === "mongo" ? "omName" : "om_name";
        assert.notDeepEqual(after.OperationSession[0][omField], before.OperationSession[0][omField], "same plaintext is reencrypted");
        assert.equal(state.ActivityChange.length, 1); assert.equal(state.ActivityChange[0].action, "restore");
        assert.equal(Object.hasOwn(state.ActivityChange[0].changes as object, "om_name"), false, "PG HMAC equality suppresses the unchanged PII field");
      });

      await suite.test(`${backend}: active fingerprint, business key, soft-delete restore and preserved manual values`, async () => {
        const data = fixture();
        data.OperationSession = [operation(3), operation(4, { deletedAt: OLD, deletedBy: PRIVATE, educationDates: [START, END],
          hasSatisfactionSurvey: "NOT_REQUIRED", avgSatisfaction: "manual", lectureManagementNote: PRIVATE, onsiteOmName: PRIVATE,
          omUserId: "manual-om", ldUserId: "manual-ld", createdBy: "synthetic-creator", updatedBy: "synthetic-editor", totalCost: "9.99" })];
        data.OperationSourceRecord = [source(210, { companyName: "Ignored company", courseName: "Ignored course", startDate: "2040-1-1", endDate: "2040-1-2" }, { sourceFingerprint: fingerprint(3), sourceTeam: "TEAM_2" }),
          source(211, { courseId: "ignored-different-id", roundNo: "different" }),
          source(212, { companyName: "Restored source company", courseName: "Restored source course", om: `${OM.toLowerCase()} (synthetic)`, totalCost: "1.005" }, { sourceFingerprint: fingerprint(4) }),
          source(213, {}, { operationSessionId: id(4), sourceFingerprint: fingerprint(4) })];
        await seed(data);
        const { result, state, before, after } = await invoke("links-and-restore");
        assert.deepEqual(result, { ...EMPTY, eligible: 3, linkedExisting: 2, revived: 1, sourceRows: 3 });
        assert.deepEqual(after.Company, before.Company); assert.deepEqual(after.Course, before.Course);
        assert.deepEqual(after.OperationSession.find(row => (row._id ?? row.id) === id(3)), before.OperationSession.find(row => (row._id ?? row.id) === id(3)));
        const restored = state.OperationSession.find(row => row.id === id(4)); assert.ok(restored);
        for (const field of ["operationId", "courseRecordId", "sourceFingerprint", "educationDates", "hasSatisfactionSurvey", "avgSatisfaction", "lectureManagementNote", "onsiteOmName", "omUserId", "ldUserId", "createdBy", "updatedBy", "createdAt"])
          assert.deepEqual(restored[field], data.OperationSession[1][field], `${field}: restore preserves manual value`);
        assert.equal(restored.deletedAt, null); assert.equal(restored.deletedBy, null); assert.equal(restored.totalCost, "1.01");
        assert.equal(state.ActivityChange.length, 1); assert.equal(state.ActivityChange[0].action, "restore");
        const replayBefore = await raw(); assert.deepEqual(await promote(), EMPTY); assert.deepEqual(await raw(), replayBefore);
      });

      await suite.test(`${backend}: mixed blocked precedence, JSON null/arrays, invalid dates and blocked-only replay`, async () => {
        const data = fixture(); data.OperationSession = [operation(3)];
        data.OperationSourceRecord = [source(220), source(221, { om: "", ld: "" }, { validationErrors: [" first ", 1, "", "second"] }),
          source(222, { om: "", ld: "" }), source(223, { ld: "", companyName: "" }), source(224, { companyName: "", courseName: "" }),
          source(225, { courseName: "", startDate: "invalid" }), source(226, { startDate: "2030-02-29" }), source(227, { endDate: "2030-02-30" }),
          source(228, { startDate: "2030-01-03" }), source(229, {}, { mappedFields: MongoDbNull }), source(230, {}, { mappedFields: ["array"] })];
        await seed(data);
        const { result, before, after } = await invoke("mixed");
        assert.deepEqual(result, { ...EMPTY, sourceRows: 11, eligible: 1, linkedExisting: 1, blocked: 10, blockedReasons: {
          " first  / second": 1, "담당OM 정보가 없습니다.": 3, "담당LD 정보가 없습니다.": 1, "기업명 누락": 1, "과정명 누락": 1,
          "시작일 누락 또는 날짜 해석 실패": 1, "종료일 누락 또는 날짜 해석 실패": 1, "종료일이 시작일보다 빠름": 1
        } });
        for (const model of ["Company", "Course", "OperationSession", "ActivityChange"] as const) assert.deepEqual(after[model], before[model]);
        const replayBefore = await raw(); const replay = await promote();
        assert.deepEqual(replay, { ...result, sourceRows: 10, eligible: 0, linkedExisting: 0 }); assert.deepEqual(await raw(), replayBefore);
        compare(backend, "mixed:replay", replay);
      });

      await suite.test(`${backend}: 201 rows, Korean sheet order, within-run duplicate and source-link UUID`, async () => {
        const data = fixture();
        data.OperationSourceRecord = Array.from({ length: 201 }, (_, n) => source(1000 + n, {}, {
          sourceFingerprint: fingerprint(1000), sourceSheet: ["하", "가", "A", "나"][n % 4], sourceRowNumber: 201 - n
        }));
        // The first row controls values on the one created operation; subsequent
        // fingerprint matches only link, exposing actual Korean sheet ordering.
        for (const row of data.OperationSourceRecord) (row.mappedFields as Row).specialNotes = `row-${row.id}`;
        await seed(data);
        const { result, state } = await invoke("201");
        assert.deepEqual(result, { ...EMPTY, sourceRows: 201, eligible: 201, created: 1, linkedExisting: 200 });
        const ordered = [...data.OperationSourceRecord].sort((a, b) => String(a.sourceSheet).localeCompare(String(b.sourceSheet), "ko") || Number(a.sourceRowNumber) - Number(b.sourceRowNumber));
        assert.equal(state.OperationSession.length, 1); assert.equal(state.OperationSession[0].specialNotes, `row-${ordered[0].id}`);
        assert.equal(new Set(state.OperationSourceRecord.map(row => row.operationSessionId)).size, 1);
        assert.equal(state.OperationSourceRecord[0].operationSessionId, state.OperationSession[0].id);
        const before = await raw(); assert.deepEqual(await promote(), EMPTY); assert.deepEqual(await raw(), before);
      });

      await suite.test(`${backend}: unordered multiple business-key candidates form an allowed identity set`, async () => {
        const data = fixture();
        data.Course.push(completeMongoRow("Course", { ...data.Course[0], id: id(7), courseId: "other-id", processSeq: 18 }));
        data.OperationSession = [operation(3, { roundNo: "1" }), operation(4, { courseRecordId: id(7), roundNo: "2" }), operation(8, { deletedAt: OLD })];
        data.OperationSourceRecord = [source(240, { courseId: "neither-id", roundNo: "neither-round" }, { sourceTeam: "TEAM_2", sourceFingerprint: null })];
        await seed(data); const before = await raw(); const result = await promote(); const after = await raw(), state = decoded(after);
        assert.deepEqual(result, { ...EMPTY, eligible: 1, linkedExisting: 1, sourceRows: 1 }); compare(backend, "multiple:summary", result);
        const linked = state.OperationSourceRecord[0].operationSessionId; assert.ok([id(3), id(4)].includes(String(linked)));
        assert.ok(state.OperationSession.some(row => row.id === linked && row.deletedAt === null));
        for (const model of MODELS.filter(model => model !== "OperationSourceRecord")) assert.deepEqual(after[model], before[model]);
        const sourceBefore = decoded(before).OperationSourceRecord[0];
        assert.deepEqual(state.OperationSourceRecord[0], { ...sourceBefore, operationSessionId: linked });
        suite.diagnostic(`${backend}: unordered business-key selected ${linked}; allowed ${id(3)},${id(4)}`);
      });

      await suite.test(`${backend}: late prefix collision/overflow roll back all rows and audits; sequence gap is explicit`, async () => {
        for (const failure of ["prefix", "overflow"] as const) {
          const data = fixture();
          data.OperationSourceRecord = [source(250, { companyName: "Rollback first", courseName: "First" }, { sourceFingerprint: `123456789abc${"0".repeat(52)}` }),
            source(251, { companyName: "Rollback second", courseName: "Second", ...(failure === "overflow" ? { totalCost: "999999999999.995" } : {}) },
              { sourceFingerprint: failure === "prefix" ? `123456789abc${"1".repeat(52)}` : fingerprint(251) })];
          await seed(data); const seqBefore = await sequence(), insertsBefore = operationInserts;
          await rollback(() => promote(), failure === "prefix" ? "P2002" : undefined);
          const seqAfter = await sequence();
          if (backend === "mongo") {
            assert.ok(operationInserts > insertsBefore, "late failure must follow an acknowledged OperationSession insert in the aborted transaction");
            assert.equal(seqAfter, seqBefore);
          } else assert.ok(seqAfter > seqBefore, "native nextval consumption survives transaction abort");
          suite.diagnostic(`${backend}: ${failure} rollback processSeq ${seqBefore}->${seqAfter}; raw business/audit comparison was exact`);
          if (backend === "mongo") promotion = await MongoImportPromotionRepository.open(options);
          // Remove only the failing source. Reopen must preserve high-water;
          // PG must not reuse consumed sequence values after the failed batch.
          if (backend === "mongo") await mongoStore.collection("OperationSourceRecord").deleteOne({ _id: id(251) });
          else { assert.ok(db); await db.operationSourceRecord.delete({ where: { id: id(251) } }); }
          const { result, state } = await invoke(`after-${failure}-rollback`); assert.equal(result.created, 1);
          const generated = state.Course.find(row => row.id !== id(2)); assert.ok(generated); assert.ok(Number(generated.processSeq) > seqAfter);
        }
      });

      await suite.test(`${backend}: missing run, Notion source and malformed UUID retain original boundaries`, async () => {
        await seed(fixture()); const before = await raw(); assert.deepEqual(await promote(id(999)), EMPTY); assert.deepEqual(await raw(), before);
        const data = fixture(); data.DataImportRun[0].sourceType = "Synthetic-NoTiOn-export"; data.OperationSourceRecord = [source(260)]; await seed(data);
        const blockedBefore = await raw(), internalBefore = await internals();
        await assert.rejects(() => promote(), { message: "Notion 가져오기는 검수용으로만 저장합니다. 중복 방지를 위해 운영 데이터 반영은 막혀 있습니다." });
        assert.deepEqual(await raw(), blockedBefore); assert.deepEqual(await internals(), internalBefore);
        for (const invalid of ["", "not-a-uuid", ` ${id(100)}`]) await rollback(() => promote(invalid));
      });

      if (backend !== "mongo") for (const sameBusinessKey of [false, true]) await suite.test(`${backend}: native promotion/ordinary create share natural keys, ${sameBusinessKey ? "same" : "different"} dates`, async () => {
        const { PrismaOperationRepository } = await import("./prismaOperationRepository");
        const data = fixture();
        data.OperationSourceRecord = [source(280, { companyName: "Synthetic race company", courseName: "Synthetic race course", courseId: "race" })];
        await seed(data);
        const manual = manualRaceInput(sameBusinessKey);
        // Both real upsert INSERT attempts must reach this BEFORE trigger before
        // either writes. A shared xact lock releases both without serializing
        // them artificially; actual unique/upsert behavior decides the outcome.
        // Promotion has already performed findByBusinessKey at this point. The
        // same-date case must still create, not retry/requery and link instead.
        await sql.query(`CREATE FUNCTION promotion_parity_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.normalized_name = 'synthetic race company' THEN
            PERFORM pg_advisory_xact_lock_shared(20260930,39); END IF; RETURN NEW; END $$;
          CREATE TRIGGER promotion_parity_barrier BEFORE INSERT ON companies
          FOR EACH ROW EXECUTE FUNCTION promotion_parity_barrier()`);
        const pending: Array<Promise<PromiseSettledResult<unknown>>> = [];
        const settle = (work: Promise<unknown>) => work.then(value => ({ status: "fulfilled", value }) as const,
          reason => ({ status: "rejected", reason }) as const);
        try {
          await sql.query("SELECT pg_advisory_lock(20260930,39)");
          pending.push(settle(promote()));
          pending.push(settle(new PrismaOperationRepository().createOperation(manual)));
          const deadline = performance.now() + 1800; let witnessed = false;
          while (performance.now() < deadline) {
            const blocked = await sql.query("SELECT DISTINCT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND l.classid=20260930 AND l.objid=39 AND a.datname=current_database()");
            if (blocked.rowCount === 2) { witnessed = true; break; }
            await delay(10);
          }
          assert.equal(witnessed, true, "require two native insert waiters, not a sleep-based race assumption");
          await sql.query("SELECT pg_advisory_unlock(20260930,39)");
          const results = await Promise.all(pending);
          for (const result of results) assert.equal(result.status, "fulfilled", "both native PG upserts must commit; timeout/unique failures are not success");
          if (results[0].status === "fulfilled") assert.deepEqual(results[0].value, { ...EMPTY, created: 1, eligible: 1, sourceRows: 1 });
          const state = decoded(await raw());
          const companies = state.Company.filter(row => row.normalizedName === "synthetic race company"); assert.equal(companies.length, 1);
          const courses = state.Course.filter(row => row.companyId === companies[0].id); assert.equal(courses.length, 1);
          assert.equal(courses[0].courseId, "race"); assert.equal(courses[0].name, "Synthetic race course");
          assert.ok(Number(courses[0].processSeq) > HIGH_WATER); assert.equal(state.Course.find(row => row.id === id(2))?.processSeq, 17);
          assert.equal(state.OperationSession.length, 2); assert.equal(new Set(state.OperationSession.map(row => row.operationId)).size, 2);
          for (const row of state.OperationSession) assert.equal(row.courseRecordId, courses[0].id);
          assert.equal(new Set(state.OperationSession.map(row => (row.startDate as Date).toISOString())).size, sameBusinessKey ? 1 : 2);
          const promoted = state.OperationSession.find(row => row.sourceFingerprint === fingerprint(280)); assert.ok(promoted);
          assert.equal(state.OperationSourceRecord[0].operationSessionId, promoted.id);
          compare(backend, `natural-key-race-${sameBusinessKey}:outcomes`, { statuses: results.map(result => result.status), companies: companies.length, courses: courses.length, sessions: state.OperationSession.length });
          suite.diagnostic(`${backend}: ${sameBusinessKey ? "same business key" : "different dates"}: witnessed two Company INSERT waiters; promotion and actual PrismaOperationRepository.createOperation both created operations sharing one company/course`);
        } finally {
          await sql.query("SELECT pg_advisory_unlock(20260930,39)");
          await Promise.all(pending);
          await sql.query("DROP TRIGGER promotion_parity_barrier ON companies; DROP FUNCTION promotion_parity_barrier()");
        }
      });

      if (backend !== "mongo") for (const sameBusinessKey of [false, true]) for (const manualFirst of [true, false])
        await suite.test(`${backend}: serial ${manualFirst ? "ordinary create -> promotion" : "promotion -> ordinary create"}, ${sameBusinessKey ? "same" : "different"} dates`, async () => {
          const { PrismaOperationRepository } = await import("./prismaOperationRepository");
          const data = fixture();
          data.OperationSourceRecord = [source(280, { companyName: "Synthetic race company", courseName: "Synthetic race course", courseId: "race" })];
          await seed(data);
          const label = `serial-${sameBusinessKey}-${manualFirst}`, baseline = await raw();
          let manualOperationId: string | undefined, summary: ImportPromotionResult | undefined;
          let previous = baseline, firstStart = 0, lastEnd = 0;
          for (const writer of manualFirst ? ["manual", "promotion"] as const : ["promotion", "manual"] as const) {
            const start = Date.now(); assert.ok(start >= lastEnd, "serial calls must not overlap");
            if (!firstStart) firstStart = start;
            if (writer === "manual") {
              const result = await activityContext.run({ requestId: id(9998), actorEmail: "synthetic@example.invalid",
                actorName: PRIVATE, actorType: "user", route: "/api/operations", method: "POST" },
              () => new PrismaOperationRepository().createOperation(manualRaceInput(sameBusinessKey)));
              manualOperationId = result.operationId;
              assert.ok(manualOperationId.startsWith("manual-")); assert.match(manualOperationId.slice(7), UUID);
            } else summary = await promote();
            lastEnd = Date.now(); const after = await raw();
            // A broad two-call interval must not hide an incorrect attribution
            // of timestamps or an old audit being rewritten by the second call.
            assertCallTimes(previous, after, start, lastEnd, writer);
            assert.deepEqual(after.DataImportRun, baseline.DataImportRun);
            compare(backend, `${label}:after-${writer}`, normalized(baseline, after, firstStart, lastEnd, manualOperationId));
            previous = after;
          }
          assert.ok(summary); assert.ok(manualOperationId);
          const final = decoded(previous), manual = final.OperationSession.find(row => row.operationId === manualOperationId); assert.ok(manual);
          const linkOnly = sameBusinessKey && manualFirst;
          assert.deepEqual(summary, { ...EMPTY, sourceRows: 1, eligible: 1, created: linkOnly ? 0 : 1, linkedExisting: linkOnly ? 1 : 0 });
          compare(backend, `${label}:summary`, summary);
          compare(backend, `${label}:state`, normalized(baseline, previous, firstStart, lastEnd, manualOperationId));
          assert.equal(final.OperationSession.length, linkOnly ? 1 : 2, "serial cardinality is never normalized into the concurrent result");
          const courses = final.Course.filter(row => row.courseId === "race"); assert.equal(courses.length, 1);
          for (const operation of final.OperationSession) assert.equal(operation.courseRecordId, courses[0].id);
          const linked = final.OperationSourceRecord[0].operationSessionId;
          assert.equal(linked, linkOnly ? manual.id : final.OperationSession.find(row => row.sourceFingerprint === fingerprint(280))?.id);
          assert.equal(final.ActivityChange.filter(row => row.targetType === table("OperationSession") && row.action === "create").length, linkOnly ? 1 : 2);
          if (linkOnly) assert.equal(final.ActivityChange.filter(row => row.requestId === id(9999)).length, 0, "link-only promotion has no model audit");
          // Preserve summary, full field values, references and every audit in
          // each PG oracle. Mongo race acceptance must compare to one COMPLETE
          // serial result, not select fieldwise pieces from incompatible orders.
          suite.diagnostic(`${backend}: ${label}: ${final.OperationSession.length} operations, created=${summary.created}, linkedExisting=${summary.linkedExisting}; full intermediate/final values, references and audit multisets compared. Concurrent same-key PG remains 2; a Mongo retry result of 1 is a distinct permitted-serial outcome, not concurrent parity.`);
        });

      if (backend !== "mongo") for (const sameBusinessKey of [false, true]) for (const manualFirst of [true, false])
        await suite.test(`${backend}: overlapping requests realize the ${manualFirst ? "manual" : "promotion"}-first serial tuple, ${sameBusinessKey ? "same" : "different"} dates`, async () => {
          const { PrismaOperationRepository } = await import("./prismaOperationRepository");
          const { PrismaTeamMemberRepository } = await import("./prismaTeamMemberRepository");
          const data = fixture();
          data.OperationSourceRecord = [source(280, { companyName: "Synthetic race company", courseName: "Synthetic race course", courseId: "race" })];
          await seed(data);
          const label = `serial-${sameBusinessKey}-${manualFirst}`, baseline = await raw();
          const winnerRole = manualFirst ? "manual" : "promotion", loserRole = manualFirst ? "promotion" : "manual";
          const winnerId = id(manualFirst ? 9998 : 9999), loserId = id(manualFirst ? 9999 : 9998);
          const winnerHeld = signal(), loserHeld = signal(), releaseWinner = signal(), releaseLoser = signal();
          let manualOperationId: string | undefined, summary: ImportPromotionResult | undefined;
          let winnerEntered = false, loserEntered = false;
          const roster = PrismaTeamMemberRepository.prototype.listRoleRosters;
          // Both actual service calls begin. Delay only before forwarding their
          // first real roster read, which precedes transaction/business queries.
          // The frozen service, PG adapter, getPrismaClient and all SQL stay real.
          const patch = mock.method(PrismaTeamMemberRepository.prototype, "listRoleRosters", async function (this: InstanceType<typeof PrismaTeamMemberRepository>) {
            const owner = activityContext.getStore()?.requestId;
            if (owner === winnerId && !winnerEntered) { winnerEntered = true; winnerHeld.resolve(); await bounded(releaseWinner.promise, "PG winner roster release"); }
            if (owner === loserId && !loserEntered) { loserEntered = true; loserHeld.resolve(); await bounded(releaseLoser.promise, "PG loser roster release"); }
            return roster.call(this);
          });
          const work = async (role: "manual" | "promotion") => {
            const start = Date.now();
            if (role === "manual") {
              const result = await activityContext.run({ requestId: id(9998), actorEmail: "synthetic@example.invalid", actorName: PRIVATE,
                actorType: "user", route: "/api/operations", method: "POST" }, () => new PrismaOperationRepository().createOperation(manualRaceInput(sameBusinessKey)));
              manualOperationId = result.operationId;
            } else summary = await promote();
            return { start, end: Date.now() };
          };
          const arrived = (held: ReturnType<typeof signal>, task: ReturnType<typeof work>, role: string) => bounded(Promise.race([
            held.promise, task.then(() => { throw new Error(`${role} returned before its real PG roster entry`); })
          ]), `PG ${role} entry`);
          const winner = work(winnerRole); void winner.catch(() => {});
          let loser: ReturnType<typeof work> | undefined;
          let winnerTime: Awaited<ReturnType<typeof work>> | undefined, loserTime: Awaited<ReturnType<typeof work>> | undefined;
          let afterWinner: Snapshot | undefined, afterBoth: Snapshot | undefined;
          try {
            await arrived(winnerHeld, winner, winnerRole);
            loser = work(loserRole); void loser.catch(() => {}); await arrived(loserHeld, loser, loserRole);
            assert.ok(winnerEntered && loserEntered);
            releaseWinner.resolve(); winnerTime = await bounded(winner, "PG predecessor commit"); afterWinner = await raw();
            releaseLoser.resolve(); loserTime = await bounded(loser, "PG successor after predecessor commit"); afterBoth = await raw();
          } finally {
            releaseWinner.resolve(); releaseLoser.resolve(); await Promise.allSettled(loser ? [winner, loser] : [winner]); patch.mock.restore();
          }
          assert.ok(winnerTime); assert.ok(loserTime); assert.ok(afterWinner); assert.ok(afterBoth); assert.ok(summary); assert.ok(manualOperationId);
          assert.ok(loserTime.start <= winnerTime.end, "actual service invocations must overlap");
          assertCallTimes(baseline, afterWinner, winnerTime.start, winnerTime.end, winnerRole);
          assertCallTimes(afterWinner, afterBoth, loserTime.start, loserTime.end, loserRole);
          const tuple = { summary,
            winnerState: normalized(baseline, afterWinner, winnerTime.start, winnerTime.end, manualFirst ? manualOperationId : undefined),
            state: normalized(baseline, afterBoth, Math.min(winnerTime.start, loserTime.start), Math.max(winnerTime.end, loserTime.end), manualOperationId) };
          for (const key of [`${label}:summary`, `${label}:after-${winnerRole}`, `${label}:state`]) assert.ok(reference.has(key), key);
          assert.deepEqual(tuple, { summary: reference.get(`${label}:summary`), winnerState: reference.get(`${label}:after-${winnerRole}`), state: reference.get(`${label}:state`) },
            `${backend}: one complete serial tuple is realized by overlapping native PG calls`);
          compare(backend, `overlap-${sameBusinessKey}-${manualFirst}:tuple`, tuple);
          suite.diagnostic(`${backend}: two real overlapping service invocations, ${winnerRole} committed before ${loserRole}'s first roster/business read; complete serial tuple witnessed, not inferred by mixing schedules.`);
        });

      if (backend === "mongo") for (const sameBusinessKey of [false, true]) for (const manualFirst of [true, false])
        await suite.test(`mongo: actual Company insert race vs complete frozen PG serial tuple, ${manualFirst ? "manual" : "promotion"} wins, ${sameBusinessKey ? "same" : "different"} dates`, async () => {
          const { MongoOperationRepository } = await import("./mongoOperationRepository");
          await prepareMongoOperationStore({ ...options, processSequenceHighWater: HIGH_WATER });
          const ordinary = await MongoOperationRepository.open(options);
          const data = fixture();
          data.OperationSourceRecord = [source(280, { companyName: "Synthetic race company", courseName: "Synthetic race course", courseId: "race" })];
          await seed(data);
          const label = `serial-${sameBusinessKey}-${manualFirst}`, baseline = await raw(), internalBefore = await internals();
          assert.ok(reference.has(`${label}:summary`)); assert.ok(reference.has(`${label}:state`));
          const overlapKey = `overlap-${sameBusinessKey}-${manualFirst}:tuple`;
          assert.ok(reference.has(overlapKey), "require a successfully witnessed overlapping frozen PG schedule");
          const winnerRole = manualFirst ? "manual" : "promotion", loserRole = manualFirst ? "promotion" : "manual";
          const winnerId = id(manualFirst ? 9998 : 9999), loserId = id(manualFirst ? 9999 : 9998);
          const winnerHeld = signal(), loserHeld = signal(), releaseWinner = signal(), releaseLoser = signal();
          let winnerPaused = false, loserPaused = false, conflicts = 0;
          const insert = Collection.prototype.insertOne;
          const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
            const owner = activityContext.getStore()?.requestId;
            const company = this.collectionName === `${options.namespace}_Company`;
            // Only pause before forwarding the real driver operation. Both
            // writers have read the absent natural key in actual transactions;
            // no fake result/error is injected and both native inserts proceed.
            if (company && owner === winnerId && !winnerPaused) {
              winnerPaused = true; winnerHeld.resolve(); await bounded(releaseWinner.promise, "release winner");
            }
            if (company && owner === loserId && !loserPaused) {
              loserPaused = true; loserHeld.resolve(); await bounded(releaseLoser.promise, "release loser");
            }
            try { return await insert.apply(this, args); }
            catch (error) {
              if (company && owner === loserId && error instanceof MongoServerError && [11000, 112].includes(Number(error.code))) conflicts++;
              throw error;
            }
          });
          type Outcome = { role: "manual"; value: OperationSession; start: number; end: number }
            | { role: "promotion"; value: ImportPromotionResult; start: number; end: number };
          const work = async (role: "manual" | "promotion"): Promise<Outcome> => {
            const start = Date.now();
            if (role === "manual") {
              const value = await activityContext.run({ requestId: id(9998), actorEmail: "synthetic@example.invalid", actorName: PRIVATE,
                actorType: "user", route: "/api/operations", method: "POST" }, () => ordinary.createOperation(manualRaceInput(sameBusinessKey)));
              return { role, value, start, end: Date.now() };
            }
            const value = await promote(); return { role, value, start, end: Date.now() };
          };
          const arrived = (held: ReturnType<typeof signal>, task: Promise<Outcome>, writer: string) => bounded(Promise.race([
            held.promise, task.then(() => { throw new Error(`${writer} returned before reaching its actual Company insert barrier`); })
          ]), `${writer} arrival`);
          const winner = work(winnerRole); void winner.catch(() => {});
          let loser: Promise<Outcome> | undefined, winnerResult: Outcome | undefined, loserResult: Outcome | undefined;
          let afterWinner: Snapshot | undefined, afterBoth: Snapshot | undefined;
          try {
            await arrived(winnerHeld, winner, winnerRole);
            loser = work(loserRole); void loser.catch(() => {});
            await arrived(loserHeld, loser, loserRole);
            assert.ok(winnerPaused && loserPaused);
            releaseWinner.resolve(); winnerResult = await bounded(winner, "winner commit");
            afterWinner = await raw();
            releaseLoser.resolve(); loserResult = await bounded(loser, "loser retry/commit");
            afterBoth = await raw();
          } finally {
            releaseWinner.resolve(); releaseLoser.resolve();
            await Promise.allSettled(loser ? [winner, loser] : [winner]);
            patch.mock.restore();
          }
          assert.ok(winnerResult); assert.ok(loserResult); assert.ok(afterWinner); assert.ok(afterBoth);
          assert.ok(conflicts >= 1, "require a real Company 11000/112; merely sequential success is insufficient");
          assertCallTimes(baseline, afterWinner, winnerResult.start, winnerResult.end, winnerRole);
          assertCallTimes(afterWinner, afterBoth, loserResult.start, loserResult.end, loserRole);
          const manual = winnerResult.role === "manual" ? winnerResult : loserResult;
          const promoted = winnerResult.role === "promotion" ? winnerResult : loserResult;
          assert.equal(manual.role, "manual"); assert.equal(promoted.role, "promotion");
          if (manual.role !== "manual" || promoted.role !== "promotion") throw new Error("missing writer outcome");
          const state = decoded(afterBoth), manualRow = state.OperationSession.find(row => row.operationId === manual.value.operationId); assert.ok(manualRow);
          assert.equal(manualRow.id, manual.value.id, "manual returned UUID must reference the stored row");
          assert.deepEqual(afterBoth.DataImportRun, baseline.DataImportRun);
          for (const model of ["Member", "TeamUser"] as const) assert.deepEqual(afterBoth[model], baseline[model]);
          for (const model of ["OperationSession", "OperationSourceRecord", "ActivityChange"] as const)
            assert.equal(JSON.stringify(afterBoth[model]).includes(PRIVATE), false, `${model}: private plaintext in raw store`);

          // Internal recovery is verified separately; guard nonces and counters
          // are not deleted from a business tuple to conceal business differences.
          const internalAfter = await internals(); assert.ok(internalBefore); assert.ok(internalAfter);
          assert.deepEqual(Object.keys(internalAfter).sort(), Object.keys(internalBefore).sort());
          for (const name of Object.keys(internalBefore)) {
            if (name === mongoStore.collection("__counter").collectionName) {
              assert.deepEqual(internalAfter[name], [{ _id: "Course.processSeq", value: HIGH_WATER + 1 }]);
              continue;
            }
            if (name === `${options.namespace}_CourseNameRestoreGuard`) {
              assert.equal(internalAfter[name].length, 1); assert.equal(internalAfter[name][0]._id, "restore");
              assert.match(String(internalAfter[name][0].nonce), UUID);
            } else assert.deepEqual(internalAfter[name], internalBefore[name], `${name}: unrelated internal/lookup rows changed`);
          }
          assert.equal(await sequence(), HIGH_WATER + 1, "aborted attempt must not leak counter increments");
          const generatedCourse = state.Course.filter(row => row.id !== id(2)); assert.equal(generatedCourse.length, 1);
          assert.equal(generatedCourse[0].processSeq, HIGH_WATER + 1); assert.equal(state.Course.find(row => row.id === id(2))?.processSeq, 17);
          promotion = await MongoImportPromotionRepository.open(options); await MongoOperationRepository.open(options);
          assert.deepEqual(await raw(), afterBoth); assert.deepEqual(await internals(), internalAfter, "open must not repair post-race stores");
          assert.deepEqual(await promote(), EMPTY); assert.deepEqual(await raw(), afterBoth, "post-race replay must not add business/audit writes");
          assert.equal(await sequence(), HIGH_WATER + 1);

          const first = Math.min(winnerResult.start, loserResult.start), last = Math.max(winnerResult.end, loserResult.end);
          const actual = { summary: promoted.value,
            winnerState: normalized(baseline, afterWinner, winnerResult.start, winnerResult.end, winnerResult.role === "manual" ? winnerResult.value.operationId : undefined),
            state: normalized(baseline, afterBoth, first, last, manual.value.operationId) };
          const expected = reference.get(overlapKey);
          assert.deepEqual(expected, { summary: reference.get(`${label}:summary`), winnerState: reference.get(`${label}:after-${winnerRole}`), state: reference.get(`${label}:state`) },
            "witnessed PG overlap must still be the same complete serial oracle");
          suite.diagnostic(`mongo ${label}: ${conflicts} native insert conflicts, ${state.OperationSession.length} operations; comparing COMPLETE summary/source/business/audit tuple to frozen PG serial ${winnerRole} first. Concurrent same-key PG 2 vs retry-link Mongo 1 remains explicit; no global serializability or always-one guarantee.`);
          // Ordinary Mongo audit field gaps are genuine failures here. Do not
          // drop nullable INSERT fields, patch audit values, or compare subsets.
          assert.deepEqual(actual, expected, `mongo ${label}: complete frozen PG serial tuple (including exact ordinary-writer audits)`);
        });

      if (backend !== "mongo") for (const sourceMode of ["local", "notion"] as const) await suite.test(`${backend}: successful actual PG under ${sourceMode} still uses PG-only role roster`, async check => {
        const previous = process.env.OPERATION_DATA_SOURCE; let fetchCalls = 0;
        check.mock.method(globalThis, "fetch", () => { fetchCalls++; throw new Error("FETCH_TRIPWIRE"); });
        try {
          process.env.OPERATION_DATA_SOURCE = sourceMode; assert.equal(getDataRepositoryOverride("importPromotion"), undefined); assert.ok(db);
          assert.deepEqual(await db.$queryRaw`SELECT current_database() AS db, current_user AS usr`, [{ db: "import_promotion_parity", usr: "synthetic" }]);
          for (const present of [true, false]) {
            const data = fixture();
            if (!present) for (const user of data.TeamUser) user.name = `UNRELATED_${user.role}`; // no empty-roster default fallback
            const omInput = `${OM.toLowerCase()} (synthetic)`, ldInput = `${LD.toLowerCase()} [synthetic]`;
            data.OperationSourceRecord = [source(270, { om: omInput, ld: ldInput })]; await seed(data);
            const { result, state } = await invoke(`pg-roster-${sourceMode}-${present}`);
            assert.equal(result.created, 1); assert.equal(state.OperationSession[0].omName, present ? OM : omInput);
            assert.equal(state.OperationSession[0].ldName, present ? LD : ldInput);
          }
          assert.deepEqual(alternateCalls, { local: 0, notion: 0 }); assert.equal(fetchCalls, 0);
        } finally { if (previous === undefined) delete process.env.OPERATION_DATA_SOURCE; else process.env.OPERATION_DATA_SOURCE = previous; }
      });
    }
    suite.diagnostic("C1/C2/C3 repository oracle, actual PG insert barriers/serial orders/overlapping-before-query schedules, and four actual Mongo Company insert races directly compared to single complete frozen PG allowed summary/source/business/audit tuples. Other Mongo guard/retry/unknown-commit, scan/time budgets, counter exhaustion/preparation and handler/Calendar/request audits remain separate. No execution is implied by this file's existence.");
  } finally {
    const cleanup = await Promise.allSettled([
      (async () => { try { if (mongoOwned) await client.db(options.databaseName).dropDatabase(); } finally { await client.close(); } })(),
      (async () => {
        try { if (db) await db.$disconnect(); }
        finally {
          if (globalForPrisma.prisma === db) delete globalForPrisma.prisma;
          try { if (pgOwned) await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); }
          finally { if (sqlConnected) await sql.end(); }
        }
      })(),
      ...tripwires.map(tripwire => Promise.resolve().then(() => tripwire.restore()))
    ]);
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    const failed = cleanup.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed.length) throw new AggregateError(failed.map(result => result.reason), "owned synthetic promotion stores cleanup failed");
  }
});
