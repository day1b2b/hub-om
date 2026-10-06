// Original/newPG/Mongo parity; run alone under env -i with synthetic stores.
// Never load dotenv. Exact disposable endpoints below are mandatory; this file resets their schema.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import pg from "pg";
import { MongoClient } from "mongodb";
import { completeMongoRow, MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { activityContext } from "../activity/context";
import type { SalesRecord, SourceReadResult } from "../sourceReads/sourceReadTypes";
import type { SalesRevenueSyncResult, MultiDealMode } from "./salesRevenueSync";

const pgUrl = process.env.SALES_REVENUE_PG_TEST_DATABASE_URL, mongoUri = process.env.MONGODB_SALES_REVENUE_TEST_URI;
const oracleHash = "9940bbb0e5afa82e86725ef8309ad1f7b0f1b968478950f4a71a80ac0047b13a";
const old = new Date("2020-01-01T00:00:00.000Z"), actor = "synthetic-sales@example.invalid", actorName = "Synthetic private actor";
const privateIssue = "Synthetic issue private@example.invalid 010-1234-5678";
const id = (n: number) => `abcdefab-0000-4000-8000-${String(n).padStart(12, "0")}`;
const record = (courseId: string | undefined, revenue?: number, extra: Partial<SalesRecord> = {}): SalesRecord =>
  ({ sourceRecordId: `synthetic:${courseId}`, courseId, revenue, ...extra });
const course = (n = 1, courseId = "A", revenue: string | null = null, companyId = id(9001)): MongoRow =>
  completeMongoRow("Course", { id: id(n), processSeq: n, companyId, courseId, name: "Synthetic course", operationType: "NEEDS_REVIEW",
    courseCategory: "Synthetic category", tools: "Synthetic preserved tool", revenue, revenueRaw: revenue, createdAt: old, updatedAt: old });
const deal = { dealCount: 2, dealsSameAmount: false, maxAmount: 7, minAmount: 3 };
type ObservedCourse = { id: string; courseId: string; name: string; company: { name: string } | null };
type Scenario = { name: string; rows?: MongoRow[]; records: SalesRecord[]; configured?: boolean; status?: SourceReadResult<SalesRecord>["status"];
  resolutions?: Record<string, MultiDealMode>; issues?: SourceReadResult<SalesRecord>["issues"]; safeIssues?: string[];
  sourceThrows?: boolean; logFails?: boolean; overflow?: boolean; numeric?: { incoming: number; stored: number | null } };
const scenarios: Scenario[] = [
  { name: "unconfigured", configured: false, records: [record("A", 10)] },
  { name: "reader disabled still computes", status: "disabled", records: [record("A", 10)] },
  { name: "failed", status: "failed", records: [record("A", 10)], issues: [{ code: "salesmap_read_failed", message: privateIssue, recoverable: true }], safeIssues: ["세일즈맵 딜을 읽지 못했습니다."] },
  { name: "partial", status: "partial", records: [record("A", 10)], issues: [{ code: "salesmap_deal_pagination_truncated", message: "딜이 많아 일부만 읽었습니다(최대 1페이지). 전체가 반영되지 않을 수 있습니다.", recoverable: true }] },
  { name: "empty", records: [] },
  { name: "unmatched only", records: [record("Z", 10), record("Z", 20)] },
  { name: "filter and normalize", rows: [course(1, " \u200bA\u200c\u200d\ufeff\u00a0 "), course(2, ""), course(3, "   ")],
    records: [record(undefined, 1), record("", 1), record("A"), { ...record("A"), revenue: null } as unknown as SalesRecord, record(" A\u200b ", 10), record("   ", 2), record("a", 3), record("A B", 4)] },
  { name: "same and untouched raw", rows: [{ ...course(1, "A", "10"), revenueRaw: "manual formatting" }], records: [record("A", 10)] },
  { name: "duplicates snapshot", rows: [course(1, "A", "1")], records: [record("A", 2), record("Z", 7), record("A", 3), record("A", 3)] },
  { name: "multiple courses", rows: [course(1, "A", "1"), course(2, "A", "2", id(9002))], records: [record("A", 10, deal), record("A", 20, deal)] },
  { name: "distinct multiple course names", rows: [{ ...course(1, "A", "1"), name: "Synthetic Z course" }, { ...course(2, "A", "2", id(9002)), name: "Synthetic A course" }], records: [record("A", 10, deal), record("A", 20, deal)] },
  { name: "same amount ignores exclude", records: [record("A", 14, { ...deal, minAmount: 7, dealsSameAmount: true })], resolutions: { A: "exclude" } },
  { name: "resolution normalized collision last wins", records: [record("A", 10, deal)], resolutions: { A: "max", " A ": "min" } },
  { name: "duplicate reversed order", rows: [course(1, "A", "1")], records: [record("A", 3), record("A", 2), record("A", 2)] },
  { name: "multiple defaults same amount", records: [record("A", 14, { dealCount: 2 })], resolutions: { A: "exclude" } },
  { name: "default sum", records: [record("A", 10, deal)] },
  { name: "source throws", records: [], sourceThrows: true },
  { name: "log failure isolated", records: [record("A", 10)], logFails: true },
  { name: "unknown issue redacted", records: [record("A", 10)], issues: [{ code: "unknown", message: privateIssue, recoverable: true }], safeIssues: ["SALES_REVENUE_SOURCE_ISSUE"] },
  { name: "known malformed issue redacted", records: [record("A", 10)], issues: [{ code: "salesmap_deal_missing_amount", message: privateIssue, recoverable: true }], safeIssues: ["SALES_REVENUE_SOURCE_ISSUE"] },
  { name: "known valid issue", records: [record("A", 10)], issues: [{ code: "salesmap_deal_missing_amount", message: "금액이 없는 딜 2건을 건너뛰었습니다.", recoverable: true }] }
];
for (const mode of ["sum", "max", "min", "exclude"] as const) scenarios.push({ name: `mode ${mode}`, records: [record("A", 10, deal)], resolutions: { " \u200bA ": mode } });
for (const [incoming, stored] of [[0, 0], [-0, 0], [1.004, 1], [1.005, 1.01], [1.006, 1.01], [-1.004, -1], [-1.005, -1.01], [-1.006, -1.01], [1e-7, 0], [-1e-7, 0], [0.1 + 0.2, 0.3], [999999999999.99, 999999999999.99], [NaN, null], [Infinity, null], [-Infinity, null]] as const)
  scenarios.push({ name: `numeric ${Object.is(incoming, -0) ? "-0" : String(incoming)}`, records: [record("A", incoming)], numeric: { incoming, stored } });
for (const amount of [999999999999.995, 1e12, -999999999999.995, -1e12]) scenarios.push({ name: `overflow rollback ${amount}`, rows: [course(1), course(2, "B")], records: [record("A", 7), record("B", amount)], overflow: true });
scenarios.push({ name: "all log arrays cap 500", status: "partial", rows: [course(1, "M"), course(2, "M", null, id(9002)), course(3, "D")], resolutions: { M: "exclude" },
  records: Array.from({ length: 501 }, (_, i) => [record(`missing-${i}`, 1), record("M", 10, deal), record("D", 14, { ...deal, minAmount: 7, dealsSameAmount: true })]).flat() });

// Preserve NaN, infinity, -0 and source-array order: JSON round-tripping would mask failures.
function scalar(value: unknown): unknown {
  if (value === MongoDbNull || value === MongoJsonNull) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(scalar);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, scalar(v)]));
  return value;
}
const ordered = <T>(rows: T[]) => [...rows].sort((a, b) => JSON.stringify(scalar(a)).localeCompare(JSON.stringify(scalar(b))));
const normalizeId = (value: string) => value.replace(/[\u200b-\u200d\ufeff\u00a0]/g, "").trim();
function resultView(result: SalesRevenueSyncResult, scenario: Scenario, backend: string, observed: ObservedCourse[]) {
  const changes: SalesRevenueSyncResult["changes"] = []; let offset = 0;
  for (const source of (result.configured && result.readStatus !== "failed" ? scenario.records : []).filter(r => r.courseId && r.revenue != null)) {
    if (result.excludedCourseIds.includes(source.courseId!)) continue;
    const n = (scenario.rows ?? [course()]).filter(row => normalizeId(String(row.courseId)) && normalizeId(String(row.courseId)) === normalizeId(source.courseId!)).length;
    changes.push(...ordered(result.changes.slice(offset, offset + n))); offset += n;
  }
  assert.equal(offset, result.changes.length);
  if (scenario.safeIssues) assert.deepEqual(result.issues, backend === "original" ? scenario.issues!.map(i => i.message) : scenario.safeIssues);
  for (const item of result.multiDealCourseIds) {
    const first = observed.find(row => normalizeId(row.courseId) === normalizeId(item.courseId)); assert.ok(first);
    assert.equal(item.companyName, first.company?.name); assert.equal(item.courseName, first.name);
  }
  // Only the two first-match labels may differ across backends whose row order is unspecified.
  // Each was checked against a copy captured from that backend's actual original query result.
  const multiDealCourseIds = result.multiDealCourseIds.map(item => ({ ...item, companyName: "verified:first-company", courseName: "verified:first-course" }));
  return { ...result, changes, multiDealCourseIds, issues: scenario.safeIssues ?? result.issues };
}
function logical(row: MongoRow, generated: string[]) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.endsWith("PiiIndex")).map(([key, value]) => [key, generated.includes(key) ? `generated:${key}` : value]));
}

