/**
 * Repository-only V2/V3/V4/V6/V8 parity. Coordinator owns execution and servers.
 * Both exact opt-ins, an empty disposable PG and ephemeral encryption keys are
 * required. No dotenv, fake Prisma, model PG, clock mock or network fallback.
 *
 * PREDECLARED COMPARISON CONTRACT (plan-v2 / validation-v2):
 * - The frozen reader/writer SHA values below are checked BEFORE DB access.
 * - Original and current PG use the actual getPrismaClient, serially, with the
 *   owned global singleton disconnected/deleted between phases on the same DB.
 * - Only generated run/row UUIDs may map to invocation/row identities, AFTER
 *   UUID uniqueness, FK correspondence and stored-row membership are verified.
 * - Only generated run.startedAt/finishedAt and row.createdAt (and their DTO
 *   projections) map to invocation labels AFTER real invocation-bound checks.
 *   Cross-invocation time order is checked; fixed timestamps are never replaced.
 *   The original supplies finishedAt via JS Date but leaves startedAt to its
 *   default; independently generated intra-call values have no guaranteed
 *   startedAt <= finishedAt relation. Read sorting and cross-call order remain
 *   checked against the actual timestamps, without changing stored values.
 * - Enum storage labels and SQL/BSON dates/JSON null tags are decoded to logical
 *   values. All logical scalar fields, nulls, JSON key/array/log order survive.
 *   Table snapshots are ordered by verified logical identity, NOT DTO lists.
 * - Exact collation boundary ties are tested as permitted sets, not normalized
 *   into an invented common row. Every strictly earlier rank remains mandatory.
 * - Reads and failed writes compare FULL raw rows, including ciphertext, IDs,
 *   timestamps and mutation audit rows, with NO normalization or error masking.
 * - Request audits, handlers, parser and promotion are separate suites. Staging
 *   model mutation-audit exclusion is tested here using actual activity context.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { mock, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma, type PrismaClient } from "@prisma/client";
import { MongoClient } from "mongodb";
import pg from "pg";
import { activityContext } from "../activity/context";
import { decryptField, privacyFields } from "../privacy/fields";
import { getDataRepositoryOverride, runWithDataRepositories } from "./dataRepositoryContext";
import type { ImportRepository } from "./importRepository";
import type { StoreImportInput, StoreImportResult } from "./importStagingWriter";
import type { ParsedImportRow } from "./importUploadParser";
import { completeMongoRow, MongoOperationError, MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";

const PG_URL = "postgresql://synthetic@127.0.0.1:56729/import_staging_parity";
const MONGO_URI = "mongodb://127.0.0.1:27829/?replicaSet=importstaging20260930";
const pgUrl = process.env.IMPORT_STAGING_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_IMPORT_STAGING_TEST_URI;
const ORACLES = [
  ["importReadOriginal.fixture.ts", "3d0e8761a2f930bff626ce5e4fa6f4b1df1d368b41805a42a7b1c52ed847796b"],
  ["importStagingOriginal.fixture.ts", "5d35a855273cb728faa3ffa5c01c6c1270359231c5c1cfb39e4ea475ffb98c12"]
] as const;
function assertOracleIntegrity() {
  for (const [file, sha] of ORACLES)
    assert.equal(createHash("sha256").update(readFileSync(new URL(`./${file}`, import.meta.url))).digest("hex"), sha, file);
}
test("import staging byte-frozen original reader/writer SHA", assertOracleIntegrity);

const id = (n: number) => `aabbccdd-0930-4000-8000-${String(n).padStart(12, "0")}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OLD = new Date("2020-01-01T00:00:00.000Z");
const PRIVATE = "SYNTHETIC_IMPORT_PRIVATE";
const OM = `${PRIVATE}_OM`, LD = `${PRIVATE}_LD`, INSTRUCTOR = `${PRIVATE}_INSTRUCTOR`;
const MODELS = ["Company", "Course", "OperationSession", "DataImportRun", "OperationSourceRecord", "Member", "TeamUser", "InstructorNote", "ActivityChange"] as const;
const STAGING = ["DataImportRun", "OperationSourceRecord"] as const;
type Model = typeof MODELS[number];
type Row = MongoRow;
type Seed = Record<Model, Row[]>;
type Backend = "original" | "current" | "mongo";
type Snapshot = Record<Model, Row[]>;
type Store = (input: StoreImportInput) => Promise<StoreImportResult>;
const dmmf = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const enums = new Map([...schema.matchAll(/^enum (\w+)\s*\{([^}]+)\}/gm)].map(([, name, body]) => [name,
  new Map([...body.matchAll(/^\s*(\w+)\s*(?:@map\("([^"]+)"\))?\s*$/gm)].map(([, value, stored]) => [stored ?? value, value]))]));
function info(model: Model) { const result = dmmf.get(model); assert.ok(result); return result; }
function table(model: Model) { return info(model).dbName ?? model; }
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const dtoDate = (value: Date) => new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul"
}).format(value);

// Independent SQL decoding: do not use a current import projector or writer helper.
function logical(model: typeof STAGING[number], raw: Row, mongo: boolean): Row {
  const decoded = mongo ? decodeMongoRuntimeDocument(model, raw) : raw;
  const fields = info(model).fields.filter(field => field.kind !== "object");
  if (!mongo) assert.deepEqual(Object.keys(raw).sort(), fields.map(field => field.dbName ?? field.name).sort());
  return Object.fromEntries(fields.filter(field => !field.name.endsWith("PiiIndex")).map(field => {
    let value = decoded[mongo ? field.name : field.dbName ?? field.name];
    if (!mongo && privacyFields[model]?.fields[field.name]) value = decryptField(model, field.name, value);
    if (value === MongoDbNull || value === MongoJsonNull) value = null;
    if (value !== null && !mongo && field.kind === "enum") {
      const values = enums.get(field.type); assert.ok(values); assert.ok(values.has(String(value)));
      value = values.get(String(value));
    }
    if (value !== null && field.type === "DateTime") value = new Date(value as string | Date);
    return [field.name, value];
  }));
}
function blankSeed(): Seed { return Object.fromEntries(MODELS.map(model => [model, []])) as unknown as Seed; }
function fixture(): Seed {
  const seed = blankSeed();
  const add = (model: Model, row: Row) => seed[model].push(completeMongoRow(model, row));
  add("Company", { id: id(1), name: "Synthetic company", normalizedName: "synthetic company", createdAt: OLD, updatedAt: OLD });
  add("Course", { id: id(2), companyId: id(1), processSeq: 1, courseId: "synthetic-course", name: "Synthetic course",
    operationType: "LONG", createdAt: OLD, updatedAt: OLD });
  for (const n of [3, 4]) add("OperationSession", {
    id: id(n), operationId: `synthetic-operation-${n}`, courseRecordId: id(2), startDate: OLD, endDate: OLD,
    operationStatus: "ASSIGNMENT_NEEDED", archiveStatus: "NOT_READY", educationFormat: "NEEDS_REVIEW",
    operationChannel: "NEEDS_REVIEW", onsiteRequired: "UNKNOWN", hasSatisfactionSurvey: "NEEDS_REVIEW",
    hasResultReport: "NEEDS_REVIEW", createdAt: OLD, updatedAt: OLD, deletedAt: n === 4 ? OLD : null
  });
  for (const [n, name, role] of [[5, OM, "OM"], [6, LD, "LD"]] as const)
    add("TeamUser", { id: id(n), name, email: `synthetic-${n}@example.invalid`, slackId: `synthetic-${n}`, team: "1팀", role, createdAt: OLD });
  add("InstructorNote", { id: id(7), instructorName: `${PRIVATE}_CANONICAL`, displayName: INSTRUCTOR,
    notionNo: 1, recruitAvoid: false, createdAt: OLD, updatedAt: OLD });
  add("InstructorNote", { id: id(8), instructorName: `${PRIVATE}_FALLBACK`, displayName: null,
    notionNo: 2, recruitAvoid: false, createdAt: OLD, updatedAt: OLD });
  return seed;
}
function seedRun(n: number, fields: Row = {}): Row {
  return completeMongoRow("DataImportRun", { id: id(n), sourceTeam: "TEAM_1", sourceType: "synthetic-json",
    sourceName: `${PRIVATE}_SOURCE`, status: "COMPLETED", rowCount: 0, successCount: 0, errorCount: 0,
    startedAt: OLD, ...fields });
}
function seedRow(n: number, run: number, fields: Row = {}): Row {
  return completeMongoRow("OperationSourceRecord", { id: id(n), importRunId: id(run), sourceTeam: "TEAM_1",
    sourceWorkbook: `${PRIVATE}_WORKBOOK`, sourceSheet: "합성", sourceRowNumber: n, headerRowNumber: 1,
    sourceFingerprint: `synthetic-${n}`, rowSnapshot: { z: `${PRIVATE}_SNAPSHOT`, a: "second" },
    mappedFields: { courseName: "Synthetic course" }, unmappedFields: {}, validationErrors: [], createdAt: OLD, ...fields });
}
function parsedRow(n: number, fields: Partial<ParsedImportRow> = {}): ParsedImportRow {
  return { rowNumber: n, sourceFingerprint: `synthetic-fingerprint-${n}`,
    mappedFields: { companyName: "Synthetic company", courseName: "Synthetic course", startDate: "2030-01-01",
      endDate: "2030-01-02", om: OM, ld: LD, instructors: INSTRUCTOR },
    rowSnapshot: { z: `${PRIVATE}_SNAPSHOT`, a: "second" }, unmappedFields: { zz: "last", aa: "first" },
    validationErrors: [], ...fields };
}
function input(rows: ParsedImportRow[], fields: Partial<StoreImportInput> = {}): StoreImportInput {
  return { fileName: `${PRIVATE}.json`, importedBy: `${PRIVATE}@example.invalid`, sourceName: `${PRIVATE}_SOURCE`,
    sourceSheet: "합성", sourceTeam: "TEAM_1", sourceType: "synthetic-json", sourceWorkbook: `${PRIVATE}_WORKBOOK`,
    parsed: { headerRowNumber: 1, rows }, ...fields };
}
function aliases(value: string) {
  const compact = value.replaceAll("-", "");
  return [value.toUpperCase(), compact, `{${value.toUpperCase()}}`, compact.match(/.{4}/g)!.join("-")];
}

test("actual frozen PG / current PG / Mongo import staging parity", {
  skip: pgUrl === undefined && mongoUri === undefined, concurrency: false, timeout: 600_000
}, async suite => {
  assert.equal(pgUrl, PG_URL); assert.equal(mongoUri, MONGO_URI);
  assertOracleIntegrity();
  const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url);
  const migrations = readdirSync(migrationRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.equal(migrations.length, 45, "review baseline drift; never silently relax migration count");
  const migrationSql = migrations.map(name => readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8"));
  for (const key of ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS",
    "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "NOTION_API_KEY", "SLACK_BOT_TOKEN", "SALESMAP_API_TOKEN"])
    assert.equal(process.env[key], undefined, `${key}: run in coordinator-owned clean env, not dotenv`);
  const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
  assert.equal(globalForPrisma.prisma, undefined, "never replace a pre-existing Prisma connection");
  const env = { TZ: "UTC", DATABASE_URL: PG_URL, OPERATION_DATA_SOURCE: "postgres",
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const sql = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
  const client = new MongoClient(MONGO_URI, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const options = { client, databaseName: `hub_om_shadow_import_pg_${randomBytes(8).toString("hex")}`,
    namespace: `shadow_import_${randomBytes(6).toString("hex")}`, allowShadowWrites: true as const };
  let db: PrismaClient | undefined, sqlConnected = false, pgOwned = false, mongoOwned = false;
  const alternateCalls = { localRoster: 0, localInstructor: 0, notionRoster: 0 };
  const alternateTripwires: Array<ReturnType<typeof mock.module>> = [];
  try {
    // Only forbidden alternate backends are replaced, before importing writers.
    // getPrismaClient, PrismaPg, both PG repositories and SQL remain entirely real.
    alternateTripwires.push(mock.module("./localJsonTeamMemberRepository", { namedExports: {
      LocalJsonTeamMemberRepository: class { constructor() { alternateCalls.localRoster++; throw new Error("LOCAL_ROSTER_TRIPWIRE"); } }
    } }));
    alternateTripwires.push(mock.module("./localJsonInstructorNoteRepository", { namedExports: {
      LocalJsonInstructorNoteRepository: class { constructor() { alternateCalls.localInstructor++; throw new Error("LOCAL_INSTRUCTOR_TRIPWIRE"); } }
    } }));
    const refuseNotion = () => { alternateCalls.notionRoster++; throw new Error("NOTION_ROSTER_TRIPWIRE"); };
    alternateTripwires.push(mock.module("./notionTeamMemberRepository", { namedExports: {
      getNotionTeamMemberRepository: refuseNotion,
      NotionTeamMemberRepository: class { constructor() { refuseNotion(); } }
    } }));
    const originalRead = await import("./importReadOriginal.fixture");
    const originalWrite = await import("./importStagingOriginal.fixture");
    const currentRead = await import("./prismaImportRepository");
    const currentWrite = await import("./importStagingWriter");
    const { getPrismaClient } = await import("./prisma");
    const { IMPORT_MODELS, prepareMongoImportStore, MongoImportRepository } = await import("./mongoImportRepository");
    assert.deepEqual(IMPORT_MODELS, ["DataImportRun", "OperationSourceRecord", "OperationSession", "Course", "Company"]);
    await sql.connect(); sqlConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0], { db: "import_staging_parity", usr: "synthetic" });
    const occupied = await sql.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    assert.equal(occupied.rowCount, 0, "refuse a populated schema; parent supplies an empty synthetic database"); pgOwned = true;
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.isWritablePrimary, true); assert.equal(hello.setName, "importstaging20260930");
    assert.equal((await client.db(options.databaseName).listCollections({}, { nameOnly: true }).toArray()).length, 0); mongoOwned = true;
    await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const migration of migrationSql) await sql.query(migration);
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    await prepareMongoImportStore(options);
    await prepareMongoReadStore(options, TEAM_READ_MODELS);
    await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
    const imports = await MongoImportRepository.open(options);
    const teamMembers = await MongoTeamMemberRepository.open(options);
    const instructorNote = await MongoInstructorNoteRepository.open(options);
    const mongoStore = new MongoOperationStore(options, MODELS);
    const reference = new Map<string, unknown>();
    const compare = (backend: Backend, name: string, actual: unknown) => {
      if (backend === "original") { assert.equal(reference.has(name), false); reference.set(name, actual); }
      else { assert.ok(reference.has(name), `missing frozen oracle scenario: ${name}`); assert.deepEqual(actual, reference.get(name), `${backend}: ${name}`); }
    };
    for (const backend of ["original", "current", "mongo"] as const) {
      // Actual global client is initialized once per PG phase, NEVER concurrently.
      if (db) { await db.$disconnect(); delete globalForPrisma.prisma; db = undefined; }
      if (backend !== "mongo") { db = getPrismaClient(); assert.equal(db, globalForPrisma.prisma); }
      const repo: ImportRepository = backend === "mongo" ? imports : backend === "original"
        ? new originalRead.PrismaImportRepository() : new currentRead.PrismaImportRepository();
      const store: Store = backend === "mongo" ? value => runWithDataRepositories({ imports, teamMembers, instructorNote },
        () => imports.storeParsedImport(value)) : backend === "original" ? originalWrite.storeParsedImport : currentWrite.storeParsedImport;
      const seed = async (data: Seed) => {
        if (backend === "mongo") {
          for (const model of [...MODELS].reverse()) await mongoStore.collection(model).deleteMany({});
          for (const model of MODELS) if (data[model].length)
            await mongoStore.collection(model).insertMany(data[model].map(row => encodeMongoRuntimeDocument(model, row)));
        } else {
          assert.ok(db);
          await sql.query(`TRUNCATE ${MODELS.map(model => quote(table(model))).join(",")} RESTART IDENTITY CASCADE`);
          const delegates = db as unknown as Record<string, { createMany(args: { data: Row[] }): Promise<unknown> }>;
          for (const model of MODELS) if (data[model].length)
            await delegates[model[0].toLowerCase() + model.slice(1)].createMany({ data: data[model].map(row =>
              Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
                value === MongoDbNull ? Prisma.DbNull : value === MongoJsonNull ? Prisma.JsonNull : value]))) });
        }
      };
      const raw = async (): Promise<Snapshot> => {
        const state = {} as Snapshot;
        for (const model of MODELS) state[model] = backend === "mongo"
          ? await mongoStore.collection(model).find({}).sort({ _id: 1 }).toArray()
          : (await sql.query(`SELECT * FROM ${quote(table(model))} ORDER BY id`)).rows;
        return state;
      };
      const staging = (state: Snapshot) => Object.fromEntries(STAGING.map(model => [model,
        state[model].map(row => logical(model, row, backend === "mongo"))])) as Record<typeof STAGING[number], Row[]>;
      const attributed = <T>(work: () => Promise<T>) => activityContext.run({ requestId: id(9999), actorEmail: "synthetic@example.invalid",
        actorName: "Synthetic actor", actorType: "user", route: "/api/imports/upload", method: "POST" }, work);
      const noWrite = async <T>(work: () => Promise<T>): Promise<T> => {
        const before = await raw();
        try { return await work(); } finally { assert.deepEqual(await raw(), before, "full raw state changed during read/failed write"); }
      };
      const rejectNoWrite = async (work: () => Promise<unknown>) => noWrite(() => assert.rejects(work));
      const safeMongoError = (error: unknown) => {
        assert.ok(error instanceof MongoOperationError);
        assert.equal(error.message.includes(PRIVATE), false);
        return true;
      };

      if (backend !== "mongo") for (const source of ["local", "notion"] as const)
        await suite.test(`${backend}: unscoped ${source} still validates against actual PG roster and instructors`, async check => {
          assert.ok(db); const prisma = db;
          const previousSource = process.env.OPERATION_DATA_SOURCE;
          const fetchTripwire = check.mock.method(globalThis, "fetch", () => { throw new Error("EXTERNAL_FETCH_TRIPWIRE"); });
          process.env.OPERATION_DATA_SOURCE = source;
          try {
            assert.equal(getDataRepositoryOverride("imports"), undefined);
            assert.equal(getPrismaClient(), prisma);
            assert.deepEqual(await prisma.$queryRaw`SELECT current_database() AS db, current_user AS usr`,
              [{ db: "import_staging_parity", usr: "synthetic" }]);
            const missing = { om: `${PRIVATE}_NEVER_OM`, ld: `${PRIVATE}_NEVER_LD`, instructors: `${PRIVATE}_NEVER_INSTRUCTOR` };
            const unknownErrors = (names: { om: string; ld: string; instructors: string }) => [
              `담당OM에 멤버 관리(팀 유저)에 없는 이름이 있습니다: ${names.om}`,
              `담당LD에 멤버 관리(팀 유저)에 없는 이름이 있습니다: ${names.ld}`,
              `강사에 강사DB 노션에 없는 이름이 있습니다: ${names.instructors}`
            ];
            // Identical input in both phases. Only PG membership changes; keep
            // unrelated OM/LD rows so the real empty-roster fallback cannot hide it.
            const value = input([parsedRow(80), parsedRow(81, {
              mappedFields: { ...parsedRow(81).mappedFields, ...missing }, validationErrors: ["synthetic parser error first"]
            })]);
            for (const present of [true, false]) {
              const data = fixture();
              if (!present) {
                for (const row of data.TeamUser) row.name = `${PRIVATE}_OTHER_${row.role}`;
                data.InstructorNote[0].displayName = `${PRIVATE}_OTHER_INSTRUCTOR`;
              }
              await seed(data);
              const pgUsers = await prisma.teamUser.findMany({ select: { name: true, role: true } });
              const pgNotes = await prisma.instructorNote.findMany({ select: { instructorName: true, displayName: true } });
              assert.equal(pgUsers.some(row => row.name === OM && row.role === "OM"), present);
              assert.equal(pgUsers.some(row => row.name === LD && row.role === "LD"), present);
              assert.equal(pgNotes.some(row => (row.displayName || row.instructorName).trim() === INSTRUCTOR), present);
              const before = await raw(), start = Date.now();
              const result = await attributed(() => store(value)); // No repository scope, actual frozen/current writer.
              const end = Date.now(), state = await raw(), rows = staging(state);
              assert.equal(rows.DataImportRun.length, 1); assert.equal(rows.OperationSourceRecord.length, 2);
              const run = rows.DataImportRun[0];
              const children = [...rows.OperationSourceRecord].sort((a, b) => Number(a.sourceRowNumber) - Number(b.sourceRowNumber));
              assert.match(result.id, UUID); assert.equal(run.id, result.id);
              const generatedIds = [result.id, ...children.map(row => String(row.id))];
              assert.equal(new Set(generatedIds).size, 3);
              const fixedIds = new Set(Object.values(data).flat().map(row => row.id));
              for (const uuid of generatedIds) { assert.match(uuid, UUID); assert.equal(fixedIds.has(uuid), false); }
              const phase = `unscoped ${source}/${present ? "present" : "missing"}`;
              const expectedErrors = [present ? [] : unknownErrors({ om: OM, ld: LD, instructors: INSTRUCTOR }),
                ["synthetic parser error first", ...unknownErrors(missing)]];
              for (const [index, row] of children.entries()) {
                assert.equal(row.importRunId, result.id); assert.equal(row.operationSessionId, null);
                assert.equal(row.sourceRowNumber, value.parsed.rows[index].rowNumber);
                assert.equal(row.sourceFingerprint, value.parsed.rows[index].sourceFingerprint);
                assert.deepEqual(row.validationErrors, expectedErrors[index]);
              }
              const checkTime = (timestamp: unknown) => {
                assert.ok(timestamp instanceof Date);
                assert.ok(timestamp.getTime() >= start && timestamp.getTime() <= end, `${phase}: timestamp outside invocation`);
              };
              checkTime(run.startedAt); checkTime(run.finishedAt);
              for (const row of children) checkTime(row.createdAt);
              assert.deepEqual([result.rowCount, result.storedCount, result.duplicateCount, result.errorCount], [2, 2, 0, present ? 1 : 2]);
              assert.equal(run.successCount, present ? 1 : 0); assert.equal(run.errorCount, result.errorCount);
              assert.deepEqual(run.validationLogs, children.flatMap((row, index) => expectedErrors[index].length
                ? [{ rowNumber: row.sourceRowNumber, errors: expectedErrors[index] }] : []));
              for (const model of MODELS.filter(model => !STAGING.some(stagingModel => stagingModel === model)))
                assert.deepEqual(state[model], before[model], `${phase}: validation lookup must not write ${model}`);
              for (const model of STAGING) assert.equal(JSON.stringify(state[model]).includes(PRIVATE), false);
              // Same predeclared UUID/time-only normalization as the main parity
              // suite. All other run/row fields and JSON insertion order survive.
              compare(backend, phase, {
                result: { ...result, id: `${phase}:run` },
                run: { ...run, id: `${phase}:run`, startedAt: `${phase}:startedAt`, finishedAt: `${phase}:finishedAt`, validationLogs: JSON.stringify(run.validationLogs) },
                records: children.map(row => ({ ...row, id: `${phase}:row:${row.sourceRowNumber}`, importRunId: `${phase}:run`, createdAt: `${phase}:createdAt`,
                  rowSnapshot: JSON.stringify(row.rowSnapshot), mappedFields: JSON.stringify(row.mappedFields),
                  unmappedFields: JSON.stringify(row.unmappedFields), validationErrors: JSON.stringify(row.validationErrors) }))
              });
              assert.deepEqual(alternateCalls, { localRoster: 0, localInstructor: 0, notionRoster: 0 });
              assert.equal(fetchTripwire.mock.callCount(), 0, "no external fetch, even if its failure was swallowed");
            }
          } finally {
            if (previousSource === undefined) delete process.env.OPERATION_DATA_SOURCE;
            else process.env.OPERATION_DATA_SOURCE = previousSource;
          }
        });

      await suite.test(`${backend}: valid/invalid/mixed/duplicates/replay/cross-source and all logical fields`, async () => {
        await seed(fixture());
        const ids = new Map<string, string>();
        const phases = new Map<string, string>();
        const used = new Set<string>();
        const fixedIds = new Set(Object.values(fixture()).flat().map(row => row.id));
        let previousEnd = 0;
        const register = (uuid: unknown, label: string) => {
          assert.equal(typeof uuid, "string"); assert.match(uuid as string, UUID);
          assert.equal(used.has(uuid as string), false, "generated UUID must be globally unique");
          assert.equal(fixedIds.has(uuid as string), false, "generated ID must not reuse a fixed identity");
          assert.equal([...ids.values()].includes(label), false, "normalization correspondence must be one-to-one");
          used.add(uuid as string); ids.set(uuid as string, label);
        };
        const normalizedRow = (model: typeof STAGING[number], row: Row): Row => {
          const result = { ...row };
          for (const key of model === "DataImportRun" ? ["id"] : ["id", "importRunId"])
            if (ids.has(String(row[key]))) result[key] = ids.get(String(row[key]));
          const phase = phases.get(String(row.id)); assert.ok(phase);
          for (const key of model === "DataImportRun" ? ["startedAt", "finishedAt"] : ["createdAt"])
            result[key] = `<${phase}:${key}>`;
          // JSON stringify preserves insertion/array order; deepEqual alone ignores object key order.
          for (const field of info(model).fields.filter(field => field.type === "Json")) result[field.name] = JSON.stringify(row[field.name]);
          return result;
        };
        const cases: Array<[string, StoreImportInput, [number, number, number, number]]> = [
          ["valid", input([parsedRow(2)]), [1, 1, 0, 0]],
          ["invalid", input([parsedRow(3, { mappedFields: { om: `${PRIVATE}_UNKNOWN_OM`, ld: "", instructors: `${PRIVATE}_UNKNOWN_INSTRUCTOR` },
            validationErrors: ["synthetic first parser error", "synthetic second parser error"] })]), [1, 1, 0, 1]],
          ["mixed", input([parsedRow(4), parsedRow(5, { mappedFields: {}, validationErrors: ["synthetic parser error"] })]), [2, 2, 0, 1]],
          ["upload duplicate", input([parsedRow(6), parsedRow(7, { sourceFingerprint: "synthetic-fingerprint-6", validationErrors: ["discarded duplicate error"] })]), [2, 1, 1, 1]],
          ["replay", input([parsedRow(2)]), [1, 0, 1, 1]],
          ["new team", input([parsedRow(2)], { sourceTeam: "TEAM_2" }), [1, 1, 0, 0]],
          ["new name", input([parsedRow(2)], { sourceName: `${PRIVATE}_OTHER` }), [1, 1, 0, 0]],
          ["new type", input([parsedRow(2)], { sourceType: "synthetic-csv" }), [1, 1, 0, 0]],
          ["sheet is not duplicate scope", input([parsedRow(2)], { sourceSheet: "다른 시트" }), [1, 0, 1, 1]],
          ["workbook is not duplicate scope", input([parsedRow(2)], { sourceWorkbook: `${PRIVATE}_OTHER_BOOK` }), [1, 0, 1, 1]],
          ["empty run", input([], { fileName: undefined }), [0, 0, 0, 0]],
          ["empty instructor", input([parsedRow(8, { mappedFields: { ...parsedRow(8).mappedFields, instructors: "" } })]), [1, 1, 0, 0]],
          ["fallback instructor", input([parsedRow(9, { mappedFields: { ...parsedRow(9).mappedFields, instructors: `${PRIVATE}_FALLBACK` } })]), [1, 1, 0, 0]],
          ["display overrides canonical instructor", input([parsedRow(10, { mappedFields: { ...parsedRow(10).mappedFields, instructors: `${PRIVATE}_CANONICAL` } })]), [1, 1, 0, 1]]
        ];
        for (const [label, value, counts] of cases) {
          await delay(2);
          const start = Date.now(); assert.ok(start > previousEnd);
          const before = await raw();
          const result = await attributed(() => store(value));
          const end = Date.now();
          assert.deepEqual([result.rowCount, result.storedCount, result.duplicateCount, result.errorCount], counts);
          const state = await raw(), rows = staging(state);
          for (const model of STAGING) for (const existing of before[model]) {
            const key = backend === "mongo" ? "_id" : "id";
            assert.deepEqual(state[model].find(row => row[key] === existing[key]), existing, "old staging rows remain byte-identical after a later upload");
          }
          const run = rows.DataImportRun.find(row => row.id === result.id); assert.ok(run);
          const children = rows.OperationSourceRecord.filter(row => row.importRunId === result.id);
          assert.equal(children.length, result.storedCount);
          register(run.id, `${label}:run`); phases.set(String(run.id), label);
          for (const row of children) {
            assert.equal(row.importRunId, result.id); assert.equal(row.operationSessionId, null);
            assert.ok(value.parsed.rows.some(candidate => candidate.sourceFingerprint === row.sourceFingerprint && candidate.rowNumber === row.sourceRowNumber));
            register(row.id, `${label}:row:${row.sourceRowNumber}`); phases.set(String(row.id), label);
          }
          for (const [row, fields] of [[run, ["startedAt", "finishedAt"]], ...children.map(row => [row, ["createdAt"]])] as Array<[Row, string[]]>)
            for (const field of fields) {
              assert.ok(row[field] instanceof Date);
              assert.ok((row[field] as Date).getTime() >= start && (row[field] as Date).getTime() <= end, `${label}.${field}: real call interval`);
              assert.ok((row[field] as Date).getTime() > previousEnd, `${label}.${field}: must follow the preceding completed invocation`);
            }
          previousEnd = end;
          assert.equal(run.rowCount, Number(run.successCount) + Number(run.errorCount));
          assert.equal(run.rowCount, children.length + result.duplicateCount);
          const erroneous = children.filter(row => Array.isArray(row.validationErrors) && row.validationErrors.length > 0).length;
          assert.equal(run.errorCount, erroneous + result.duplicateCount); assert.equal(run.successCount, children.length - erroneous);
          for (const model of MODELS.filter(model => !STAGING.some(stagingModel => stagingModel === model)))
            assert.deepEqual(state[model], before[model], `${model}: staging must not mutate related models or emit mutation audits`);
          for (const model of STAGING) assert.equal(JSON.stringify(state[model]).includes(PRIVATE), false, `${model}: private marker in raw storage`);
          compare(backend, `${label}:result`, { ...result, id: ids.get(result.id) });
          const detail = await noWrite(() => repo.getImportRunById(result.id)); assert.ok(detail);
          assert.equal(detail.startedAt, dtoDate(run.startedAt as Date)); assert.equal(detail.finishedAt, dtoDate(run.finishedAt as Date));
          for (const row of detail.records) {
            const original = children.find(child => child.id === row.id); assert.ok(original);
            assert.equal(row.createdAt, dtoDate(original.createdAt as Date));
          }
          compare(backend, `${label}:detail`, { ...detail, id: ids.get(detail.id), startedAt: `<${label}:startedAt>`, finishedAt: `<${label}:finishedAt>`,
            records: detail.records.map(row => ({ ...row, id: ids.get(row.id), createdAt: `<${label}:createdAt>` })) });
          for (const model of STAGING) compare(backend, `${label}:${model}`, rows[model].map(row => normalizedRow(model, row))
            .sort((a, b) => String(a.id).localeCompare(String(b.id))));
          const list = await noWrite(() => repo.listImportRuns());
          const expectedOrder = [...rows.DataImportRun].sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime() || String(b.id).localeCompare(String(a.id)));
          assert.deepEqual(list.map(row => row.id), expectedOrder.map(row => row.id));
          assert.equal(list.find(row => row.id === result.id)?.sourceRecordCount, children.length);
        }
        const duplicateKey = input([parsedRow(50), parsedRow(50, { sourceFingerprint: "different-fingerprint-same-unique-row" })]);
        await noWrite(() => assert.rejects(() => attributed(() => store(duplicateKey)), backend === "mongo" ? safeMongoError : (error: unknown) => {
          assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
          assert.equal(error.code, "P2002", "a native unique violation, not an unrelated validation error");
          return true;
        }));
        await rejectNoWrite(() => attributed(() => store(input([parsedRow(51)], { sourceSheet: null as unknown as string }))));
        assert.equal((await raw()).ActivityChange.length, 0);
      });

      await suite.test(`${backend}: frozen read DTO, nulls, JSON order, previews, links and UUID syntax`, async () => {
        const data = fixture();
        data.DataImportRun = [seedRun(100, { status: "PENDING", sourceTeam: "UNKNOWN", validationLogs: { z: 1, a: 2 } }),
          seedRun(101, { status: "COMPLETED_WITH_ERRORS", sourceTeam: "TEAM_2", fileName: "", notes: "", importedBy: "", finishedAt: OLD }),
          seedRun(102, { status: "FAILED", startedAt: new Date("2020-01-02T00:00:00Z"), validationLogs: [] })];
        const thirteen = Object.fromEntries([...Array.from({ length: 12 }, (_, n) => [`z${12 - n}`, `value-${n}`]),
          ["companyName", "Synthetic company"], ["courseName", "Synthetic course"], ["startDate", "2030-01-01"], ["endDate", "2030-01-02"]]);
        const ordered = { empty: "  ", nil: null, z: false, a: 0, nested: { z: 1, a: ["z", "a"] }, array: ["z", "a"],
          x9: "9", x8: "8", x7: "7", x6: "6", x5: "5", x4: "4", x3: "3", x2: "2", x1: "1" };
        data.OperationSourceRecord = [
          seedRow(200, 100, { mappedFields: thirteen, rowSnapshot: ordered, unmappedFields: ordered, sourceFingerprint: null, headerRowNumber: null }),
          seedRow(201, 100, { mappedFields: MongoDbNull, unmappedFields: MongoDbNull, validationErrors: MongoDbNull }),
          seedRow(202, 100, { mappedFields: ["not-an-object"], rowSnapshot: ["array"], unmappedFields: [], validationErrors: [3, "first", null, "second"] }),
          seedRow(203, 100, { operationSessionId: id(3), mappedFields: { courseName: "linked incomplete" } }),
          seedRow(204, 100, { operationSessionId: id(4), mappedFields: { courseName: "soft-deleted linked" } }),
          seedRow(205, 100, { operationSessionId: id(3), mappedFields: {}, validationErrors: [] }),
          seedRow(206, 100, { mappedFields: ordered, unmappedFields: MongoJsonNull, rowSnapshot: MongoJsonNull }),
          seedRow(207, 100, { mappedFields: thirteen, validationErrors: ["must win over complete fields"] })
        ];
        await seed(data);
        const before = await raw();
        const list = await noWrite(() => repo.listImportRuns());
        assert.deepEqual(list.map(row => row.id), [id(102), id(101), id(100)]);
        assert.equal(list[1].fileName, ""); assert.equal(list[2].fileName, `${PRIVATE}_SOURCE`);
        assert.equal(list[2].sourceRecordCount, 8); assert.equal(list[2].validationLogCount, 2);
        compare(backend, "fixed list", list);
        const detail = await noWrite(() => repo.getImportRunById(id(100))); assert.ok(detail);
        compare(backend, "fixed detail", detail);
        const byId = (n: number) => { const row = detail.records.find(row => row.id === id(n)); assert.ok(row); return row; };
        assert.equal(byId(200).mappedFieldCount, 12); assert.equal(byId(200).unmappedFieldCount, 12);
        assert.equal(byId(200).rowSnapshotPreview.length, 8); assert.deepEqual(byId(200).missingRequiredFields, []);
        assert.equal(byId(200).reviewStatus, "적용 준비"); assert.equal(byId(200).linkedOperation, null);
        assert.equal(byId(200).sourceFingerprint, ""); assert.equal(byId(200).headerRowNumber, null);
        assert.deepEqual(byId(200).mappedFields.map(field => field.key), Object.keys(thirteen).slice(0, 12));
        assert.deepEqual(byId(200).rowSnapshotPreview.map(field => field.key), ["z", "a", "nested", "array", "x9", "x8", "x7", "x6"]);
        assert.deepEqual(byId(202).validationErrors, ["first", "second"]);
        for (const n of [201, 202, 205, 207]) assert.equal(byId(n).reviewStatus, "확인 필요");
        for (const n of [203, 204]) { assert.equal(byId(n).reviewStatus, "적용 준비"); assert.ok(byId(n).linkedOperation); }
        assert.equal(byId(206).reviewStatus, "매칭 필요");
        assert.equal(byId(206).mappedFields.find(field => field.key === "nested")?.value, '{"z":1,"a":["z","a"]}');
        assert.equal(await noWrite(() => repo.getImportRunById(id(999))), null);
        for (const value of aliases(id(100))) assert.deepEqual(await noWrite(() => repo.getImportRunById(value)), detail);
        for (const value of ["", " ", "not-a-uuid", ` ${id(100)}`, `${id(100)} `, "aab-bccdd093040008000000000000100"])
          await noWrite(() => assert.rejects(() => repo.getImportRunById(value), (error: unknown) => {
            assert.ok(error instanceof Error);
            if (backend === "mongo") { safeMongoError(error); assert.equal((error as MongoOperationError).code, "IMPORT_INVALID_UUID"); }
            return true;
          }));
        assert.deepEqual(await raw(), before);
      });

      await suite.test(`${backend}: 199/200/201, Korean sheet/numeric row ordering and permitted boundary ties`, async () => {
        for (const count of [199, 200, 201]) {
          const data = fixture(); data.DataImportRun = [seedRun(110)];
          data.OperationSourceRecord = Array.from({ length: count }, (_, n) => seedRow(1000 + n, 110, {
            sourceSheet: ["하", "가", "A", "나"][n % 4], sourceRowNumber: count - n
          }));
          await seed(data);
          const sorted = [...data.OperationSourceRecord].sort((a, b) => String(a.sourceSheet).localeCompare(String(b.sourceSheet), "ko") || Number(a.sourceRowNumber) - Number(b.sourceRowNumber));
          const detail = await noWrite(() => repo.getImportRunById(id(110))); assert.ok(detail);
          assert.equal(detail.sourceRecordCount, count); assert.equal(detail.records.length, Math.min(count, 200));
          assert.deepEqual(detail.records.map(row => row.id), sorted.slice(0, 200).map(row => row.id));
          compare(backend, `limit ${count}`, detail);
        }
        const data = fixture(); data.DataImportRun = [seedRun(111)];
        const tied = ["가", "\u1100\u1161"];
        assert.equal(tied[0].localeCompare(tied[1], "ko"), 0, "native ICU must witness a genuine collation tie");
        data.OperationSourceRecord = Array.from({ length: 199 }, (_, n) => seedRow(2000 + n, 111, { sourceSheet: tied[0], sourceRowNumber: n + 1 }));
        data.OperationSourceRecord.push(...tied.map((sheet, n) => seedRow(2200 + n, 111, { sourceSheet: sheet, sourceRowNumber: 200 })),
          seedRow(2202, 111, { sourceSheet: tied[0], sourceRowNumber: 201 }));
        await seed(data);
        const detail = await noWrite(() => repo.getImportRunById(id(111))); assert.ok(detail);
        assert.equal(detail.sourceRecordCount, 202); assert.equal(detail.records.length, 200);
        assert.equal(new Set(detail.records.map(row => row.id)).size, 200);
        assert.deepEqual(detail.records.slice(0, 199).map(row => row.id), data.OperationSourceRecord.slice(0, 199).map(row => row.id));
        assert.ok([id(2200), id(2201)].includes(detail.records[199].id));
        assert.equal(detail.records.some(row => row.id === id(2202)), false);
        // Compare only the strict prefix; the last identity has two explicitly permitted outcomes.
        compare(backend, "boundary strict prefix", detail.records.slice(0, 199));
        assert.equal(detail.records[199].sourceRowNumber, 200);
        assert.equal(detail.records[199].sourceFingerprint, detail.records[199].id === id(2200) ? "synthetic-2200" : "synthetic-2201");
        // Obtain BOTH tie-member DTOs from the frozen reader without a limit,
        // then validate the chosen complete DTO against that allowed set.
        const tieOnly = fixture(); tieOnly.DataImportRun = [seedRun(111)];
        tieOnly.OperationSourceRecord = data.OperationSourceRecord.filter(row => [id(2200), id(2201)].includes(String(row.id)));
        await seed(tieOnly);
        const allTies = await noWrite(() => repo.getImportRunById(id(111))); assert.ok(allTies);
        for (const row of allTies.records) compare(backend, `boundary candidate ${row.id}`, row);
        assert.deepEqual(detail.records[199], allTies.records.find(row => row.id === detail.records[199].id));
      });

      if (backend === "mongo") await suite.test("Mongo authenticated source candidates, late tamper and broken required relations fail without writes", async () => {
        const data = fixture(); data.DataImportRun = [seedRun(120)];
        data.OperationSourceRecord = [seedRow(3000, 120, { operationSessionId: id(3) })];
        await seed(data);
        // A valid-length wrong HMAC must not hide an existing source behind a
        // narrowed-query miss. This targets the run, not the roster key lookup.
        await mongoStore.collection("DataImportRun").updateOne({ _id: id(120) }, { $set: { sourceNamePiiIndex: "0".repeat(64) } });
        await noWrite(() => assert.rejects(() => attributed(() => store(input([parsedRow(3000, { sourceFingerprint: "synthetic-3000" })]))), safeMongoError));
        await noWrite(() => assert.rejects(() => repo.listImportRuns(), safeMongoError));
        await seed(data);
        for (const field of ["PII_INDEX_KEY", "PII_ENCRYPTION_KEYS"] as const) {
          const previous = process.env[field];
          process.env[field] = field === "PII_INDEX_KEY" ? randomBytes(32).toString("base64") : JSON.stringify({ fixture: randomBytes(32).toString("base64") });
          try { await noWrite(() => assert.rejects(() => repo.getImportRunById(id(120)), safeMongoError)); }
          finally { process.env[field] = previous; }
        }
        for (const [model, missing, code] of [
          ["OperationSession", 3, "IMPORT_MISSING_OPERATION"], ["Course", 2, "IMPORT_MISSING_COURSE"], ["Company", 1, "IMPORT_MISSING_COMPANY"]] as const) {
          await seed(data);
          await mongoStore.collection(model).deleteOne({ _id: id(missing) });
          await noWrite(() => assert.rejects(() => repo.getImportRunById(id(120)), error => {
            safeMongoError(error); assert.equal((error as MongoOperationError).code, code); return true;
          }));
        }
        await seed(data);
        const late = seedRow(3201, 120, { sourceRowNumber: 9999 });
        const encoded = encodeMongoRuntimeDocument("OperationSourceRecord", late);
        const snapshot = encoded.rowSnapshot as { $json: { __pii: string } };
        const parts = snapshot.$json.__pii.split(":");
        parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
        snapshot.$json.__pii = parts.join(":");
        await mongoStore.collection("OperationSourceRecord").insertMany([
          ...Array.from({ length: 200 }, (_, n) => encodeMongoRuntimeDocument("OperationSourceRecord", seedRow(4000 + n, 120, { sourceRowNumber: n + 1 }))), encoded
        ]);
        await noWrite(() => assert.rejects(() => repo.getImportRunById(id(120)), safeMongoError));
      });

      if (backend !== "mongo") await suite.test(`${backend}: native PG duplicate race, both reads before either commit`, async () => {
        await seed(fixture());
        // BEFORE INSERT is reached only after the real duplicate SELECT completes.
        // Shared xact locks let both continue after the coordinator releases its
        // exclusive lock. No mocked query, inferred sleep ordering or retries.
        await sql.query(`CREATE FUNCTION import_parity_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN PERFORM pg_advisory_xact_lock_shared(20260930, 29); RETURN NEW; END $$;
          CREATE TRIGGER import_parity_barrier BEFORE INSERT ON data_import_runs
          FOR EACH ROW EXECUTE FUNCTION import_parity_barrier()`);
        const pending: Array<Promise<PromiseSettledResult<StoreImportResult>>> = [];
        const settle = (work: Promise<StoreImportResult>) => work.then(value => ({ status: "fulfilled", value }) as const,
          reason => ({ status: "rejected", reason }) as const);
        try {
          await sql.query("SELECT pg_advisory_lock(20260930,29)");
          pending.push(settle(attributed(() => store(input([parsedRow(70)])))));
          pending.push(settle(attributed(() => store(input([parsedRow(70)])))));
          const deadline = performance.now() + 1800;
          let witnessed = false;
          while (performance.now() < deadline) {
            const blocked = await sql.query("SELECT DISTINCT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND l.classid=20260930 AND l.objid=29 AND a.datname=current_database()");
            if (blocked.rowCount === 2) { witnessed = true; break; }
            await delay(10);
          }
          assert.equal(witnessed, true, "both real transactions must reach post-duplicate-read barrier");
          await sql.query("SELECT pg_advisory_unlock(20260930,29)");
          const outcomes = await Promise.all(pending);
          const returnedIds: string[] = [];
          for (const result of outcomes) {
            assert.equal(result.status, "fulfilled", "the frozen PG permits BOTH independent runs; timeout/conflict is not success");
            if (result.status === "fulfilled") {
              assert.match(result.value.id, UUID); returnedIds.push(result.value.id);
              assert.deepEqual(Object.keys(result.value).sort(), ["duplicateCount", "errorCount", "id", "rowCount", "storedCount"]);
              assert.deepEqual([result.value.rowCount, result.value.storedCount, result.value.duplicateCount, result.value.errorCount], [1, 1, 0, 0]);
            }
          }
          const rows = staging(await raw());
          assert.equal(rows.DataImportRun.length, 2); assert.equal(rows.OperationSourceRecord.length, 2);
          assert.deepEqual(new Set(returnedIds), new Set(rows.DataImportRun.map(row => row.id)));
          assert.equal(new Set(rows.DataImportRun.map(row => row.id)).size, 2);
          assert.equal(new Set(rows.OperationSourceRecord.map(row => row.id)).size, 2);
          assert.equal(new Set(rows.OperationSourceRecord.map(row => row.importRunId)).size, 2);
          for (const row of rows.OperationSourceRecord) assert.ok(rows.DataImportRun.some(run => run.id === row.importRunId));
          const replay = await attributed(() => store(input([parsedRow(70)])));
          assert.equal(replay.storedCount, 0); assert.equal(replay.duplicateCount, 1);
          assert.equal((await raw()).DataImportRun.length, 3); assert.equal((await raw()).OperationSourceRecord.length, 2);
          assert.equal((await raw()).ActivityChange.length, 0);
          suite.diagnostic(`${backend}: witnessed two native PG advisory waiters; both commits and post-commit duplicate-only replay required`);
        } finally {
          await sql.query("SELECT pg_advisory_unlock(20260930,29)");
          await Promise.all(pending);
          await sql.query("DROP TRIGGER import_parity_barrier ON data_import_runs; DROP FUNCTION import_parity_barrier()");
        }
      });
    }
    suite.diagnostic("Repository coverage only; Mongo concurrency/retry/unknown-commit, scope/handler/page/request audits and scan budgets belong to separate suites. No unexecuted coverage is claimed.");
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
      ...alternateTripwires.map(tripwire => Promise.resolve().then(() => tripwire.restore()))
    ]);
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    const failed = cleanup.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed.length) throw new AggregateError(failed.map(result => result.reason), "owned synthetic import stores cleanup failed");
  }
});
