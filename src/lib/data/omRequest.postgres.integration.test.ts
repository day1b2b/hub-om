// Frozen original/newPG/Mongo comparison; executed by the coordinator on isolated stores.
// Run ALONE in a fresh Node 24 env -i process, with only the two exact test URLs below.
// No dotenv, production factory selection, assignment, handlers, browser or external effects.
// This test refuses an already populated PG schema.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import pg from "pg";
import { MongoClient } from "mongodb";
import { activityContext } from "../activity/context";
import { decryptField } from "../privacy/fields";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { prepareMongoReadStore } from "./mongoReadStore";
import type { OmRequest, OmRequestInput } from "./omRequest/omRequestTypes";
import type { OmRequestRepository } from "./omRequest/omRequestRepository";

const PG_URL = "postgresql://synthetic@127.0.0.1:56709/om_requests_parity";
const MONGO_URI = "mongodb://127.0.0.1:27809/?replicaSet=omrequests20260929";
const pgUrl = process.env.OM_REQUEST_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_OM_REQUEST_TEST_URI;
const ORACLE_SHA256 = "5228368cd9afbc0595714182bf4fd3c04f6323c2b6119582e47d06f0e7938819";
const oracleFile = new URL("./omRequest/omRequestOriginalRepository.fixture.ts", import.meta.url);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = (n: number) => `abcdefab-0000-4000-8000-${String(n).padStart(12, "0")}`;
const old = new Date("2020-01-01T00:00:00.000Z");
const actor = "synthetic-om-actor@example.invalid", actorName = "SYNTHETIC_PRIVATE_ACTOR";
const operationId = "synthetic-om-request-preserved-operation";
const privateMarkers = [actor, actorName, "SYNTHETIC_PRIVATE_LD", "SYNTHETIC_PRIVATE_BUSINESS",
  "SYNTHETIC_PRIVATE_INSTRUCTOR", "SYNTHETIC_PRIVATE_LOCATION", "SYNTHETIC_PRIVATE_NOTE",
  "SYNTHETIC_PRIVATE_ASSIGNEE", "synthetic-ld@example.invalid", "https://synthetic.invalid/private-sync",
  "https://synthetic.invalid/private-drive", "SYNTHETIC_CHANGED_NOTE", "SYNTHETIC_CHANGED_LD"];

function input(): OmRequestInput {
  return { team: "synthetic-team", ld: "SYNTHETIC_PRIVATE_LD", company: "Synthetic company",
    businessNumber: "SYNTHETIC_PRIVATE_BUSINESS", trainingType: "해커톤", courseId: "SYNTHETIC-COURSE",
    courseName: "Synthetic course", courseCategoryMajor: "Synthetic major", courseCategory: "Synthetic category",
    tools: "Synthetic tool", instructorName: "SYNTHETIC_PRIVATE_INSTRUCTOR",
    syncupLink: "https://synthetic.invalid/private-sync", driveLink: "https://synthetic.invalid/private-drive",
    skillfloSetup: "Y", skillmatchSetup: "N", onSiteOperation: "Y", coachRequest: "N", resultReportNeeded: "Y",
    totalSessions: 1, sessions: [{ date: "2099-10-01", dateEnd: "2099-10-03", timeStart: "09:00", timeEnd: "17:00",
      duration: "7", location: "SYNTHETIC_PRIVATE_LOCATION", educationDatesText: "2099-10-01,2099-10-03" }],
    notes: "SYNTHETIC_PRIVATE_NOTE" };
}
const asInput = (value: unknown) => value as OmRequestInput;
type Row = Record<string, unknown>;
type Backend = "original" | "pg" | "mongo";

