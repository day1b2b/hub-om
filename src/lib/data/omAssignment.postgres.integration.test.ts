/**
 * Repository-level parity against the byte-frozen original PG implementation.
 * Run alone against an empty disposable PG schema, Node 24, env -i, and BOTH
 * exact test URLs below. No dotenv, product mocks or external service calls.
 * V01–V08 plus real PG original/newPG assignment/restore barriers (V10).
 * Mongo cross-writer, HTTP and UI contracts are tested by separate suites.
 * Existing PG decryptRow does not authenticate blind-index companions on read;
 * corrupt-index rejection is Mongo-only, not three-backend equivalence.
 *
 * PREDECLARED COMPARISON CONTRACT:
 * - request signature: 8 fields; operation signature: 7 fields (explicit below).
 * - preserve undefined/absent/null, business fields, array order and event multiplicity.
 * - SQL enum storage names -> Prisma enum names; Decimal -> fixed-two string;
 *   BSON JSON tags -> the corresponding logical JSON value. No other value coercion.
 * - generated audit UUID -> unique (requestId,targetType,targetId,action) event label;
 *   assert actual UUID uniqueness and forbid duplicate event keys BEFORE normalization.
 * - generated occurredAt and changed OperationSession.updatedAt -> phase labels ONLY
 *   after proving real invocation bounds, original seed replacement, untouched-row
 *   timestamp preservation, and event/target correspondence. Within-phase timestamp
 *   ties vs distinct milliseconds are allowed (Prisma/JS clocks differ); cross-phase
 *   order and causal target correspondence are preserved, never arbitrary time deletion.
 * - token equality is asserted on identical fixed INITIAL seeds/Date.now/secret.
 *   Post-write tokens use real per-backend updatedAt and are not normalized/comparable.
 * - no-op/failed calls compare ALL raw bytes (including old audits). Only a successful
 *   complete no-op may change the pre-existing internal restore-guard nonce.
 * - HTTP status/followups are not asserted by this repository-only test.
 */
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { mock, test } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import pg from "pg";
import { MongoClient } from "mongodb";
import { activityContext } from "../activity/context";
import { decryptField, privacyFields } from "../privacy/fields";
import { completeMongoRow, MongoOperationStore, operationMongoValidator } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import type { OmRequest } from "./omRequest/omRequestTypes";