test("frozen sales revenue oracle checksum", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("./salesRevenueSyncOriginalOracle.fixture.ts", import.meta.url))).digest("hex"), oracleHash);
});
test("original/newPG/Mongo sales revenue parity on isolated real stores", { skip: !pgUrl || !mongoUri, timeout: 300_000 }, async suite => {
  assert.equal(pgUrl, "postgresql://synthetic@127.0.0.1:56699/sales_revenue_parity");
  assert.equal(mongoUri, "mongodb://127.0.0.1:27799/?replicaSet=salesrevenue20260929");
  assert.equal(createHash("sha256").update(readFileSync(new URL("./salesRevenueSyncOriginalOracle.fixture.ts", import.meta.url))).digest("hex"), oracleHash);
  // Dedicated env -i process only: fail before DB access if production/sibling configuration leaked in.
  for (const key of ["DATABASE_URL", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "SALESMAP_API_TOKEN"])
    assert.equal(process.env[key], undefined, `${key} must not be inherited`);
  const env = { DATABASE_URL: pgUrl, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  const sql = new pg.Client({ connectionString: pgUrl }), client = new MongoClient(mongoUri!, { serverSelectionTimeoutMS: 5000 });
  const options = { client, databaseName: `hub_om_shadow_sales_pg_${randomBytes(8).toString("hex")}`, namespace: "shadow_parity", allowShadowWrites: true as const };
  let db: PrismaClient | undefined, pgOwned = false, mongoOwned = false;
  try {
    const { getPrismaClient } = await import("./prisma");
    const { originalSalesRevenueSync } = await import("./salesRevenueSyncOriginalOracle.fixture");
    const { runSalesRevenueSyncWithRepositories } = await import("./salesRevenueSync");
    const { PrismaSalesRevenueSyncRepository } = await import("./prismaSalesRevenueSyncRepository");
    const { MongoSalesRevenueSyncRepository, prepareMongoSalesRevenueSyncStore, SALES_REVENUE_MODELS } = await import("./mongoSalesRevenueSyncRepository");
    await sql.connect();
    assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr")).rows[0], { db: "sales_revenue_parity", usr: "synthetic" });
    pgOwned = true;
    await client.connect(); assert.equal((await client.db("admin").command({ hello: 1 })).setName, "salesrevenue20260929"); mongoOwned = true;
    const migrationsRoot = new URL("../../../prisma/migrations/", import.meta.url);
    const migrations = readdirSync(migrationsRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(); assert.equal(migrations.length, 45);
    await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const name of migrations) await sql.query(readFileSync(new URL(`${name}/migration.sql`, migrationsRoot), "utf8"));
    db = getPrismaClient(); const prisma = db;
    await prepareMongoSalesRevenueSyncStore(options);
    const mongo = await MongoSalesRevenueSyncRepository.open(options), adapter = new PrismaSalesRevenueSyncRepository();
    const store = new MongoOperationStore(options, SALES_REVENUE_MODELS), expected = new Map<string, unknown>();
    const tables = ["courses", "activity_changes", "sales_revenue_sync_logs"] as const;
    for (const backend of ["original", "pg", "mongo"] as const) await suite.test(backend, async () => {
      suite.diagnostic(`${backend}: ${scenarios.length} scenarios x 3 phases = ${scenarios.length * 3} exact comparisons`);
      for (const scenario of scenarios) {
        // Reset + independently seed EVERY backend/case; preview/apply/reapply share only their own case.
        await sql.query("TRUNCATE companies,courses,activity_changes,sales_revenue_sync_logs RESTART IDENTITY CASCADE");
        for (const model of SALES_REVENUE_MODELS) await store.collection(model).deleteMany({});
        for (const n of [9001, 9002]) {
          const row = { id: id(n), name: scenario.name === "distinct multiple course names" ? `Synthetic company ${n}` : "Synthetic company", normalizedName: `synthetic-${n}`, createdAt: old, updatedAt: old };
          if (backend === "mongo") await store.collection("Company").insertOne(encodeMongoRuntimeDocument("Company", row));
          else await prisma.company.create({ data: row });
        }
        const seeds = [...(scenario.rows ?? [course()]), course(8000, "untouched", "42")];
        for (const row of seeds) {
          if (backend === "mongo") await store.collection("Course").insertOne(encodeMongoRuntimeDocument("Course", row));
          else await prisma.course.create({ data: row as Parameters<typeof prisma.course.create>[0]["data"] });
        }
        const raw = async () => backend === "mongo"
          ? Promise.all(["Course", "ActivityChange", "SalesRevenueSyncLog"].map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray()))
          : (async () => { const rows = []; for (const table of tables) rows.push((await sql.query(`SELECT * FROM ${table} ORDER BY id`)).rows); return rows; })();
        const repo = backend === "mongo" ? mongo : adapter;
        for (const phase of ["preview", "apply", "reapply"] as const) {
          const before = await raw(), requestId = randomUUID(), apply = phase !== "preview"; let reads = 0;
          const read = async (): Promise<SourceReadResult<SalesRecord>> => {
            reads++; if (scenario.sourceThrows) throw new Error(privateIssue);
            return { source: "sales", status: scenario.status ?? "ok", readAt: old.toISOString(), items: scenario.records, issues: scenario.issues ?? [] };
          };
          const input = { apply, actorEmail: actor, multiDealResolutions: scenario.resolutions };
          let observed: ObservedCourse[] = [];
          const capture = (rows: ObservedCourse[]) => { observed = rows.map(row => ({ id: row.id, courseId: row.courseId, name: row.name, company: row.company ? { name: row.company.name } : null })); };
          const selectedRepo = {
            async listCourses() { const rows = await repo.listCourses(); capture(rows); return rows; },
            applyUpdates: repo.applyUpdates.bind(repo), recordLog: scenario.logFails ? async () => { throw new Error(privateIssue); } : repo.recordLog.bind(repo)
          };
          const oracleDb = new Proxy(prisma, { get(target, key) {
            if (key === "course") return new Proxy(target.course, { get(delegate, operation) {
              const value = Reflect.get(delegate, operation);
              if (operation === "findMany") return async (...args: unknown[]) => { const rows = await value.apply(delegate, args); capture(rows); return rows; };
              return typeof value === "function" ? value.bind(delegate) : value;
            } });
            if (key === "salesRevenueSyncLog" && scenario.logFails) return { create: async () => { throw new Error(privateIssue); } };
            const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
          } });
          let result: SalesRevenueSyncResult | undefined, rejected = false;
          try {
            result = await activityContext.run({ requestId, actorEmail: actor, actorName, actorType: "user", route: "/api/admin/sales-revenue", method: apply ? "POST" : "GET" }, () =>
              backend === "original" ? originalSalesRevenueSync(input, { configured: scenario.configured !== false, read, prisma: oracleDb })
                : runSalesRevenueSyncWithRepositories(input, selectedRepo, { isConfigured: () => scenario.configured !== false, readSalesRecords: read }));
          } catch (error) {
            rejected = true; assert.ok(error instanceof Error);
            if (backend !== "original") { assert.ok(!error.message.includes(privateIssue)); assert.match(error.message, /SALES_REVENUE_SYNC_FAILED/); }
          }
          assert.equal(rejected, Boolean(scenario.sourceThrows || apply && scenario.overflow));
          assert.equal(reads, scenario.configured === false ? 0 : 1);
          const rows: MongoRow[] = backend === "mongo" ? await store.scan("Course") : await prisma.course.findMany();
          const audits: MongoRow[] = backend === "mongo" ? await store.scan("ActivityChange", { requestId }) : await prisma.activityChange.findMany({ where: { requestId } });
          const logs: MongoRow[] = backend === "mongo" ? await store.scan("SalesRevenueSyncLog") : await prisma.salesRevenueSyncLog.findMany();
          const logicalRows = rows.map(row => {
            assert.deepEqual(row.createdAt, old); assert.ok(row.updatedAt instanceof Date);
            const revenue = row.revenue == null ? null : Number(row.revenue);
            return { ...row, revenue, updatedAt: row.updatedAt.getTime() === old.getTime() ? old : "generated:updatedAt" };
          });
          const logicalLogs = logs.map(row => {
            assert.ok(row.startedAt instanceof Date); assert.equal(row.triggeredBy, actor);
            const detail = row.detail as Record<string, unknown>;
            if (scenario.safeIssues) assert.deepEqual(detail.issues, backend === "original" ? scenario.issues!.map(i => i.message) : scenario.safeIssues);
            return { ...logical(row, ["id", "startedAt"]), detail: { ...detail, ...(scenario.safeIssues ? { issues: scenario.safeIssues } : {}) } };
          });
          for (const row of audits) { assert.ok(row.occurredAt instanceof Date); assert.equal(row.actorEmail, actor); assert.equal(row.actorName, actorName); }
          const snapshot = scalar({ rejected, result: result && resultView(result, scenario, backend, observed), rows: ordered(logicalRows),
            audits: ordered(audits.map(row => logical(row, ["id", "occurredAt", "requestId"]))), logs: ordered(logicalLogs) });
          const key = `${scenario.name}/${phase}`;
          if (backend === "original") expected.set(key, snapshot); else assert.deepEqual(snapshot, expected.get(key), `${backend} ${key}`);
          const stored = await raw();
          if (!apply || rejected || scenario.configured === false || scenario.status === "failed") assert.deepEqual(stored, before, `${key}: no writes`);
          if (scenario.status === "partial") { assert.deepEqual(stored[0], before[0]); assert.deepEqual(stored[1], before[1]); }
          if (apply && result?.applied && scenario.numeric) {
            const row = rows.find(r => r.id === id(1))!, { incoming, stored: amount } = scenario.numeric;
            assert.equal(row.revenue == null ? null : Number(row.revenue), amount); assert.equal(row.revenueRaw, String(incoming));
            if (phase === "reapply" && (amount === null || incoming !== amount)) { assert.equal(result.updatedRows, 1); assert.equal(amount === null ? result.filled : result.changed, 1); }
          }
          if (scenario.name === "duplicates snapshot" && result) {
            assert.equal(result.changes.length, 3); assert.ok(result.changes.every(c => c.before === (phase === "reapply" ? 3 : 1)));
            assert.equal(result.updatedRows, apply ? (phase === "reapply" ? 1 : 3) : 0);
            const revenueChanges = audits.map(a => (a.changes as Record<string, unknown>).revenue);
            assert.deepEqual(ordered(revenueChanges), ordered(!apply ? [] : phase === "reapply"
              ? [{ before: 3, after: 2 }] : [{ before: 1, after: 2 }, { before: 2, after: 3 }]));
          }
          const expectsLog = apply && !rejected && scenario.configured !== false && scenario.status !== "failed" && !scenario.logFails;
          assert.equal(logs.length, expectsLog ? (phase === "reapply" ? 2 : 1) : 0);
          if (scenario.name === "all log arrays cap 500" && apply) for (const row of logs) {
            const detail = row.detail as Record<string, unknown[]>;
            for (const field of ["unmatchedCourseIds", "multiCourseIds", "multiDealCourseIds", "excludedCourseIds", "dedupedCourseIds"]) assert.equal(detail[field].length, 500);
            assert.equal(row.unmatched, 501); assert.equal(row.ambiguous, 501);
          }
          for (const [index, model, fields] of [[1, "ActivityChange", ["actorEmail", "actorName"]], [2, "SalesRevenueSyncLog", ["triggeredBy"]]] as const) {
            for (const row of stored[index]) for (const field of fields) {
              const column = backend === "mongo" ? field : field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
              const value = field === "actorName" ? actorName : actor;
              assert.match(String(row[column]), /^pii:v1:/);
              const hmac = createHmac("sha256", Buffer.from(env.PII_INDEX_KEY, "base64")).update(`${model}.${field}`).update("\0").update(value).digest("hex");
              assert.equal(row[backend === "mongo" ? `${field}PiiIndex` : `${column}_pii_index`], hmac);
            }
          }
          for (const row of stored[2]) {
            const detail = row.detail as { $json?: { __pii?: string }; __pii?: string };
            assert.match(String(backend === "mongo" ? detail.$json?.__pii : detail.__pii), /^pii:v1:/);
          }
          const serialized = JSON.stringify(stored);
          for (const secret of [actor, actorName, privateIssue]) assert.ok(!serialized.includes(secret), `${key}: raw PII leak`);
        }
      }
    });
  } finally {
    try { if (mongoOwned) await client.db(options.databaseName).dropDatabase(); }
    finally { try { await client.close(); if (db) await db.$disconnect(); if (pgOwned) await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); await sql.end(); }
      finally { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } } }
  }
});