// Frozen SQL mappings, independent of the new mapper/adapter. In particular it is
// onsite_operation, NOT on_site_operation. SQL values are decrypted before comparison.
const requestColumns: Record<string, string> = {
  id: "id", createdAt: "created_at", status: "status", assignedOm: "assigned_om", operationId: "operation_id",
  ldEmail: "ld_email", slackChannel: "slack_channel", slackThreadTs: "slack_thread_ts", team: "team", ld: "ld",
  company: "company", businessNumber: "business_number", trainingType: "training_type", courseId: "course_id",
  courseName: "course_name", courseCategoryMajor: "course_category_major", courseCategory: "course_category",
  tools: "tools", instructorName: "instructor_name", syncupLink: "syncup_link", driveLink: "drive_link",
  skillfloSetup: "skillflo_setup", skillmatchSetup: "skillmatch_setup", onSiteOperation: "onsite_operation",
  coachRequest: "coach_request", resultReportNeeded: "result_report_needed", totalSessions: "total_sessions",
  sessions: "sessions", notes: "notes"
};
const auditColumns: Record<string, string> = {
  id: "id", occurredAt: "occurred_at", requestId: "request_id", actorEmail: "actor_email", actorName: "actor_name",
  actorType: "actor_type", route: "route", method: "method", targetType: "target_type", targetId: "target_id",
  action: "action", changes: "changes"
};
const privateStrings = {
  OmRequest: ["assignedOm", "ldEmail", "ld", "businessNumber", "instructorName", "syncupLink", "driveLink", "notes"],
  ActivityChange: ["actorEmail", "actorName"]
} as const;
function pgLogical(model: "OmRequest" | "ActivityChange", raw: Row): Row {
  const columns = model === "OmRequest" ? requestColumns : auditColumns;
  const privateFields = new Set<string>([...privateStrings[model], model === "OmRequest" ? "sessions" : "changes"]);
  const expectedColumns = [...Object.values(columns), ...privateStrings[model].map(field => `${columns[field]}_pii_index`)];
  assert.deepEqual(Object.keys(raw).sort(), expectedColumns.sort(), `${model}: SQL schema drift`);
  return Object.fromEntries(Object.entries(columns).map(([field, column]) => [field,
    privateFields.has(field) ? decryptField(model, field, raw[column]) : raw[column]]));
}
function mongoLogical(model: "OmRequest" | "ActivityChange", row: MongoRow): Row {
  // Decode storage-level JSON-null representation only. DTO [] is asserted separately;
  // converting stored null to [] here would hide a lossy legacy-row rewrite.
  const visible = Object.fromEntries(Object.entries(row).filter(([key]) => !key.endsWith("PiiIndex"))
    .map(([key, value]) => [key, value === MongoJsonNull ? null : value]));
  assert.deepEqual(Object.keys(visible).sort(), Object.keys(model === "OmRequest" ? requestColumns : auditColumns).sort());
  return visible;
}
// Preserve missing keys vs present undefined, null, array order and every business value.
// Never JSON-roundtrip a result or redact business fields to make parity pass.
function canonical(value: unknown, requestLabels: ReadonlyMap<string, string>): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return requestLabels.get(value) ?? value;
  if (Array.isArray(value)) return value.map(item => canonical(item, requestLabels));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item, requestLabels)]));
  return value;
}
function assertNoCompanions(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(!key.endsWith("PiiIndex") && !key.endsWith("Encrypted"), `DTO companion: ${key}`);
    assertNoCompanions(item);
  }
}
function checkRawPrivacy(model: "OmRequest" | "ActivityChange", raw: Row, logical: Row, backend: Backend, indexKey: string) {
  const columns = model === "OmRequest" ? requestColumns : auditColumns;
  for (const field of privateStrings[model]) {
    const column = backend === "mongo" ? field : columns[field];
    const hmacColumn = backend === "mongo" ? `${field}PiiIndex` : `${columns[field]}_pii_index`;
    const plain = logical[field];
    if (plain === null) { assert.equal(raw[column], null); assert.equal(raw[hmacColumn], null); }
    else {
      assert.equal(typeof plain, "string"); assert.match(String(raw[column]), /^pii:v1:/);
      const expected = createHmac("sha256", Buffer.from(indexKey, "base64"))
        .update(`${model}.${field}`).update("\0").update(plain as string).digest("hex");
      assert.equal(raw[hmacColumn], expected, `${model}.${field}: independently computed HMAC`);
    }
  }
  const jsonField = model === "OmRequest" ? "sessions" : "changes";
  const storedJson = (backend === "mongo" ? (raw[jsonField] as { $json: unknown }).$json : raw[jsonField]) as Row;
  // PG trigger deliberately stores allowlisted/redacted audit metadata in plain JSON.
  // Mongo may encrypt that metadata. Do not demand a fictitious PG encrypted changes column.
  if (model === "OmRequest" || backend === "mongo") assert.match(String(storedJson.__pii), /^pii:v1:/);
  const serialized = JSON.stringify(raw);
  for (const secret of privateMarkers) assert.ok(!serialized.includes(secret), `${model}: raw private plaintext`);
}