const PG_URL = "postgresql://synthetic@127.0.0.1:56719/om_assignment_parity";
const MONGO_URI = "mongodb://127.0.0.1:27819/?replicaSet=omassignment20260929";
const pgUrl = process.env.OM_ASSIGNMENT_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_OM_ASSIGNMENT_TEST_URI;
const ORACLE_SHA = "e589d9cce20ba14c1b1d5340fe65b23863b55fd3f7022e0684420a502944e5f5";
const oracleFile = new URL("./omRequest/omAssignmentOriginal.fixture.ts", import.meta.url);
const id = (n: number) => `a5519abc-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OLD = new Date("2020-01-01T00:00:00.000Z");
const FIXED_NOW = Date.parse("2030-01-01T00:00:00.000Z");
const SECRET = "SYNTHETIC_ASSIGNMENT_SECRET_ONLY";
const FALLBACK = "SYNTHETIC_ASSIGNMENT_FALLBACK_ONLY";
const ACTOR = "synthetic-assignment@example.invalid", ACTOR_NAME = "SYNTHETIC_PRIVATE_ACTOR";
const X = "SYNTHETIC_PRIVATE_OM_X", Y = "SYNTHETIC_PRIVATE_OM_Y";
const MARKERS = [ACTOR, ACTOR_NAME, X, Y, "SYNTHETIC_PRIVATE_MANUAL", "SYNTHETIC_PRIVATE_ACCOUNT",
  "SYNTHETIC_PRIVATE_NOTES", "SYNTHETIC_PRIVATE_LOCATION", "SYNTHETIC_PRIVATE_LD", "SYNTHETIC_PRIVATE_INSTRUCTOR",
  "SYNTHETIC_PRIVATE_WORKBOOK", "synthetic-ld@example.invalid", SECRET, FALLBACK];
const MODELS = ["Company", "Course", "DataImportRun", "OperationSession", "OperationSourceRecord", "OmRequest", "ActivityChange"] as const;
type Model = typeof MODELS[number];
type Row = Record<string, unknown>;
type Seed = Record<Model, Row[]>;
type Backend = "original" | "pg" | "mongo";
type Preview = { token: string; count: number; operations: { operationId: string; roundNo: string | null; omName: string | null; omUserId: string | null }[]; assignedOm: string | null; nextOm: string | null };
interface AssignmentApi {
  previewOmAssignment(existing: OmRequest, nextOm: string | null, actor: string): Promise<Preview>;
  assignOmRequestAtomically(existing: OmRequest, nextOm: string | null, actor: string, token: string): Promise<{ updated: OmRequest; operationIds: string[] }>;
}
type Snapshot = { rows: Record<Model, Row[]>; internal: Record<string, Row[]> };
const dmmf = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
// Prisma's runtime DMMF omits enum definitions. Read the committed SQL mapping
// independently from schema; do not reuse the Mongo codec's enum conversion.
const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const enums = new Map([...schema.matchAll(/^enum (\w+)\s*\{([^}]+)\}/gm)].map(([, name, body]) => [name,
  new Map([...body.matchAll(/^\s*(\w+)\s*(?:@map\("([^"]+)"\))?\s*$/gm)].map(([, value, stored]) => [stored ?? value, value]))]));
const listFields = new Map([...schema.matchAll(/^model (\w+)\s*\{([^}]+)\}/gm)].map(([, name, body]) => [name,
  new Set([...body.matchAll(/^\s*(\w+)\s+\w+\[\]/gm)].map(([, field]) => field))]));
const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
function modelInfo(model: Model) { const info = dmmf.get(model); assert.ok(info); return info; }
function table(model: Model) { return modelInfo(model).dbName ?? model; }
function logical(model: Model, raw: Row, mongo: boolean): Row {
  const decoded = mongo ? decodeMongoRuntimeDocument(model, raw) : undefined;
  const out: Row = {};
  const fields = modelInfo(model).fields.filter(field => field.kind !== "object");
  if (!mongo) assert.deepEqual(Object.keys(raw).sort(), fields.map(field => field.dbName ?? field.name).sort(), `${model}: SQL schema drift`);
  for (const field of fields) {
    if (field.name.endsWith("PiiIndex") || field.name.endsWith("Encrypted")) continue;
    let value = mongo ? decoded![field.name] : raw[field.dbName ?? field.name];
    if (!mongo && privacyFields[model]?.fields[field.name]) value = decryptField(model, field.name, value);
    if (value === MongoDbNull || value === MongoJsonNull) value = null;
    if (!mongo && value !== null && field.kind === "enum") {
      const enumeration = enums.get(field.type); assert.ok(enumeration);
      const match = enumeration.get(String(value)); assert.ok(match, `unknown SQL enum ${field.type}`); value = match;
    }
    if (value !== null && field.type === "DateTime") value = listFields.get(model)?.has(field.name)
      ? (value as unknown[]).map(item => new Date(item as string)) : new Date(value as string);
    if (value !== null && field.type === "Decimal") value = new Prisma.Decimal(String(value)).toFixed(2);
    out[field.name] = value;
  }
  return out;
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function signedJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(signedJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${signedJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const pick = (row: Row, names: readonly string[]) => Object.fromEntries(names.map(name => [name, row[name]]));
function expectedToken(seed: Seed, next: string | null, actor = ACTOR, secret = SECRET, expires = FIXED_NOW + 600_000) {
  const snapshot = {
    request: pick(seed.OmRequest[0], ["id", "team", "status", "assignedOm", "operationId", "totalSessions", "sessions", "createdAt"]),
    operations: seed.OperationSession.filter(row => row.id !== id(204)).sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(row => pick(row, ["id", "operationId", "roundNo", "omName", "omUserId", "operationStatus", "updatedAt"]))
  };
  return `${expires}.${createHmac("sha256", secret).update(signedJson({ purpose: "om-assignment-confirm-v1", expires,
    actor: actor.trim().toLowerCase(), nextOm: next?.trim() || null, snapshot })).digest("hex")}`;
}
function fixture(): Seed {
  const seed = Object.fromEntries(MODELS.map(model => [model, []])) as unknown as Seed;
  const add = (model: Model, fields: Row) => { const row = completeMongoRow(model, fields); seed[model].push(row); return row; };
  add("Company", { id: id(1), name: "Synthetic company", normalizedName: "synthetic-company", createdAt: OLD, updatedAt: OLD });
  for (const [n, name] of [[101, "Synthetic current course"], [102, "Synthetic destination course"]] as const)
    add("Course", { id: id(n), companyId: id(1), processSeq: n, courseId: "533", name, operationType: "LONG", createdAt: OLD, updatedAt: OLD });
  add("DataImportRun", { id: id(300), sourceType: "synthetic", sourceName: "Synthetic source", status: "COMPLETED",
    sourceTeam: "UNKNOWN", rowCount: 0, successCount: 0, errorCount: 0, startedAt: OLD });
  for (const n of [203, 201, 204, 202]) add("OperationSession", {
    id: id(n), operationId: `synthetic-op-${n}`, courseRecordId: id(101), startDate: OLD, endDate: OLD, educationDates: [],
    operationStatus: n === 203 ? "DONE" : n === 202 ? "ASSIGNMENT_PLANNED" : "ASSIGNMENT_NEEDED",
    archiveStatus: "NOT_READY", educationFormat: "NEEDS_REVIEW", operationChannel: "NEEDS_REVIEW", onsiteRequired: "UNKNOWN",
    hasSatisfactionSurvey: "NEEDS_REVIEW", hasResultReport: "NEEDS_REVIEW", roundNo: String(n - 200),
    omName: "SYNTHETIC_PRIVATE_MANUAL", omUserId: "SYNTHETIC_PRIVATE_ACCOUNT", specialNotes: "SYNTHETIC_PRIVATE_NOTES",
    createdAt: OLD, updatedAt: OLD
  });
  add("OperationSourceRecord", { id: id(400), importRunId: id(300), operationSessionId: id(201), sourceTeam: "UNKNOWN",
    sourceWorkbook: "SYNTHETIC_PRIVATE_WORKBOOK", sourceSheet: "synthetic", sourceRowNumber: 1,
    rowSnapshot: { synthetic: "source" }, mappedFields: { courseName: "Synthetic destination course" }, createdAt: OLD });
  add("OmRequest", { id: id(10), createdAt: OLD, status: "배정완료", assignedOm: X, operationId: "synthetic-op-201",
    team: "synthetic-team", ld: "SYNTHETIC_PRIVATE_LD", company: "Synthetic company", trainingType: "해커톤", courseId: "533",
    courseName: "Synthetic current course", courseCategory: "synthetic-category", instructorName: "SYNTHETIC_PRIVATE_INSTRUCTOR",
    syncupLink: "https://example.invalid/synthetic-sync", driveLink: "https://example.invalid/synthetic-drive",
    skillfloSetup: "N", skillmatchSetup: "N", onSiteOperation: "N", coachRequest: "N", resultReportNeeded: "N",
    totalSessions: 3, sessions: [1, 2, 3].map(n => ({ date: `2030-02-0${n}`, timeStart: "09:00", timeEnd: "10:00", duration: "1", location: "SYNTHETIC_PRIVATE_LOCATION" })),
    notes: "SYNTHETIC_PRIVATE_NOTES", ldEmail: "synthetic-ld@example.invalid" });
  for (const [n, targetType, targetId] of [[501, "om_requests", id(10)], [502, "operation_sessions", id(201)],
    [503, "operation_sessions", id(202)], [504, "operation_sessions", id(203)], [505, "operation_sessions", id(204)]] as const)
    add("ActivityChange", { id: id(n), occurredAt: OLD, requestId: id(n === 505 ? 901 : 900), actorEmail: ACTOR, actorName: ACTOR_NAME,
      actorType: "user", route: "/api/om-request", method: "POST", targetType, targetId, action: "create", changes: { om_name: { redacted: true } } });
  return seed;
}
// Independent DTO: all optional properties remain present-undefined, matching frozen mapping.
function existingDto(seed: Seed): OmRequest {
  const row = seed.OmRequest[0], out = { ...row };
  out.createdAt = (row.createdAt as Date).toISOString();
  for (const key of ["assignedOm", "operationId", "ldEmail", "slackChannel", "slackThreadTs", "businessNumber", "courseCategoryMajor", "tools"])
    out[key] = row[key] ?? undefined;
  return out as unknown as OmRequest;
}
function noCompanions(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) { assert.ok(!key.endsWith("PiiIndex") && !key.endsWith("Encrypted")); noCompanions(item); }
}
function safeError(error: unknown): error is Error {
  assert.ok(error instanceof Error);
  for (const marker of MARKERS) assert.ok(!error.message.includes(marker), "sensitive error message");
  return true;
}
function auditKey(row: Row) { return [row.requestId, row.targetType, row.targetId, row.action].join("|"); }
function assertPrivacy(model: Model, raw: Row, row: Row, mongo: boolean, indexKey: string) {
  for (const marker of MARKERS) assert.ok(!JSON.stringify(raw).includes(marker), `${model}: stored private marker`);
  for (const [field, policy] of Object.entries(privacyFields[model]?.fields ?? {})) {
    const stored = raw[mongo ? (policy.storage ?? field) : (policy.storageColumn ?? policy.column)];
    const plain = row[field];
    if (policy.type === "String" && plain !== null) assert.match(String(stored), /^pii:v1:/);
    if (policy.index) {
      const expected = plain == null ? null : createHmac("sha256", Buffer.from(indexKey, "base64"))
        .update(`${model}.${field}`).update("\0").update(String(plain)).digest("hex");
      assert.equal(raw[mongo ? policy.index : policy.indexColumn!], expected, `${model}.${field}: independent HMAC`);
    }
  }
}

test("V01: frozen assignment source SHA (not a mock oracle)", () => {
  assert.equal(createHash("sha256").update(readFileSync(oracleFile)).digest("hex"), ORACLE_SHA);
});

test("V01–08 and PG V10: frozen original / new PG / Mongo assignment parity", {
  skip: pgUrl === undefined && mongoUri === undefined, timeout: 600_000, concurrency: false
}, async suite => {
  assert.equal(pgUrl, PG_URL); assert.equal(mongoUri, MONGO_URI);
  assert.equal(createHash("sha256").update(readFileSync(oracleFile)).digest("hex"), ORACLE_SHA);
  const root = new URL("../../../prisma/migrations/", import.meta.url);
  const migrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.equal(migrations.length, 45, "baseline migration count changed: review, do not silently relax");
  const migrationSql = migrations.map(name => readFileSync(new URL(`${name}/migration.sql`, root), "utf8"));
  for (const key of ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID",
    "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "AUTH_SECRET", "NEXTAUTH_SECRET", "SLACK_BOT_TOKEN", "NOTION_API_KEY", "SALESMAP_API_TOKEN"])
    assert.equal(process.env[key], undefined, `${key} must not be inherited; use env -i`);
  const env = { TZ: "UTC", DATABASE_URL: PG_URL, OPERATION_DATA_SOURCE: "postgres", AUTH_SECRET: SECRET, NEXTAUTH_SECRET: FALLBACK,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  let tokenClock = FIXED_NOW;
  const clock = mock.method(Date, "now", () => tokenClock); // Only token clock. No fake timers/Prisma engine timestamps.
  const sql = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
  const client = new MongoClient(MONGO_URI, { directConnection: true, serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const options = { client, databaseName: `hub_om_shadow_assignment_pg_${randomBytes(8).toString("hex")}`,
    namespace: `shadow_assignment_${randomBytes(6).toString("hex")}`, allowShadowWrites: true as const };
  let db: PrismaClient | undefined, pgConnected = false, pgOwned = false, mongoOwned = false;
  try {
    const original = await import("./omRequest/omAssignmentOriginal.fixture");
    const newPg = await import("./omRequest/omRequestAssignment");
    const { getPrismaClient } = await import("./prisma");
    const { prepareMongoOmAssignmentStore, MongoOmAssignmentRepository } = await import("./mongoOmAssignmentRepository");
    await sql.connect(); pgConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0], { db: "om_assignment_parity", usr: "synthetic" });
    const occupied = await sql.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    assert.equal(occupied.rowCount, 0, "Refuse populated PG schema; coordinator supplies an empty disposable DB"); pgOwned = true;
    await client.connect(); const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.setName, "omassignment20260929"); assert.equal(hello.isWritablePrimary, true);
    assert.equal((await client.db(options.databaseName).listCollections({}, { nameOnly: true }).toArray()).length, 0); mongoOwned = true;
    await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const migration of migrationSql) await sql.query(migration);
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    db = getPrismaClient(); const prisma = db;
    const delegates = prisma as unknown as Record<string, { createMany(args: { data: Row[] }): Promise<unknown> }>;
    const { prepareMongoReadStore } = await import("./mongoReadStore");
    await prepareMongoReadStore(options, MODELS);
    await prepareMongoOmAssignmentStore(options);
    const mongo: AssignmentApi = await MongoOmAssignmentRepository.open(options);
    const store = new MongoOperationStore(options, MODELS);
    const guardName = `${options.namespace}_CourseNameRestoreGuard`;
    const apis: Record<Backend, AssignmentApi> = { original, pg: newPg, mongo };
    // Real SQL witness: every attributed PG assignment write must actually run at
    // Serializable, not merely pass an option to a mocked Prisma client.
    await sql.query(`CREATE FUNCTION assignment_parity_isolation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (nullif(current_setting('app.activity_context', true),'')::jsonb ->> 'route') = '/api/om-request/assign'
           AND current_setting('transaction_isolation') <> 'serializable' THEN
          RAISE EXCEPTION 'assignment_parity_wrong_isolation';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER assignment_parity_isolation BEFORE UPDATE ON operation_sessions FOR EACH ROW EXECUTE FUNCTION assignment_parity_isolation();
      CREATE TRIGGER assignment_parity_isolation BEFORE UPDATE ON om_requests FOR EACH ROW EXECUTE FUNCTION assignment_parity_isolation()`);
    const conflict = (backend: Backend) => (error: unknown) => {
      safeError(error);
      assert.ok(error instanceof original.OmAssignmentConflict || error instanceof newPg.OmAssignmentConflict,
        `${backend}: expected assignment-domain conflict, not generic driver/codec failure`);
      return true;
    };
    let phase = 0;
    const attributed = <T>(work: () => Promise<T>, event: string) => activityContext.run({ requestId: event,
      actorEmail: ACTOR, actorName: ACTOR_NAME, actorType: "user", route: "/api/om-request/assign", method: "PATCH" }, work);
    async function seedData(backend: Backend, seed: Seed) {
      if (backend === "mongo") {
        for (const model of [...MODELS].reverse()) await store.collection(model).deleteMany({});
        for (const model of MODELS) if (seed[model].length)
          await store.collection(model).insertMany(seed[model].map(row => encodeMongoRuntimeDocument(model, row)));
      } else {
        await sql.query(`TRUNCATE ${MODELS.map(model => q(table(model))).join(",")} RESTART IDENTITY CASCADE`);
        for (const model of MODELS) if (seed[model].length) await delegates[model[0].toLowerCase() + model.slice(1)].createMany({
          data: seed[model].map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
            value === MongoDbNull ? Prisma.DbNull : value === MongoJsonNull ? Prisma.JsonNull : value]))) });
      }
    }
    async function raw(backend: Backend): Promise<Snapshot> {
      const rows = {} as Snapshot["rows"], internal: Snapshot["internal"] = {};
      for (const model of MODELS) rows[model] = backend === "mongo"
        ? await store.collection(model).find({}).sort({ _id: 1 }).toArray()
        : (await sql.query(`SELECT * FROM ${q(table(model))} ORDER BY id`)).rows;
      if (backend === "mongo") for (const entry of await store.db.listCollections({}, { nameOnly: true }).toArray()) {
        if (!MODELS.some(model => entry.name === `${options.namespace}_${model}`))
          internal[entry.name] = await store.db.collection(entry.name).find({}).sort({ _id: 1 }).toArray();
      }
      return { rows, internal };
    }
    function decoded(backend: Backend, state: Snapshot): Record<Model, Row[]> {
      return Object.fromEntries(MODELS.map(model => [model, state.rows[model].map(row => logical(model, row, backend === "mongo"))])) as Record<Model, Row[]>;
    }
    async function readPreview(backend: Backend, seed: Seed, next: string | null, actor = ACTOR) {
      const before = await raw(backend), preview = await apis[backend].previewOmAssignment(existingDto(seed), next, actor);
      assert.deepEqual(await raw(backend), before, "preview raw business/audit/internal writes zero");
      noCompanions(preview); assert.equal(preview.token, expectedToken(seed, next, actor,
        process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET!.trim(), tokenClock + 600_000));
      assert.equal(preview.count, 3); assert.deepEqual(preview.operations.map(row => row.operationId), [201, 202, 203].map(n => `synthetic-op-${n}`));
      assert.equal(preview.operations[0].omName, seed.OperationSession.find(row => row.id === id(201))!.omName);
      assert.equal(preview.operations[0].omUserId, seed.OperationSession.find(row => row.id === id(201))!.omUserId);
      return preview;
    }
    async function rejectUnchanged(backend: Backend, work: () => Promise<unknown>, domain = true) {
      const before = await raw(backend);
      await assert.rejects(work, domain ? conflict(backend) : safeError);
      assert.deepEqual(await raw(backend), before, "rejection must roll back business, old audit and guard bytes");
    }
    function normalizePhase(backend: Backend, before: Snapshot, after: Snapshot, event: string, start: number, end: number, changed: string[]) {
      const prev = decoded(backend, before), next = decoded(backend, after);
      const audits = next.ActivityChange.filter(row => row.requestId === event);
      assert.equal(new Set(next.ActivityChange.map(row => row.id)).size, next.ActivityChange.length);
      assert.equal(new Set(audits.map(auditKey)).size, audits.length, "duplicate target/action audit event");
      const auditTargets = new Set(audits.filter(row => row.targetType === "operation_sessions").map(row => row.targetId));
      // Physical writes are restricted to original-owned fields, not arbitrary
      // re-encryption of the rest of a changed document.
      const strip = (model: Model, row: Row, names: string[]) => {
        const columns = names.map(name => backend === "mongo" ? name : modelInfo(model).fields.find(field => field.name === name)!.dbName ?? name);
        return Object.fromEntries(Object.entries(row).filter(([key]) => !columns.includes(key)));
      };
      for (const model of MODELS) {
        if (model === "ActivityChange") continue;
        assert.equal(after.rows[model].length, before.rows[model].length);
        for (const now of after.rows[model]) {
          const rowId: unknown = now._id ?? now.id;
          const earlier: Row | undefined = before.rows[model].find(row => (row._id ?? row.id) === rowId); assert.ok(earlier);
          const op = next.OperationSession.find(row => row.id === rowId);
          const allowed: string[] = model === "OperationSession" && op && changed.includes(String(op.operationId))
            ? ["omName", "omNamePiiIndex", "omUserId", "omUserIdPiiIndex", "operationStatus", "updatedAt"]
            : model === "OmRequest" ? ["assignedOm", "assignedOmPiiIndex", "status"] : [];
          assert.deepEqual(strip(model, now, allowed), strip(model, earlier, allowed), `${model}: unrelated raw bytes changed`);
        }
      }
      assert.deepEqual([...auditTargets].sort(), changed.map(op => next.OperationSession.find(row => row.operationId === op)!.id).sort());
      for (const model of MODELS) for (let i = 0; i < next[model].length; i++) assertPrivacy(model, after.rows[model][i], next[model][i], backend === "mongo", env.PII_INDEX_KEY);
      for (const audit of before.rows.ActivityChange) assert.deepEqual(after.rows.ActivityChange.find(row => (row._id ?? row.id) === (audit._id ?? audit.id)), audit, "old audit bytes retained");
      for (const row of next.OperationSession) {
        const prior = prev.OperationSession.find(item => item.id === row.id)!;
        if (changed.includes(row.operationId as string)) {
          assert.ok(row.updatedAt instanceof Date); assert.notDeepEqual(row.updatedAt, prior.updatedAt);
          assert.ok(row.updatedAt.getTime() >= start - 2000 && row.updatedAt.getTime() <= end + 2000);
          row.updatedAt = `phase:${event}:operation:${row.id}`;
        } else assert.deepEqual(after.rows.OperationSession.find(item => (item._id ?? item.id) === row.id), before.rows.OperationSession.find(item => (item._id ?? item.id) === row.id), "untouched operation raw unchanged");
      }
      for (const audit of audits) {
        assert.match(String(audit.id), /^[0-9a-f-]{36}$/); assert.ok(audit.occurredAt instanceof Date);
        assert.ok(audit.occurredAt.getTime() >= start - 2000 && audit.occurredAt.getTime() <= end + 2000);
        const target = prev.OperationSession.find(row => row.id === audit.targetId);
        if (target) {
          const written = logical("OperationSession", after.rows.OperationSession.find(row => (row._id ?? row.id) === target.id)!, backend === "mongo");
          assert.ok((written.updatedAt as Date).getTime() <= audit.occurredAt.getTime() + 2000, "target update precedes corresponding audit within clock tolerance");
        }
        assert.equal(audit.actorEmail, ACTOR); assert.equal(audit.actorName, ACTOR_NAME); assert.equal(audit.actorType, "user");
        assert.equal(audit.route, "/api/om-request/assign"); assert.equal(audit.method, "PATCH"); assert.equal(audit.action, "update");
        for (const marker of MARKERS) assert.ok(!JSON.stringify(audit.changes).includes(marker), "audit values remain redacted");
        audit.id = `event:${auditKey(audit)}`; audit.occurredAt = `phase:${event}:audit:${audit.targetId}`;
      }
      next.ActivityChange.sort((a, b) => auditKey(a).localeCompare(auditKey(b)));
      return canonical(next);
    }

    await suite.test("V02/V04: identical initial preview and exact HMAC; unrelated same-course round excluded", async () => {
      const values: Preview[] = [];
      for (const backend of ["original", "pg", "mongo"] as const) {
        const seed = fixture(); await seedData(backend, seed);
        values.push(await readPreview(backend, seed, `  ${Y}  `, `  ${ACTOR.toUpperCase()}  `));
      }
      assert.deepEqual(values[1], values[0]); assert.deepEqual(values[2], values[0]);
    });

    const invalid: [string, (seed: Seed) => void][] = [
      ["request creation missing", s => { s.ActivityChange = s.ActivityChange.filter(row => row.targetType !== "om_requests"); }],
      ["duplicate request creation", s => { s.ActivityChange.push({ ...s.ActivityChange[0], id: id(550) }); }],
      ["different request in same batch", s => { s.ActivityChange.push({ ...s.ActivityChange[0], id: id(550), targetId: id(11) }); }],
      ["duplicate operation target", s => { s.ActivityChange.find(row => row.targetId === id(202))!.targetId = id(201); }],
      ["extra operation in same batch", s => { s.ActivityChange.find(row => row.targetId === id(204))!.requestId = id(900); }],
      ["missing operation creation", s => { s.ActivityChange = s.ActivityChange.filter(row => row.targetId !== id(202)); }],
      ["request creation wrong route", s => { s.ActivityChange[0].route = "/api/synthetic-other"; }],
      ["request creation wrong method", s => { s.ActivityChange[0].method = "PATCH"; }],
      ["request creation wrong action", s => { s.ActivityChange[0].action = "update"; }],
      ["operation creation wrong route", s => { s.ActivityChange[1].route = "/api/synthetic-other"; }],
      ["operation creation wrong method", s => { s.ActivityChange[1].method = "PATCH"; }],
      ["operation creation wrong action", s => { s.ActivityChange[1].action = "update"; }],
      ["operation target malformed UUID", s => { s.ActivityChange[2].targetId = "synthetic-invalid-uuid"; }],
      ["representative outside batch", s => { s.OmRequest[0].operationId = "synthetic-op-204"; }],
      ["representative missing", s => { s.OmRequest[0].operationId = "synthetic-missing"; }],
      ["representative absent link", s => { s.OmRequest[0].operationId = null; }],
      ["representative deleted", s => { s.OperationSession.find(row => row.id === id(201))!.deletedAt = OLD; }],
      ["other linked operation deleted", s => { s.OperationSession.find(row => row.id === id(202))!.deletedAt = OLD; }],
      ["other linked operation missing", s => { s.OperationSession = s.OperationSession.filter(row => row.id !== id(202)); }],
      ["count zero", s => { s.OmRequest[0].totalSessions = 0; }],
      ["count mismatch", s => { s.OmRequest[0].totalSessions = 4; }],
      ["sessions object", s => { s.OmRequest[0].sessions = { date: "2030-02-01" }; }],
      ["sessions encrypted JSON null", s => { s.OmRequest[0].sessions = MongoJsonNull; }],
      ["session date absent", s => { s.OmRequest[0].sessions = [{ date: "2030-02-01" }, {}, { date: "2030-02-03" }]; }],
      ["session date blank", s => { (s.OmRequest[0].sessions as Row[])[1].date = " "; }],
      ["session date wrong type", s => { (s.OmRequest[0].sessions as Row[])[1].date = 42; }],
      ["session null entry", s => { s.OmRequest[0].sessions = [{ date: "2030-02-01" }, null, { date: "2030-02-03" }]; }],
      ["session array entry", s => { s.OmRequest[0].sessions = [{ date: "2030-02-01" }, [], { date: "2030-02-03" }]; }]
    ];
    for (const [name, mutate] of invalid) await suite.test(`V03: ${name}`, async () => {
      for (const backend of ["original", "pg", "mongo"] as const) {
        const seed = fixture(); mutate(seed); await seedData(backend, seed);
        await rejectUnchanged(backend, () => apis[backend].previewOmAssignment(existingDto(seed), Y, ACTOR));
        await rejectUnchanged(backend, () => apis[backend].assignOmRequestAtomically(existingDto(seed), Y, ACTOR, expectedToken(fixture(), Y)));
      }
    });
    await suite.test("V03/V04: latest request missing/team changed/representative changed vs incoming DTO", async () => {
      for (const backend of ["original", "pg", "mongo"] as const) for (const mode of ["missing", "team", "link", "owner"] as const) {
        const seed = fixture(), dto = existingDto(seed);
        if (mode === "missing") seed.OmRequest = [];
        else seed.OmRequest[0][mode === "team" ? "team" : mode === "link" ? "operationId" : "assignedOm"] = mode === "team" ? "different-team" : mode === "link" ? "synthetic-op-204" : Y;
        await seedData(backend, seed);
        await rejectUnchanged(backend, () => apis[backend].previewOmAssignment(dto, Y, ACTOR));
      }
    });
    await suite.test("V04: token failure filters and secret precedence/fallback", async () => {
      for (const backend of ["original", "pg", "mongo"] as const) {
        const seed = fixture(); await seedData(backend, seed); tokenClock = FIXED_NOW;
        const preview = await readPreview(backend, seed, Y);
        const cases: [string, string | null, string][] = [
          ["", Y, ACTOR], ["not-a-token", Y, ACTOR], ["0." + "a".repeat(64), Y, ACTOR],
          [expectedToken(seed, Y, ACTOR, SECRET, FIXED_NOW), Y, ACTOR],
          [expectedToken(seed, Y, ACTOR, SECRET, FIXED_NOW + 600_001), Y, ACTOR],
          [preview.token.slice(0, -1) + (preview.token.endsWith("0") ? "1" : "0"), Y, ACTOR],
          [preview.token, X, ACTOR], [preview.token, Y, "different-synthetic@example.invalid"], [preview.token, Y, ""]
        ];
        for (const [token, next, actor] of cases) await rejectUnchanged(backend,
          () => apis[backend].assignOmRequestAtomically(existingDto(seed), next, actor, token));
        tokenClock = FIXED_NOW + 600_000;
        await rejectUnchanged(backend, () => apis[backend].assignOmRequestAtomically(existingDto(seed), Y, ACTOR, preview.token));
        tokenClock = FIXED_NOW;
        process.env.AUTH_SECRET = "  "; const fallback = await readPreview(backend, seed, Y);
        assert.notEqual(fallback.token, preview.token);
        delete process.env.NEXTAUTH_SECRET;
        await rejectUnchanged(backend, () => apis[backend].previewOmAssignment(existingDto(seed), Y, ACTOR), false);
        process.env.AUTH_SECRET = SECRET; process.env.NEXTAUTH_SECRET = FALLBACK;
      }
    });
    await suite.test("V04: reverted business value still invalidates via updatedAt; batch ID is not signed", async () => {
      for (const backend of ["original", "pg", "mongo"] as const) {
        const seed = fixture(); await seedData(backend, seed); const preview = await readPreview(backend, seed, Y);
        // Same logical owner after a hypothetical edit/revert; later timestamp is sufficient.
        seed.OperationSession.find(row => row.id === id(201))!.updatedAt = new Date(OLD.getTime() + 1);
        await seedData(backend, seed);
        await rejectUnchanged(backend, () => apis[backend].assignOmRequestAtomically(existingDto(seed), Y, ACTOR, preview.token));
        const renamed = fixture(); for (const row of renamed.ActivityChange) if (row.requestId === id(900)) row.requestId = id(902);
        await seedData(backend, renamed);
        const same = await readPreview(backend, renamed, Y); assert.equal(same.token, preview.token, "batch metadata is revalidated, not part of HMAC");
      }
    });

    const changes: [string, string | null, (seed: Seed) => void, string[]][] = [
      ["reassign", Y, () => {}, ["synthetic-op-201", "synthetic-op-202", "synthetic-op-203"]],
      ["trim selection", `  ${Y}  `, () => {}, ["synthetic-op-201", "synthetic-op-202", "synthetic-op-203"]],
      ["cancel", null, () => {}, ["synthetic-op-201", "synthetic-op-202", "synthetic-op-203"]],
      ["same request OM but different rounds", X, () => {}, ["synthetic-op-201", "synthetic-op-202", "synthetic-op-203"]],
      ["partial no-op", X, s => {
        for (const row of s.OperationSession) if ([id(202), id(203)].includes(String(row.id))) { row.omName = X; row.omUserId = null; }
      }, ["synthetic-op-201"]]
    ];
    for (const [name, nextOm, mutate, changedIds] of changes) await suite.test(`V05/V07: ${name}`, async () => {
      let expected: unknown; const event = id(10_000 + ++phase);
      for (const backend of ["original", "pg", "mongo"] as const) {
        const seed = fixture(); mutate(seed); await seedData(backend, seed);
        const dto = existingDto(seed), preview = await readPreview(backend, seed, nextOm), before = await raw(backend);
        const start = new Date().getTime();
        const result = await attributed(() => apis[backend].assignOmRequestAtomically(dto, nextOm, ACTOR, preview.token), event);
        const end = new Date().getTime(), after = await raw(backend), state = decoded(backend, after);
        noCompanions(result); assert.deepEqual(result.operationIds, changedIds);
        const next = nextOm?.trim() || null, status = next ? "배정완료" : "배정필요";
        assert.deepEqual(result.updated, { ...dto, assignedOm: next ?? undefined, status }, "preserve original DTO spread and undefined");
        for (const row of state.OperationSession.filter(row => row.id !== id(204))) {
          assert.equal(row.omName, next); assert.equal(row.omUserId, null);
          assert.equal(row.operationStatus, row.id === id(203) ? "DONE" : next ? "ASSIGNMENT_PLANNED" : "ASSIGNMENT_NEEDED");
        }
        const phaseAudits = state.ActivityChange.filter(row => row.requestId === event);
        assert.equal(phaseAudits.length, changedIds.length + (next !== X ? 1 : 0));
        assert.equal(phaseAudits.some(row => row.targetType === "om_requests"), next !== X);
        for (const op of phaseAudits.filter(row => row.targetType === "operation_sessions")) {
          assert.deepEqual((op.changes as Row).om_name, { redacted: true });
          const initial = seed.OperationSession.find(row => row.id === op.targetId)!;
          if (initial.omUserId !== null) assert.deepEqual((op.changes as Row).om_user_id, { redacted: true });
        }
        for (const rawRows of Object.values(after.internal)) for (const marker of [...MARKERS, preview.token])
          assert.ok(!JSON.stringify(rawRows).includes(marker), "guard/internal collection plaintext leak");
        for (const rawRows of Object.values(after.rows)) assert.ok(!JSON.stringify(rawRows).includes(preview.token), "confirmation token persisted");
        const observation = { result, state: normalizePhase(backend, before, after, event, start, end, changedIds) };
        if (backend === "original") expected = observation; else assert.deepEqual(observation, expected, `${backend}: exact oracle business/audit parity`);
        await rejectUnchanged(backend, () => apis[backend].assignOmRequestAtomically(dto, nextOm, ACTOR, preview.token));
      }
    });
    for (const status of ["ACTIVE", "RETROSPECTIVE_DONE", "ARCHIVE_NEEDED"] as const) for (const nextOm of [Y, null])
      await suite.test(`V05: preserve ${status} when ${nextOm === null ? "cancelling" : "assigning"}`, async () => {
        const event = id(10_000 + ++phase); let expected: unknown;
        for (const backend of ["original", "pg", "mongo"] as const) {
          const seed = fixture(); seed.OperationSession.find(row => row.id === id(203))!.operationStatus = status;
          await seedData(backend, seed); const preview = await readPreview(backend, seed, nextOm), before = await raw(backend);
          const start = new Date().getTime();
          const result = await attributed(() => apis[backend].assignOmRequestAtomically(existingDto(seed), nextOm, ACTOR, preview.token), event);
          const end = new Date().getTime(), after = await raw(backend);
          assert.equal(decoded(backend, after).OperationSession.find(row => row.id === id(203))!.operationStatus, status);
          assert.deepEqual(result.operationIds, [201, 202, 203].map(n => `synthetic-op-${n}`));
          const observation = { result, state: normalizePhase(backend, before, after, event, start, end, result.operationIds) };
          if (backend === "original") expected = observation; else assert.deepEqual(observation, expected);
        }
      });
    await suite.test("V06: full no-op repeated token; only internal guard nonce may change", async () => {
      for (const backend of ["original", "pg", "mongo"] as const) {
        const seed = fixture(); for (const row of seed.OperationSession) if (row.id !== id(204)) {
          row.omName = X; row.omUserId = null; if (row.operationStatus === "ASSIGNMENT_NEEDED") row.operationStatus = "ASSIGNMENT_PLANNED";
        }
        await seedData(backend, seed); const preview = await readPreview(backend, seed, X), dto = existingDto(seed);
        for (const repeat of [1, 2]) {
          const before = await raw(backend);
          const result = await attributed(() => apis[backend].assignOmRequestAtomically(dto, X, ACTOR, preview.token), id(11_000 + repeat));
          assert.deepEqual(result, { updated: { ...dto, assignedOm: X, status: "배정완료" }, operationIds: [] });
          const after = await raw(backend); assert.deepEqual(after.rows, before.rows, "no-op preserves ALL raw business/audit/timestamp bytes");
          const omitGuard = (state: Snapshot) => Object.fromEntries(Object.entries(state.internal).filter(([name]) => name !== guardName));
          assert.deepEqual(omitGuard(after), omitGuard(before));
          if (backend === "mongo") {
            assert.equal(after.internal[guardName].length, 1);
            assert.deepEqual(Object.keys(after.internal[guardName][0]).sort(), ["_id", "nonce"]);
            assert.equal(after.internal[guardName][0]._id, "restore"); assert.match(String(after.internal[guardName][0].nonce), /^[0-9a-f-]{36}$/);
          }
        }
      }
    });

    // Install actual DB-enforced failures, never replace repository methods with a throw.
    const infrastructure = (backend: Backend) => (error: unknown) => {
      safeError(error);
      assert.ok(!(error instanceof original.OmAssignmentConflict) && !(error instanceof newPg.OmAssignmentConflict), "storage failure must not masquerade as stale token");
      if (backend === "mongo") {
        // Infrastructure failure must retain the explicit safe error contract.
        const typed = error as Error & { code?: unknown };
        assert.ok(["OM_ASSIGNMENT_TRANSACTION_FAILED", "INVALID_VALUE_OR_AUTHENTICATION"].includes(String(typed.code)), "unexpected Mongo infrastructure error code");
      } else {
        const codes = new Set<string>(); let item: unknown = error;
        for (let depth = 0; depth < 6 && item && typeof item === "object"; depth++) {
          const row = item as Row; for (const key of ["code", "originalCode", "kind"]) if (row[key] !== undefined) codes.add(String(row[key])); item = row.cause;
        }
        assert.ok(["23514", "P2004", "CheckConstraintViolation"].some(code => codes.has(code))
          || /assignment_parity_block/.test((error as Error).message), "expected actual named database constraint failure");
      }
      return true;
    };
    for (const failAt of ["second-operation", "request", "audit"] as const) await suite.test(`V08: actual ${failAt} failure rolls back raw guard/business/prior audits`, async () => {
      for (const backend of ["original", "pg", "mongo"] as const) {
        const seed = fixture(); await seedData(backend, seed); const preview = await readPreview(backend, seed, Y);
        const event = id(12_000 + ++phase);
        const model: Model = failAt === "request" ? "OmRequest" : failAt === "audit" ? "ActivityChange" : "OperationSession";
        if (backend === "mongo") {
          const forbidden = failAt === "second-operation" ? { _id: id(202), omUserId: null }
            : failAt === "request" ? { _id: id(10) } : { requestId: event };
          await store.db.command({ collMod: store.collection(model).collectionName,
            validator: { $and: [operationMongoValidator(model), { $nor: [forbidden] }] }, validationLevel: "strict", validationAction: "error" });
        } else {
          // NOT VALID avoids re-validating existing fixture rows; new UPDATE/INSERT is checked.
          const predicate = failAt === "second-operation" ? `NOT (id = '${id(202)}'::uuid AND om_user_id IS NULL)`
            : failAt === "request" ? `id <> '${id(10)}'::uuid` : `request_id <> '${event}'::uuid`;
          await sql.query(`ALTER TABLE ${q(table(model))} ADD CONSTRAINT assignment_parity_block CHECK (${predicate}) NOT VALID`);
        }
        try {
          const before = await raw(backend);
          await assert.rejects(attributed(() => apis[backend].assignOmRequestAtomically(existingDto(seed), Y, ACTOR, preview.token), event), infrastructure(backend));
          assert.deepEqual(await raw(backend), before);
        } finally {
          if (backend === "mongo") await store.db.command({ collMod: store.collection(model).collectionName,
            validator: operationMongoValidator(model), validationLevel: "strict", validationAction: "error" });
          else await sql.query(`ALTER TABLE ${q(table(model))} DROP CONSTRAINT assignment_parity_block`);
        }
      }
    });
    await suite.test("V08: invalid encryption configuration fails closed without writes", async () => {
      for (const backend of ["original", "pg", "mongo"] as const) {
        const seed = fixture(); await seedData(backend, seed); const preview = await readPreview(backend, seed, Y);
        const before = await raw(backend); process.env.PII_ACTIVE_KEY_ID = "missing";
        try {
          await assert.rejects(apis[backend].assignOmRequestAtomically(existingDto(seed), Y, ACTOR, preview.token), safeError);
          assert.deepEqual(await raw(backend), before);
        } finally { process.env.PII_ACTIVE_KEY_ID = env.PII_ACTIVE_KEY_ID; }
      }
    });
    await suite.test("V08: authenticated ciphertext corruption is rejected by all backends", async () => {
      for (const backend of ["original", "pg", "mongo"] as const) {
        const seed = fixture(); await seedData(backend, seed); const preview = await readPreview(backend, seed, Y);
        const stored = (await raw(backend)).rows.OperationSession.find(row => (row._id ?? row.id) === id(201))!;
        const parts = String(stored[backend === "mongo" ? "omName" : "om_name"]).split(":");
        assert.equal(parts.length, 6); parts[4] = (parts[4].startsWith("A") ? "B" : "A") + parts[4].slice(1);
        if (backend === "mongo") await store.collection("OperationSession").updateOne({ _id: id(201) }, { $set: { omName: parts.join(":") } });
        else await sql.query("UPDATE operation_sessions SET om_name=$1 WHERE id=$2::uuid", [parts.join(":"), id(201)]);
        await rejectUnchanged(backend, () => apis[backend].assignOmRequestAtomically(existingDto(seed), Y, ACTOR, preview.token), false);
      }
    });
    await suite.test("V08: Mongo independent blind-index integrity rejects corrupt companion", async () => {
      const seed = fixture(); await seedData("mongo", seed); const preview = await readPreview("mongo", seed, Y);
      await store.collection("OperationSession").updateOne({ _id: id(201) }, { $set: { omNamePiiIndex: "0".repeat(64) } });
      await rejectUnchanged("mongo", () => mongo.assignOmRequestAtomically(existingDto(seed), Y, ACTOR, preview.token), false);
      // Not a PG parity claim: existing privacy/database.ts decryptRow does not validate
      // companion HMACs on reads. A universal PG HMAC-corruption rejection expectation
      // would invent behavior. Valid storage HMACs are independently verified above.
    });

    // V10: use actual PG BEFORE UPDATE triggers/advisory waits, not fake serialization
    // errors or replaced product DB reads. The blocked first writer has completed its
    // full signature reads. A second pool connection runs the opposing real function.
    // Existing destination course avoids course uniqueness/counter interference.
    assert.equal(createHash("sha256").update(readFileSync(new URL("./courseNameRestoreOriginalOracle.fixture.ts", import.meta.url))).digest("hex"),
      "7d1799b834f6407aef97fae8735e3fa11279398f94da8d884fc2c7b9db8be92c", "V10 existing restore oracle must remain frozen");
    const restoreOriginal = await import("./courseNameRestoreOriginalOracle.fixture");
    const { PrismaCourseNameRestoreRepository } = await import("./prismaCourseNameRestoreRepository");
    const { CourseNameRestoreConflict } = await import("./courseNameRestoreRepository");
    function serializationOrConflict(error: unknown) {
      safeError(error);
      if (error instanceof original.OmAssignmentConflict || error instanceof newPg.OmAssignmentConflict
        || error instanceof restoreOriginal.CourseNameRestoreConflict || error instanceof CourseNameRestoreConflict) return true;
      if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2034";
      const e = error as Error & { cause?: { kind?: string; originalCode?: string } };
      return e.name === "DriverAdapterError" && e.cause?.kind === "TransactionWriteConflict" && e.cause.originalCode === "40001";
    }
    async function waitForActualAdvisoryWait() {
      const end = performance.now() + 1500;
      while (performance.now() < end) {
        const blocked = await sql.query("SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND l.classid=20260929 AND l.objid=10 AND a.datname=current_database()");
        if (blocked.rowCount === 1) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail("V10 real PG advisory barrier was not reached (not an accepted conflict)");
    }
    for (const backend of ["original", "pg"] as const) for (const heldWriter of ["assignment", "restore"] as const)
      await suite.test(`V10 real PG ${backend}: ${heldWriter} reads first, opposing writer commits first`, async () => {
        const seed = fixture();
        seed.OmRequest[0].totalSessions = 2; seed.OmRequest[0].sessions = (seed.OmRequest[0].sessions as Row[]).slice(0, 2);
        seed.OperationSession = seed.OperationSession.filter(row => row.id !== id(203));
        seed.ActivityChange = seed.ActivityChange.filter(row => row.targetId !== id(203));
        for (const row of seed.OperationSession) if (row.id !== id(204)) {
          row.omName = row.id === id(201) ? X : Y; row.omUserId = null; row.operationStatus = "ASSIGNMENT_PLANNED";
        }
        await seedData(backend, seed);
        const api = apis[backend], dto = existingDto(seed);
        const preview = await api.previewOmAssignment(dto, X, ACTOR);
        const restore = new PrismaCourseNameRestoreRepository(prisma);
        const plan = backend === "original" ? await restoreOriginal.planCourseNameRestore("533", prisma) : await restore.planCourseNameRestore("533");
        const entry = plan.rows.find(row => row.operationId === "synthetic-op-201"); assert.ok(entry?.restorable);
        const eventA = id(13_000 + ++phase), eventB = id(13_000 + ++phase);
        const doAssignment = () => attributed(() => api.assignOmRequestAtomically(dto, X, ACTOR, preview.token), eventA);
        const doRestore = () => activityContext.run({ requestId: eventB, actorEmail: ACTOR, actorName: ACTOR_NAME,
          actorType: "user", route: "/api/admin/course-name-restore", method: "POST" }, () => backend === "original"
          ? restoreOriginal.applyCourseNameRestore("533", ["synthetic-op-201"], plan.snapshot, ACTOR, prisma)
          : restore.applyCourseNameRestore("533", ["synthetic-op-201"], plan.snapshot, ACTOR));
        const heldId = heldWriter === "assignment" ? id(202) : id(201);
        const heldRoute = heldWriter === "assignment" ? "/api/om-request/assign" : "/api/admin/course-name-restore";
        await sql.query(`CREATE FUNCTION assignment_parity_pause() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.id = '${heldId}'::uuid AND (nullif(current_setting('app.activity_context', true),'')::jsonb ->> 'route') = '${heldRoute}' THEN
              PERFORM pg_advisory_xact_lock(20260929,10);
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER assignment_parity_pause BEFORE UPDATE ON operation_sessions FOR EACH ROW EXECUTE FUNCTION assignment_parity_pause()`);
        await sql.query("SELECT pg_advisory_lock(20260929,10)");
        let pending: Promise<PromiseSettledResult<unknown>> | undefined;
        try {
          const held = heldWriter === "assignment" ? doAssignment : doRestore;
          const winner = heldWriter === "assignment" ? doRestore : doAssignment;
          pending = held().then(value => ({ status: "fulfilled", value }) as PromiseFulfilledResult<unknown>,
            reason => ({ status: "rejected", reason }) as PromiseRejectedResult);
          await waitForActualAdvisoryWait();
          // Failures here remain failures; never catch/re-run a candidate and call it PASS.
          await winner();
          await sql.query("SELECT pg_advisory_unlock(20260929,10)");
          const loser = await pending;
          assert.equal(loser.status, "rejected", "the original stale-snapshot attempt must not also succeed");
          if (loser.status === "rejected") assert.ok(serializationOrConflict(loser.reason), "timeout/deadlock/arbitrary Error is not SSI evidence");
          const after = await raw(backend), rows = decoded(backend, after);
          const s1 = rows.OperationSession.find(row => row.id === id(201))!, s2 = rows.OperationSession.find(row => row.id === id(202))!;
          assert.equal(s1.omName, X); assert.equal(rows.OmRequest[0].assignedOm, X);
          assert.equal(s1.courseRecordId, heldWriter === "assignment" ? id(102) : id(101));
          assert.equal(s2.omName, heldWriter === "assignment" ? Y : X);
          assert.equal(rows.Course.length, 2, "existing target, no course creation");
          const winnerEvent = heldWriter === "assignment" ? eventB : eventA;
          assert.equal(rows.ActivityChange.filter(row => row.requestId === winnerEvent).length, 1);
          assert.equal(rows.ActivityChange.filter(row => row.requestId === (heldWriter === "assignment" ? eventA : eventB)).length, 0);
          suite.diagnostic(`V10 ${backend}/${heldWriter}: actual advisory wait observed; one real writer committed, opposing attempt rejected`);
        } finally {
          await sql.query("SELECT pg_advisory_unlock(20260929,10)");
          if (pending) await pending;
          await sql.query("DROP TRIGGER assignment_parity_pause ON operation_sessions; DROP FUNCTION assignment_parity_pause()");
        }
      });
    suite.diagnostic("Coverage is repository-level only. Mongo V10, V09/V11–V18, HTTP side effects and UI remain separate/unverified; no PASS inferred from this diagnostic.");
  } finally {
    clock.mock.restore();
    const cleanup = await Promise.allSettled([
      (async () => { try { if (mongoOwned) await client.db(options.databaseName).dropDatabase(); } finally { await client.close(); } })(),
      (async () => { try { if (db) await db.$disconnect(); }
        finally { try { if (pgOwned) await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); }
          finally { if (pgConnected) await sql.end(); } } })()
    ]);
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Owned synthetic store cleanup failed");
  }
});