test("OM request original 383d804 fixture checksum", () => {
  assert.equal(createHash("sha256").update(readFileSync(oracleFile)).digest("hex"), ORACLE_SHA256);
});

test("original/newPG/Mongo OM request CRUD parity on owned real stores", {
  skip: pgUrl === undefined && mongoUri === undefined, timeout: 300_000
}, async suite => {
  // All allowlists, fixture integrity and migration-count checks precede ANY DB connection.
  // Supplying only one URL or an empty URL is a failure, not a misleading skip.
  assert.equal(pgUrl, PG_URL); assert.equal(mongoUri, MONGO_URI);
  assert.equal(createHash("sha256").update(readFileSync(oracleFile)).digest("hex"), ORACLE_SHA256);
  const migrationsRoot = new URL("../../../prisma/migrations/", import.meta.url);
  const migrations = readdirSync(migrationsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => entry.name).sort();
  assert.equal(migrations.length, 45);
  const migrationSql = migrations.map(name => readFileSync(new URL(`${name}/migration.sql`, migrationsRoot), "utf8"));
  for (const key of ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS",
    "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "AUTH_SECRET", "NEXTAUTH_SECRET",
    "SLACK_BOT_TOKEN", "NOTION_API_KEY", "SALESMAP_API_TOKEN"])
    assert.equal(process.env[key], undefined, `${key} must not be inherited; use env -i`);
  const env = { TZ: "UTC", DATABASE_URL: PG_URL, OPERATION_DATA_SOURCE: "postgres",
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const sql = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000, directConnection: true });
  const options = { client, databaseName: `hub_om_shadow_om_pg_${randomBytes(8).toString("hex")}`,
    namespace: `shadow_parity_${randomBytes(6).toString("hex")}`, allowShadowWrites: true as const };
  let db: PrismaClient | undefined, pgConnected = false, pgOwned = false, mongoOwned = false;
  try {
    const { getPrismaClient } = await import("./prisma");
    const original = await import("./omRequest/omRequestOriginalRepository.fixture");
    const newPg = await import("./omRequest/legacyOmRequestRepository");
    const { MongoOmRequestRepository, prepareMongoOmRequestStore, OM_REQUEST_MODELS } = await import("./mongoOmRequestRepository");
    await sql.connect(); pgConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0],
      { db: "om_requests_parity", usr: "synthetic" });
    const existing = await sql.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    assert.equal(existing.rowCount, 0, "Refuse to reset a populated schema; coordinator must supply a fresh disposable DB");
    pgOwned = true;
    await client.connect();
    assert.equal((await client.db("admin").command({ hello: 1 })).setName, "omrequests20260929");
    assert.equal((await client.db(options.databaseName).listCollections({}, { nameOnly: true }).toArray()).length, 0);
    mongoOwned = true;
    await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const migration of migrationSql) await sql.query(migration);
    db = getPrismaClient(); const prisma = db;
    await prepareMongoOmRequestStore(options);
    const witnessModels = ["Company", "Course", "OperationSession"] as const;
    await prepareMongoReadStore(options, witnessModels);
    const mongo = await MongoOmRequestRepository.open(options);
    const store = new MongoOperationStore(options, [...new Set<string>([...OM_REQUEST_MODELS, ...witnessModels])]);
    const expected = new Map<string, unknown>();

    for (const backend of ["original", "pg", "mongo"] as const) await suite.test(backend, async () => {
      assert.ok(pgOwned && mongoOwned);
      await sql.query("TRUNCATE om_requests, activity_changes, operation_sessions, courses, companies RESTART IDENTITY CASCADE");
      for (const model of store.models) await store.collection(model).deleteMany({});
      // Synthetic relationship witness: deleting a request must leave this exact operation untouched.
      const company = await prisma.company.create({ data: { id: id(801), name: "Synthetic company", normalizedName: "synthetic-om-company", createdAt: old, updatedAt: old } });
      const course = await prisma.course.create({ data: { id: id(802), processSeq: 802, companyId: company.id,
        courseId: "SYNTHETIC-COURSE", name: "Synthetic course", operationType: "NEEDS_REVIEW", createdAt: old, updatedAt: old } });
      const operation = await prisma.operationSession.create({ data: { id: id(803), operationId, courseRecordId: course.id,
        startDate: old, endDate: old, educationDates: [], omName: "SYNTHETIC_PRIVATE_ASSIGNEE", createdAt: old, updatedAt: old } });
      if (backend === "mongo") {
        await store.collection("Company").insertOne(encodeMongoRuntimeDocument("Company", company));
        await store.collection("Course").insertOne(encodeMongoRuntimeDocument("Course", course));
        await store.collection("OperationSession").insertOne(encodeMongoRuntimeDocument("OperationSession",
          { ...operation, validationErrors: operation.validationErrors === null ? MongoDbNull : operation.validationErrors }));
      }
      const repo: OmRequestRepository = backend === "original" ? original : backend === "pg" ? newPg : mongo;
      const requestLabels = new Map<string, string>();
      const created = new Map<string, { time: string; generated: boolean }>();
      const phaseTimes = new Map<string, { start: number; end: number; name: string; method: string; target?: string }>();
      let phase = 0;
      const raw = async (): Promise<{ requests: Row[]; audits: Row[]; operations: Row[] }> => backend === "mongo"
        ? { requests: await store.collection("OmRequest").find({}).sort({ _id: 1 }).toArray(),
          audits: await store.collection("ActivityChange").find({}).sort({ _id: 1 }).toArray(),
          operations: await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray() }
        : { requests: (await sql.query("SELECT * FROM om_requests ORDER BY id")).rows,
          audits: (await sql.query("SELECT * FROM activity_changes ORDER BY id")).rows,
          operations: (await sql.query("SELECT * FROM operation_sessions ORDER BY id")).rows };
      const logical = async (stored: Awaited<ReturnType<typeof raw>>) => backend === "mongo"
        ? { requests: (await store.scan("OmRequest")).map(row => mongoLogical("OmRequest", row)),
          audits: (await store.scan("ActivityChange")).map(row => mongoLogical("ActivityChange", row)) }
        : { requests: stored.requests.map(row => pgLogical("OmRequest", row)),
          audits: stored.audits.map(row => pgLogical("ActivityChange", row)) };

      type StepOptions<T> = { reject?: boolean; pure?: boolean; create?: boolean; target?: string;
        action?: "create" | "update" | "delete"; auditCount?: number; check?: (result: T, audits: Row[]) => void };
      async function step<T>(name: string, method: string, work: () => Promise<T>, opts: StepOptions<T> = {}): Promise<T> {
        const before = await raw(), requestId = id(10_000 + ++phase), start = Date.now();
        let value: T | undefined, rejected = false;
        try { value = await activityContext.run({ requestId, route: "/api/om-request", method,
          actorEmail: actor, actorName, actorType: "user" }, work); }
        catch (error) { assert.ok(error instanceof Error); rejected = true; }
        const end = Date.now();
        assert.equal(rejected, opts.reject ?? false, `${backend}/${name}: rejection parity`);
        assertNoCompanions(value);
        let target = opts.target;
        if (opts.create && !rejected) {
          const row = value as unknown as OmRequest;
          assert.match(row.id, uuid); assert.ok(!created.has(row.id), "repeat create must create a new UUID");
          const timestamp = Date.parse(row.createdAt);
          assert.ok(Number.isFinite(timestamp) && timestamp >= start - 2000 && timestamp <= end + 2000);
          requestLabels.set(row.id, `generated-request:${name}`); created.set(row.id, { time: row.createdAt, generated: true });
          target = row.id;
        }
        phaseTimes.set(requestId, { start, end, name, method, target });
        const stored = await raw(), rows = await logical(stored);
        assert.deepEqual(stored.operations, before.operations, `${name}: no linked-operation mutation`);
        const idOfRaw = (row: Row) => String(backend === "mongo" ? row._id : row.id);
        for (const audit of before.audits)
          assert.deepEqual(stored.audits.find(row => idOfRaw(row) === idOfRaw(audit)), audit, `${name}: retain prior audit bytes`);
        if (opts.pure || rejected) assert.deepEqual(stored, before, `${name}: failed/read/missing operation wrote data`);
        for (const [model, rawRows, logicalRows] of [["OmRequest", stored.requests, rows.requests], ["ActivityChange", stored.audits, rows.audits]] as const) {
          assert.equal(rawRows.length, logicalRows.length);
          for (const row of logicalRows) {
            const encoded = rawRows.find(rawRow => idOfRaw(rawRow) === row.id); assert.ok(encoded);
            checkRawPrivacy(model, encoded, row, backend, env.PII_INDEX_KEY);
          }
        }
        for (const row of rows.requests) {
          const expectedCreation = created.get(String(row.id)); assert.ok(expectedCreation, "unexpected persisted request");
          assert.ok(row.createdAt instanceof Date); assert.equal(row.createdAt.toISOString(), expectedCreation.time);
        }
        const phaseAudits = rows.audits.filter(row => row.requestId === requestId);
        if (opts.auditCount !== undefined) assert.equal(phaseAudits.length, opts.auditCount, `${name}: audit count`);
        if (opts.pure || rejected) assert.equal(phaseAudits.length, 0);
        assert.equal(new Set(rows.audits.map(row => row.id)).size, rows.audits.length);
        for (const audit of rows.audits) {
          assert.match(String(audit.id), uuid);
          const origin = phaseTimes.get(String(audit.requestId)); assert.ok(origin, "unattributed or unexpected audit");
          assert.equal(audit.targetType, "om_requests"); assert.equal(audit.targetId, origin.target);
          assert.ok(created.has(String(audit.targetId)), "audit must join an actual created/seeded request, including after delete");
          assert.equal(audit.actorEmail, actor); assert.equal(audit.actorName, actorName); assert.equal(audit.actorType, "user");
          assert.equal(audit.route, "/api/om-request"); assert.equal(audit.method, origin.method);
          assert.ok(audit.occurredAt instanceof Date);
          assert.ok(audit.occurredAt.getTime() >= origin.start - 2000 && audit.occurredAt.getTime() <= origin.end + 2000);
        }
        for (const audit of phaseAudits) if (opts.action) assert.equal(audit.action, opts.action);
        // A repository method makes at most one OmRequest mutation. Keep event multiplicity visible.
        assert.ok(phaseAudits.length <= 1, `${name}: duplicate audits`);
        opts.check?.(value as T, phaseAudits);
        const normalizeResult = (result: unknown): unknown => {
          if (Array.isArray(result)) return result.map(normalizeResult);
          if (result && typeof result === "object" && "id" in result && "createdAt" in result) {
            const row = result as OmRequest, registration = created.get(row.id); assert.ok(registration);
            assert.equal(row.createdAt, registration.time, "DTO and raw persisted createdAt must agree");
            return { ...row, createdAt: registration.generated ? `generated-createdAt:${requestLabels.get(row.id)}` : row.createdAt };
          }
          return result;
        };
        const snapshot = canonical({ outcome: rejected ? { rejected: true } : { value: normalizeResult(value) },
          requests: rows.requests.map<Row>(row => ({ ...row, createdAt: created.get(String(row.id))!.generated
            ? `generated-createdAt:${requestLabels.get(String(row.id))}` : row.createdAt }))
            .sort((a, b) => String(requestLabels.get(String(a.id)) ?? a.id).localeCompare(String(requestLabels.get(String(b.id)) ?? b.id))),
          audits: rows.audits.map<Row>(row => ({ ...row, id: `generated-audit:${row.requestId}`,
            occurredAt: `generated-occurredAt:${row.requestId}` })).sort((a, b) => String(a.requestId).localeCompare(String(b.requestId)))
        }, requestLabels);
        if (backend === "original") expected.set(name, snapshot);
        else { assert.ok(expected.has(name)); assert.deepEqual(snapshot, expected.get(name), `${backend}/${name}: frozen oracle parity`); }
        return value as T;
      }

      await step("empty list", "GET", () => repo.listOmRequests(), { pure: true, check: result => assert.deepEqual(result, []) });
      const missing = id(999);
      await step("missing UUID get", "GET", () => repo.getOmRequest(missing), { pure: true, check: value => assert.equal(value, null) });
      await step("missing UUID update", "PATCH", () => repo.updateOmRequest(missing, input()), { pure: true, check: value => assert.equal(value, null) });
      await step("missing UUID delete", "DELETE", () => repo.deleteOmRequest(missing), { pure: true, check: value => assert.equal(value, false) });
      await step("missing UUID operation link", "PATCH", () => repo.setOmRequestOperationId(missing, operationId), { pure: true, check: value => assert.equal(value, null) });
      await step("missing UUID Slack meta", "PATCH", () => repo.setOmRequestSlackMeta(missing, { ldEmail: actor }), { pure: true, check: value => assert.equal(value, null) });

      // Explicit distinct timestamps make list-order assertions deterministic, with no sleeps.
      for (const n of [903, 901, 904, 902]) {
        const row = await prisma.omRequest.create({ data: { ...input(), id: id(n), createdAt: new Date(old.getTime() + (n - 901) * 86_400_000),
          sessions: n === 904 ? Prisma.JsonNull : input().sessions as unknown as Prisma.InputJsonValue,
          status: n === 901 ? "배정완료" : n === 902 ? "unknown-status" : "배정필요",
          assignedOm: n === 901 ? "SYNTHETIC_PRIVATE_ASSIGNEE" : null, operationId: n === 901 ? operationId : null } });
        if (n === 904) assert.equal(row.sessions, null, "PG seed must contain encrypted JSON null, not SQL NULL or []");
        if (backend === "mongo") await store.collection("OmRequest").insertOne(encodeMongoRuntimeDocument("OmRequest",
          { ...row, sessions: n === 904 ? MongoJsonNull : row.sessions }));
        created.set(row.id, { time: row.createdAt.toISOString(), generated: false });
      }
      await step("list by createdAt descending not insertion order", "GET", () => repo.listOmRequests(), { pure: true,
        check: rows => {
          assert.deepEqual(rows.map(row => row.id), [id(904), id(903), id(902), id(901)]);
          assert.deepEqual(rows.find(row => row.id === id(904))?.sessions, []);
        } });
      await step("encrypted legacy JSON null get maps sessions to empty array", "GET", () => repo.getOmRequest(id(904)),
        { pure: true, check: row => assert.deepEqual(row?.sessions, []) });
      await step("encrypted legacy JSON null survives metadata update", "PATCH",
        () => repo.setOmRequestSlackMeta(id(904), { slackChannel: "legacy-synthetic-channel" }),
        { target: id(904), action: "update", auditCount: 1, check: (row, audits) => {
          assert.deepEqual(row?.sessions, []);
          assert.ok(!Object.hasOwn(audits[0].changes as Row, "sessions"), "metadata-only write must not rewrite JSON null as []");
        } });
      await step("encrypted legacy JSON null get after metadata update", "GET", () => repo.getOmRequest(id(904)),
        { pure: true, check: row => assert.deepEqual(row?.sessions, []) });
      await step("encrypted legacy JSON null list after metadata update", "GET", () => repo.listOmRequests(),
        { pure: true, check: rows => assert.deepEqual(rows.find(row => row.id === id(904))?.sessions, []) });
      await step("legacy unknown status maps to needed", "GET", () => repo.getOmRequest(id(902)), { pure: true,
        check: row => assert.equal(row?.status, "배정필요") });

      const defaultInput = asInput({ ...input(), resultReportNeeded: undefined, businessNumber: undefined,
        courseCategoryMajor: undefined, tools: undefined, id: id(998), createdAt: old.toISOString(), status: "배정완료",
        assignedOm: "forged", operationId: "forged", ldEmail: "forged", slackChannel: "forged", slackThreadTs: "forged" });
      const first = await step("create defaults and input allowlist", "POST", () => repo.createOmRequest(defaultInput), {
        create: true, action: "create", auditCount: 1, check: row => {
          assert.notEqual(row.id, id(998)); assert.equal(row.resultReportNeeded, "N"); assert.equal(row.status, "배정필요");
          for (const field of ["assignedOm", "operationId", "ldEmail", "slackChannel", "slackThreadTs", "businessNumber", "courseCategoryMajor", "tools"] as const) {
            assert.ok(Object.hasOwn(row, field)); assert.equal(row[field], undefined);
          }
        }
      });
      const repeated = await step("same POST input creates another request", "POST", () => repo.createOmRequest(defaultInput), {
        create: true, action: "create", auditCount: 1, check: row => assert.notEqual(row.id, first.id)
      });
      await step("created get equals create DTO", "GET", () => repo.getOmRequest(first.id), { pure: true, check: row => assert.deepEqual(row, first) });
      await step("create full input", "POST", () => repo.createOmRequest(input()), { create: true, action: "create", auditCount: 1 });

      const target = id(901);
      await step("set Slack metadata", "PATCH", () => repo.setOmRequestSlackMeta(target,
        { ldEmail: "synthetic-ld@example.invalid", slackChannel: "synthetic-channel", slackThreadTs: "123.456" }),
      { target, action: "update", auditCount: 1 });
      await step("truthy meta ignores empty undefined and null", "PATCH", () => repo.setOmRequestSlackMeta(target,
        { ldEmail: "", slackChannel: undefined, slackThreadTs: null } as unknown as Parameters<OmRequestRepository["setOmRequestSlackMeta"]>[1]),
      { target, pure: true, auditCount: 0, check: row => {
        assert.equal(row?.ldEmail, "synthetic-ld@example.invalid"); assert.equal(row?.slackChannel, "synthetic-channel"); assert.equal(row?.slackThreadTs, "123.456");
      } });
      await step("truthy whitespace is stored not trimmed", "PATCH", () => repo.setOmRequestSlackMeta(target, { slackChannel: " " }),
        { target, action: "update", auditCount: 1, check: row => assert.equal(row?.slackChannel, " ") });
      await step("operationId empty is stored", "PATCH", () => repo.setOmRequestOperationId(target, ""),
        { target, action: "update", auditCount: 1, check: row => assert.equal(row?.operationId, "") });
      await step("operationId restore", "PATCH", () => repo.setOmRequestOperationId(target, operationId), { target, action: "update", auditCount: 1 });
      await step("operationId repeat is no logical change", "PATCH", () => repo.setOmRequestOperationId(target, operationId), { target, pure: true, auditCount: 0 });
      await step("meta repeat indexed string has no audit", "PATCH", () => repo.setOmRequestSlackMeta(target, { ldEmail: "synthetic-ld@example.invalid" }),
        { target, auditCount: 0 }); // Ciphertext may change; do not demand raw byte equality here.

      await step("update allowlist preserves assignment and link and meta", "PATCH", () => repo.updateOmRequest(target,
        asInput({ ...input(), team: "synthetic-team-updated", notes: "SYNTHETIC_CHANGED_NOTE", ld: "SYNTHETIC_CHANGED_LD",
          status: "배정필요", assignedOm: "forged", operationId: "forged", ldEmail: "forged", slackChannel: "forged", id: id(997), createdAt: old.toISOString() })),
      { target, action: "update", auditCount: 1, check: row => {
        assert.equal(row?.status, "배정완료"); assert.equal(row?.assignedOm, "SYNTHETIC_PRIVATE_ASSIGNEE");
        assert.equal(row?.operationId, operationId); assert.equal(row?.ldEmail, "synthetic-ld@example.invalid");
        assert.equal(row?.slackChannel, " "); assert.equal(row?.notes, "SYNTHETIC_CHANGED_NOTE");
      } });
      await step("undefined required stays but undefined nullable clears", "PATCH", () => repo.updateOmRequest(target,
        asInput({ team: undefined, notes: undefined, sessions: undefined, businessNumber: undefined, courseCategoryMajor: undefined, tools: undefined })),
      { target, action: "update", auditCount: 1, check: row => {
        assert.equal(row?.team, "synthetic-team-updated"); assert.equal(row?.notes, "SYNTHETIC_CHANGED_NOTE");
        assert.deepEqual(row?.sessions, input().sessions);
        assert.equal(row?.businessNumber, undefined); assert.equal(row?.courseCategoryMajor, undefined); assert.equal(row?.tools, undefined);
      } });
      await step("explicit nullable null remains null in storage", "PATCH", () => repo.updateOmRequest(target,
        asInput({ businessNumber: null, courseCategoryMajor: null, tools: null })), { target, pure: true, auditCount: 0 });
      await step("same indexed notes scalar has no audit", "PATCH", () => repo.updateOmRequest(target,
        asInput({ notes: "SYNTHETIC_CHANGED_NOTE" })), { target, auditCount: 0,
        check: row => assert.equal(row?.notes, "SYNTHETIC_CHANGED_NOTE") });
      for (const repeat of [1, 2]) await step(`same-value sessions JSON audit ${repeat}`, "PATCH",
        () => repo.updateOmRequest(target, asInput({ sessions: structuredClone(input().sessions) })),
        { target, action: "update", auditCount: 1, check: (_row, audits) => {
          // PG JSON encryption has no equality HMAC: a fresh envelope produces a redacted audit,
          // even when plaintext JSON is identical. Do NOT normalize away this event or its count.
          assert.deepEqual(audits[0].changes, { sessions: { redacted: true } });
        } });
      await step("empty nullable strings preserved", "PATCH", () => repo.updateOmRequest(target,
        asInput({ businessNumber: "", courseCategoryMajor: "", tools: "" })), { target, action: "update", auditCount: 1,
        check: row => { assert.equal(row?.businessNumber, ""); assert.equal(row?.courseCategoryMajor, ""); assert.equal(row?.tools, ""); } });

      for (const number of [1.5, -1.9, 0.1, 2147483647.4, -2147483648.9]) {
        await step(`finite count truncation create ${number}`, "POST", () => repo.createOmRequest({ ...input(), totalSessions: number }),
          { create: true, action: "create", auditCount: 1, check: row => assert.equal(row.totalSessions, Math.trunc(number)) });
        await step(`finite count truncation update ${number}`, "PATCH", () => repo.updateOmRequest(target, asInput({ totalSessions: number })),
          { target, action: "update", auditCount: 1, check: row => assert.equal(row?.totalSessions, Math.trunc(number)) });
      }
      // Invalid shapes are rejected by the frozen PG writer, not by invented application policy.
      for (const [name, patch] of [["missing required team", { team: undefined }], ["null required team", { team: null }],
        ["wrong count type", { totalSessions: "one" }], ["large count", { totalSessions: 2147483648 }], ["NaN count", { totalSessions: NaN }], ["infinite count", { totalSessions: Infinity }],
        ["missing required sessions", { sessions: undefined }], ["wrong private scalar", { notes: 123 }]] as const)
        await step(`invalid create ${name}`, "POST", () => repo.createOmRequest(asInput({ ...input(), ...patch })), { reject: true });
      for (const [name, patch] of [["null required team", { team: null }], ["overflow count", { totalSessions: 2147483648 }],
        ["wrong private scalar", { notes: 123 }]] as const)
        await step(`invalid update ${name}`, "PATCH", () => repo.updateOmRequest(target, asInput(patch)), { target, reject: true });
      for (const bad of ["not-a-uuid", ""]) {
        await step(`malformed UUID get ${JSON.stringify(bad)}`, "GET", () => repo.getOmRequest(bad), { reject: true });
        await step(`malformed UUID update ${JSON.stringify(bad)}`, "PATCH", () => repo.updateOmRequest(bad, input()), { reject: true });
        await step(`malformed UUID delete ${JSON.stringify(bad)}`, "DELETE", () => repo.deleteOmRequest(bad), { reject: true });
        await step(`malformed UUID link ${JSON.stringify(bad)}`, "PATCH", () => repo.setOmRequestOperationId(bad, operationId), { reject: true });
        await step(`malformed UUID meta ${JSON.stringify(bad)}`, "PATCH", () => repo.setOmRequestSlackMeta(bad, {}), { reject: true });
      }
      // These are DB-valid values, despite falling outside the TypeScript UI unions.
      // An adapter must not silently introduce stricter domain validation in this CRUD port.
      await step("DB text and JSON do not acquire new domain validation", "POST", () => repo.createOmRequest(asInput({ ...input(),
        trainingType: "synthetic-unknown", skillfloSetup: "synthetic-unknown", totalSessions: -1, sessions: { synthetic: "shape" } })),
      { create: true, action: "create", auditCount: 1 });

      await step("delete linked request retains operation and prior audit", "DELETE", () => repo.deleteOmRequest(target),
        { target, action: "delete", auditCount: 1, check: value => assert.equal(value, true) });
      await step("deleted get returns null", "GET", () => repo.getOmRequest(target), { pure: true, check: value => assert.equal(value, null) });
      await step("repeat delete returns false", "DELETE", () => repo.deleteOmRequest(target), { pure: true, check: value => assert.equal(value, false) });
      await step("deleted update returns null", "PATCH", () => repo.updateOmRequest(target, input()), { pure: true, check: value => assert.equal(value, null) });
      await step("deleted link returns null", "PATCH", () => repo.setOmRequestOperationId(target, operationId), { pure: true, check: value => assert.equal(value, null) });
      await step("deleted meta returns null", "PATCH", () => repo.setOmRequestSlackMeta(target, { ldEmail: actor }), { pure: true, check: value => assert.equal(value, null) });
      await step("repeated POST sibling survived deletion", "GET", () => repo.getOmRequest(repeated.id), { pure: true, check: value => assert.deepEqual(value, repeated) });
      suite.diagnostic(`${backend}: ${phase} sequential repository observations; no handler/browser/assignment claim`);
    });
  } finally {
    // Clean only names this invocation proved disposable/empty and then owned.
    // Independent settled cleanup avoids leaking a sibling resource when one close fails.
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
