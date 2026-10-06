/** Actual POST/NextResponse, authorization guard, activity wrapper, context and PG
 * repository; only session supply, explicit ports and cached Prisma IO are synthetic.
 * No DB, HTTP server, middleware execution, encryption or native storage claim here.
 * Complete schema/codec/frozen-PG parity belongs to the separate integration suite.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { inspect, isDeepStrictEqual } from "node:util";
import { runWithDataRepositories, type RequestActivityRepository } from "./dataRepositoryContext";
import type { AdminBackupData, AdminBackupRepository } from "./adminBackupRepository";
import type { ActivityContext } from "../activity/context";

const NOW = "2026-09-30T15:30:00.000Z";
const SECRET = "synthetic-backup-secret-never-log";
const PRIVATE = "synthetic-backup-private@example.invalid";
const RAW = `mongodb://synthetic:${SECRET}@127.0.0.1:1/private-backup`;
const DENIED = "코치 개인정보 열람 권한이 없습니다. (ADMIN_EMAILS 설정 및 admin 계정 필요)";
const FAILED = "ADMIN_BACKUP_READ_FAILED";
const ADMIN = "backup-admin@day1company.co.kr";
type Session = { user: { email: string; name: string }; expires: string } | null;
const actor = (email: string): Session => ({ user: { email, name: "Synthetic backup actor" }, expires: "" });
const actors = new AsyncLocalStorage<Session>();
const DATA: AdminBackupData = {
  coaches: [{ id: "coach-a", name: PRIVATE, accessToken: "synthetic-access-token", deletedAt: new Date("2026-08-01T00:00:00.000Z") }],
  privateProfiles: [{ coachId: "coach-a", phone: "synthetic-phone", email: PRIVATE }],
  fields: [{ id: "field-a", name: "Synthetic field" }],
  curriculums: [{ id: "curriculum-a", name: "Synthetic curriculum" }],
  coachFields: [{ coachId: "coach-a", tagId: "field-a" }, { coachId: "coach-b", tagId: "field-a" }],
  coachCurriculums: [{ coachId: "coach-a", tagId: "curriculum-a" }],
  schedules: [{ id: "schedule-a", date: new Date("2026-09-01T00:00:00.000Z"), startTime: 0 }],
  scheduleAccessLogs: [{ id: "access-a", coachId: "coach-a", success: false }],
  engagements: [{ id: "engagement-a", status: "SCHEDULED", feedback: null }],
  engagementSchedules: [{ id: "engagement-schedule-a", cancelledAt: null }],
  importRuns: [{ id: "import-a", summary: { _id: "user-json-id", tokenPiiIndex: "user-json-key", nested: [0, false, null] } }],
  archiveSnapshots: [{ id: "snapshot-a", table_count: 11, row_count: 27, status: "running", started_at: new Date("2026-09-29T12:00:00.000Z"), finished_at: null }]
};
// Independent literal: never build the oracle with the product model map/codec/builder.
const EXPECTED = {
  exportedAt: NOW,
  counts: { coaches: 1, privateProfiles: 1, fields: 1, curriculums: 1, coachFields: 2, coachCurriculums: 1,
    schedules: 1, scheduleAccessLogs: 1, engagements: 1, engagementSchedules: 1, importRuns: 1, archiveSnapshots: 1 },
  data: {
    coaches: [{ id: "coach-a", name: PRIVATE, accessToken: "synthetic-access-token", deletedAt: "2026-08-01T00:00:00.000Z" }],
    privateProfiles: [{ coachId: "coach-a", phone: "synthetic-phone", email: PRIVATE }],
    fields: [{ id: "field-a", name: "Synthetic field" }], curriculums: [{ id: "curriculum-a", name: "Synthetic curriculum" }],
    coachFields: [{ coachId: "coach-a", tagId: "field-a" }, { coachId: "coach-b", tagId: "field-a" }],
    coachCurriculums: [{ coachId: "coach-a", tagId: "curriculum-a" }],
    schedules: [{ id: "schedule-a", date: "2026-09-01T00:00:00.000Z", startTime: 0 }],
    scheduleAccessLogs: [{ id: "access-a", coachId: "coach-a", success: false }],
    engagements: [{ id: "engagement-a", status: "SCHEDULED", feedback: null }],
    engagementSchedules: [{ id: "engagement-schedule-a", cancelledAt: null }],
    importRuns: [{ id: "import-a", summary: { _id: "user-json-id", tokenPiiIndex: "user-json-key", nested: [0, false, null] } }],
    archiveSnapshots: [{ id: "snapshot-a", table_count: 11, row_count: 27, status: "running", started_at: "2026-09-29T12:00:00.000Z", finished_at: null }]
  }
};
const EMPTY = { coaches: [], privateProfiles: [], fields: [], curriculums: [], coachFields: [], coachCurriculums: [],
  schedules: [], scheduleAccessLogs: [], engagements: [], engagementSchedules: [], importRuns: [], archiveSnapshots: [] } satisfies AdminBackupData;
const EMPTY_EXPECTED = { exportedAt: NOW, counts: { coaches: 0, privateProfiles: 0, fields: 0, curriculums: 0,
  coachFields: 0, coachCurriculums: 0, schedules: 0, scheduleAccessLogs: 0, engagements: 0, engagementSchedules: 0,
  importRuns: 0, archiveSnapshots: 0 }, data: EMPTY };
const envNames = ["NODE_ENV", "BACKUP_API_SECRET", "ADMIN_EMAILS", "DEV_AUTH_BYPASS", "DEV_AUTH_EMAIL", "DATABASE_URL",
  "MONGODB_URI", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
const request = (authorization: string | null = `Bearer ${SECRET}`) => new Request("https://example.invalid/api/admin/backup", {
  method: "POST", headers: authorization === null ? {} : { authorization }
});
function same(actual: unknown, expected: unknown, code: string) { assert.ok(isDeepStrictEqual(actual, expected), code); }
function publicFailure(error: unknown): boolean {
  assert.ok(error instanceof Error, "BACKUP_ERROR_CLASS");
  same({ message: error.message, cause: error.cause, keys: Object.keys(error) }, { message: FAILED, cause: undefined, keys: [] }, "BACKUP_ERROR_NOT_FIXED");
  return true;
}

test("admin backup actual POST/auth/scope with synthetic ports and PG IO (no DB)", { timeout: 30_000 }, async suite => {
  const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const globals = globalThis as typeof globalThis & { prisma?: unknown }, previous = globals.prisma;
  let authCalls = 0, reads = 0;
  const unexpected: string[] = [], logs: unknown[][] = [], pgCalls: Array<{ name: string; args: unknown[] }> = [];
  const pgAudit: Array<Record<string, unknown>> = [], pgAuditSql: string[] = [];
  let pgFailure: { value: unknown } | undefined;
  const forbidden = (kind: string): never => { unexpected.push(kind); throw new Error("BACKUP_SYNTHETIC_FORBIDDEN_EFFECT"); };
  const delegates = { coach: "coaches", coachPrivateProfile: "privateProfiles", coachFieldMaster: "fields", coachCurriculumMaster: "curriculums",
    coachField: "coachFields", coachCurriculum: "coachCurriculums", coachSchedule: "schedules", coachScheduleAccessLog: "scheduleAccessLogs",
    coachEngagement: "engagements", coachEngagementSchedule: "engagementSchedules", coachImportRun: "importRuns" } as const;
  const tx = {
    async $queryRaw(parts: TemplateStringsArray) { pgAuditSql.push(parts.join("?")); return []; },
    async $executeRaw(parts: TemplateStringsArray) { pgAuditSql.push(parts.join("?")); return 0; },
    activityRequest: { async create(input: { data: Record<string, unknown> }) { pgAudit.push(input.data); return input.data; } }
  };
  const cached = new Proxy({}, { get(_target, name) {
    if (name === "$transaction") return async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx);
    if (name === "$queryRaw") return async (parts: TemplateStringsArray, ...values: unknown[]) => {
      pgCalls.push({ name: "archiveSnapshots", args: [Array.from(parts), parts.raw ? Array.from(parts.raw) : null, values] });
      if (pgFailure) throw pgFailure.value;
      return structuredClone(DATA.archiveSnapshots);
    };
    if (typeof name === "string" && Object.hasOwn(delegates, name)) return new Proxy({}, { get(_delegate, operation) {
      if (operation !== "findMany") return forbidden("pg-business-write-or-unexpected-operation");
      return async (...args: unknown[]) => {
        pgCalls.push({ name, args });
        if (pgFailure) throw pgFailure.value;
        return structuredClone(DATA[delegates[name as keyof typeof delegates]]);
      };
    } });
    return forbidden("pg-unexpected-member");
  } });
  function configure() {
    Object.assign(process.env, { NODE_ENV: "test", BACKUP_API_SECRET: SECRET, ADMIN_EMAILS: ADMIN,
      DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/backup_forbidden", OPERATION_DATA_SOURCE: "local",
      PII_ENCRYPTION_KEYS: JSON.stringify({ backup: Buffer.alloc(32, 37).toString("base64") }), PII_ACTIVE_KEY_ID: "backup",
      PII_INDEX_KEY: Buffer.alloc(32, 71).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
    delete process.env.MONGODB_URI; delete process.env.DEV_AUTH_BYPASS; delete process.env.DEV_AUTH_EMAIL;
    globals.prisma = cached; pgFailure = undefined; pgCalls.length = 0; pgAudit.length = 0; pgAuditSql.length = 0;
    authCalls = 0; reads = 0;
  }
  configure();
  const captures = (["log", "info", "warn", "error", "debug"] as const).map(name => mock.method(console, name, (...args: unknown[]) => { logs.push(args); }));
  const fetchTrap = mock.method(globalThis, "fetch", async () => forbidden("fetch"));
  const modules = [
    mock.module("@/auth", { namedExports: { auth: async () => { authCalls++; return actors.getStore() ?? null; } } }),
    mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { forbidden("pg-connect"); } } } }),
    mock.module("mongodb", { namedExports: { MongoClient: class { constructor() { forbidden("mongo-connect"); } } } })
  ];
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
  } });
  suite.mock.timers.enable({ apis: ["Date"], now: new Date(NOW).getTime() });
  try {
    const { POST, dynamic } = await import("../../app/api/admin/backup/route");
    const { NextResponse } = await import("next/server.js");
    const { getAdminBackupRepository } = await import("./adminBackupFactory");
    const { getPrismaClient } = await import("./prisma");
    const port: AdminBackupRepository = { async read() { reads++; return structuredClone(DATA); } };
    function audit() {
      const records: Array<{ context: ActivityContext; status: number; durationMs: number }> = [];
      const repository: RequestActivityRepository = { async recordRequest(context, status, durationMs) { records.push({ context: { ...context }, status, durationMs }); } };
      return { records, repository };
    }
    function observedClean() { same(unexpected, [], "BACKUP_UNEXPECTED_EFFECT"); same(logs, [], "BACKUP_APPLICATION_OUTPUT"); }
    function noPG() { same(pgCalls, [], "BACKUP_PG_FALLBACK"); same(pgAudit, [], "BACKUP_PG_AUDIT_FALLBACK"); same(pgAuditSql, [], "BACKUP_PG_RETENTION_FALLBACK"); }
    function auditRecord(log: ReturnType<typeof audit>, status: number, actorType: string, email: string | null, id?: string | null) {
      assert.equal(log.records.length, 1);
      const record = log.records[0];
      same(Object.keys(record.context).sort(), ["actorEmail", "actorName", "actorType", "method", "requestId", "route"], "BACKUP_AUDIT_FIELDS");
      same({ ...record.context, requestId: "controlled" }, { requestId: "controlled", route: "/api/admin/backup", method: "POST",
        actorType, actorEmail: email, actorName: email === null ? null : "Synthetic backup actor" }, "BACKUP_AUDIT_CONTENT");
      assert.match(record.context.requestId, /^[0-9a-f-]{36}$/); if (id !== undefined) assert.equal(record.context.requestId, id);
      assert.equal(record.status, status); assert.ok(Number.isInteger(record.durationMs) && record.durationMs >= 0);
      const text = inspect(record, { depth: null, maxArrayLength: null, maxStringLength: null });
      for (const marker of [PRIVATE, RAW, SECRET, "synthetic-access-token"]) assert.ok(!text.includes(marker), "BACKUP_AUDIT_PAYLOAD_LEAK");
    }
    async function response(result: Response, expected: unknown = EXPECTED) {
      assert.ok(result instanceof NextResponse); assert.equal(result.status, 200);
      same([...result.headers].filter(([key]) => key !== "x-request-id"), [
        ["content-disposition", 'attachment; filename="hub_om_coach_backup_2026-09-30.json"'],
        ["content-type", "application/json; charset=utf-8"]
      ], "BACKUP_HEADERS");
      assert.match(result.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
      same(await result.json(), expected, "BACKUP_WHOLE_BODY"); observedClean();
    }
    function queryContract() {
      assert.equal(pgCalls.length, 12);
      same(pgCalls.filter(call => call.name !== "archiveSnapshots").sort((a, b) => a.name.localeCompare(b.name)),
        Object.keys(delegates).sort().map(name => ({ name, args: [] })), "BACKUP_PG_FINDMANY_CONTRACT");
      const raw = pgCalls.filter(call => call.name === "archiveSnapshots"); assert.equal(raw.length, 1);
      const [parts, literal, values] = raw[0].args as [string[], string[] | null, unknown[]];
      same(parts, literal, "BACKUP_PG_TAGGED_SQL"); same(values, [], "BACKUP_PG_SQL_VALUES");
      same(parts.join("?").replace(/\s+/g, " ").trim(), "SELECT id, table_count, row_count, status, started_at, finished_at FROM coachdb_archive_snapshots ORDER BY started_at DESC LIMIT 20", "BACKUP_PG_SQL_CONTRACT");
    }

    await suite.test("imports are lazy: no auth, query, audit, connection or fetch", async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(dynamic, "force-dynamic"); assert.equal(authCalls, 0); noPG(); observedClean();
    });
    await suite.test("default factory stays PG for absent/valid/malformed Mongo env; actual getter and 11+1 queries", async () => {
      for (const uri of [undefined, "mongodb://127.0.0.1:1/synthetic_backup", RAW + "invalid"]) {
        configure(); if (uri !== undefined) process.env.MONGODB_URI = uri;
        const repository = getAdminBackupRepository(); noPG();
        same(await repository.read(), DATA, "BACKUP_PG_RESULT"); queryContract();
        assert.equal(authCalls, 0); same(pgAudit, [], "READ_HAS_NO_REQUEST_AUDIT"); observedClean();
      }
    });
    await suite.test("default actual POST delegates PG and retains request audit separately from business reads", async () => {
      configure(); const result = await POST(request()); await response(result); queryContract();
      assert.equal(pgAudit.length, 1); assert.equal(pgAudit[0].id, result.headers.get("x-request-id"));
      same({ route: pgAudit[0].route, method: pgAudit[0].method, status: pgAudit[0].status, actorType: pgAudit[0].actorType, actorEmail: pgAudit[0].actorEmail },
        { route: "/api/admin/backup", method: "POST", status: 200, actorType: "token_request", actorEmail: null }, "BACKUP_DEFAULT_AUDIT");
      same(pgAuditSql, ["SELECT set_config('statement_timeout', '1500', true)", "SELECT set_config('statement_timeout', '1500', true)",
        "DELETE FROM activity_requests WHERE id IN (SELECT id FROM activity_requests WHERE occurred_at < now() - interval '30 days' ORDER BY occurred_at LIMIT 1000)",
        "DELETE FROM activity_changes WHERE id IN (SELECT id FROM activity_changes WHERE occurred_at < now() - interval '365 days' ORDER BY occurred_at LIMIT 1000)"], "BACKUP_DEFAULT_AUDIT_SQL");
    });
    await suite.test("exact Bearer bypasses session guard; whole authorized body/counts/headers and token audit", async () => {
      configure(); delete process.env.DATABASE_URL; delete process.env.ADMIN_EMAILS; process.env.MONGODB_URI = RAW;
      const log = audit();
      const result = await actors.run(null, () => runWithDataRepositories({ adminBackup: port, requestActivity: log.repository }, () => POST(request())));
      await response(result); auditRecord(log, 200, "token_request", null, result.headers.get("x-request-id"));
      assert.equal(reads, 1); assert.equal(authCalls, 0); noPG();
    });
    await suite.test("wrong/absent secret with permitted session succeeds; authorization header retains token attribution", async () => {
      for (const entry of [{ authorization: "Bearer incorrect", configured: true }, { authorization: null, configured: true },
        { authorization: `Bearer ${SECRET}`, configured: false }]) {
        const { authorization } = entry;
        configure(); process.env.ADMIN_EMAILS = ` other@day1company.co.kr, ${ADMIN.toUpperCase()} `;
        if (!entry.configured) delete process.env.BACKUP_API_SECRET;
        const log = audit(); const result = await actors.run(actor(ADMIN.toUpperCase()), () => runWithDataRepositories({ adminBackup: port, requestActivity: log.repository }, () => POST(request(authorization))));
        await response(result); auditRecord(log, 200, authorization ? "token_request" : "user", authorization ? null : ADMIN, result.headers.get("x-request-id"));
        assert.equal(reads, 1); assert.equal(authCalls, authorization ? 1 : 2); noPG();
      }
    });
    await suite.test("missing/wrong secret, workspace nonadmin, external listed admin and unconfigured admins deny before read", async () => {
      const cases: Array<{ session: Session; admins: string; secret?: string; authorization: string | null }> = [
        { session: null, admins: ADMIN, secret: SECRET, authorization: "Bearer incorrect" },
        { session: null, admins: ADMIN, authorization: `Bearer ${SECRET}` },
        { session: actor("member@day1company.co.kr"), admins: ADMIN, secret: SECRET, authorization: null },
        { session: actor("external@example.invalid"), admins: "external@example.invalid", secret: SECRET, authorization: "Bearer incorrect" },
        { session: actor(ADMIN), admins: "", secret: SECRET, authorization: null },
        { session: null, admins: ADMIN, secret: SECRET, authorization: `bearer ${SECRET}` }
      ];
      for (const entry of cases) {
        configure(); process.env.ADMIN_EMAILS = entry.admins;
        if (entry.secret === undefined) delete process.env.BACKUP_API_SECRET; else process.env.BACKUP_API_SECRET = entry.secret;
        const log = audit();
        await actors.run(entry.session, () => runWithDataRepositories({ adminBackup: port, requestActivity: log.repository }, async () => {
          await assert.rejects(POST(request(entry.authorization)), { message: DENIED });
        }));
        assert.equal(reads, 0); assert.equal(log.records.length, 1); assert.equal(log.records[0].status, 500); noPG(); observedClean();
      }
    });
    await suite.test("development bypass in wrapper does not bypass the actual PII session guard", async () => {
      configure(); Object.assign(process.env, { NODE_ENV: "development", DEV_AUTH_BYPASS: "true", DEV_AUTH_EMAIL: ADMIN });
      const log = audit();
      await actors.run(null, () => runWithDataRepositories({ adminBackup: port, requestActivity: log.repository }, async () => {
        await assert.rejects(POST(request(null)), { message: DENIED });
      }));
      assert.equal(reads, 0); assert.equal(authCalls, 1); assert.equal(log.records[0].context.actorType, "development");
      assert.equal(log.records[0].status, 500); noPG(); observedClean();
    });
    await suite.test("requestActivity missing rejects before auth/handler; adminBackup missing rejects without PG fallback and audits500", async () => {
      configure();
      for (const scope of [{}, { adminBackup: port }]) await runWithDataRepositories(scope, async () => {
        await assert.rejects(POST(request(null)), { message: "DATA_REPOSITORY_NOT_CONFIGURED: requestActivity" });
      });
      assert.equal(authCalls, 0); assert.equal(reads, 0);
      const log = audit(); await runWithDataRepositories({ requestActivity: log.repository }, async () => {
        assert.throws(() => getAdminBackupRepository(), { message: "DATA_REPOSITORY_NOT_CONFIGURED: adminBackup" });
        await assert.rejects(POST(request()), { message: "DATA_REPOSITORY_NOT_CONFIGURED: adminBackup" });
      });
      auditRecord(log, 500, "token_request", null); assert.equal(reads, 0); noPG(); observedClean();
    });
    await suite.test("nested scopes do not inherit either port and restore outer identity after rejection", async () => {
      configure(); const log = audit();
      await runWithDataRepositories({ adminBackup: port, requestActivity: log.repository }, async () => {
        assert.equal(getAdminBackupRepository(), port);
        await runWithDataRepositories({}, async () => {
          assert.throws(() => getAdminBackupRepository(), { message: "DATA_REPOSITORY_NOT_CONFIGURED: adminBackup" });
          await assert.rejects(POST(request()), { message: "DATA_REPOSITORY_NOT_CONFIGURED: requestActivity" });
        });
        await runWithDataRepositories({ adminBackup: port }, async () => { await assert.rejects(POST(request()), { message: "DATA_REPOSITORY_NOT_CONFIGURED: requestActivity" }); });
        await Promise.resolve(); assert.equal(getAdminBackupRepository(), port); await response(await POST(request()));
      });
      assert.equal(reads, 1); auditRecord(log, 200, "token_request", null); noPG(); observedClean();
    });
    await suite.test("concurrent A/B real routes keep separate payload, port, requestID and actor audit across barrier", { timeout: 5000 }, async () => {
      configure(); const both = gate(); let entered = 0;
      const ownership: boolean[] = [], aLog = audit(), bLog = audit();
      const a: AdminBackupRepository = { async read() { if (++entered === 2) both.release(); await both.promise; ownership.push(getAdminBackupRepository() === a); return structuredClone(DATA); } };
      const b: AdminBackupRepository = { async read() { if (++entered === 2) both.release(); await both.promise; ownership.push(getAdminBackupRepository() === b); return structuredClone(EMPTY); } };
      const [one, two] = await Promise.all([
        actors.run(actor(ADMIN), () => runWithDataRepositories({ adminBackup: a, requestActivity: aLog.repository }, () => POST(request(null)))),
        actors.run(null, () => runWithDataRepositories({ adminBackup: b, requestActivity: bLog.repository }, () => POST(request())))
      ]);
      await response(one); await response(two, EMPTY_EXPECTED); same(ownership, [true, true], "BACKUP_CONCURRENT_SCOPE"); assert.equal(entered, 2);
      auditRecord(aLog, 200, "user", ADMIN, one.headers.get("x-request-id")); auditRecord(bLog, 200, "token_request", null, two.headers.get("x-request-id"));
      assert.notEqual(one.headers.get("x-request-id"), two.headers.get("x-request-id")); noPG();
    });
    await suite.test("PG getter privacy and scope guards fail fixed before any synthetic IO", async () => {
      configure(); const repository = getAdminBackupRepository();
      await runWithDataRepositories({}, async () => {
        assert.throws(() => getPrismaClient(), { message: "DEFAULT_DATABASE_ACCESS_BLOCKED" });
        await assert.rejects(repository.read(), publicFailure);
      });
      process.env.PII_INDEX_KEY = "invalid-synthetic-key"; await assert.rejects(repository.read(), publicFailure); noPG();
      configure(); delete process.env.DATABASE_URL; await assert.rejects(repository.read(), publicFailure); noPG(); observedClean();
    });
    await suite.test("all environments sanitize PG Error/nonError/cause before actual POST rejects; no JSON error response or raw logs", async () => {
      let touched = 0;
      const hostile = { get message() { touched++; return PRIVATE; }, get cause() { touched++; return RAW; }, toString() { touched++; return SECRET; } };
      for (const environment of ["production", "development", "test"]) for (const value of [new Error(PRIVATE, { cause: new Error(RAW) }), PRIVATE, { cause: RAW }, undefined, null, hostile]) {
        configure(); Object.assign(process.env, { NODE_ENV: environment }); pgFailure = { value };
        await assert.rejects(POST(request()), publicFailure);
        queryContract(); assert.equal(pgAudit.length, 1); assert.equal(pgAudit[0].status, 500); observedClean();
      }
      assert.equal(touched, 0);
    });
    await suite.test("explicit repository fixed rejection propagates unchanged, read once, with500audit and no fallback", async () => {
      configure(); const failure = new Error(FAILED), log = audit(); let attempts = 0;
      await runWithDataRepositories({ adminBackup: { async read() { attempts++; throw failure; } }, requestActivity: log.repository }, async () => {
        await assert.rejects(POST(request()), error => error === failure && publicFailure(error));
      });
      assert.equal(attempts, 1); auditRecord(log, 500, "token_request", null); noPG(); observedClean();
    });
    await suite.test("request audit failure remains best effort with exact safe log and successful download", async () => {
      configure(); let writes = 0;
      const result = await runWithDataRepositories({ adminBackup: port, requestActivity: { async recordRequest() { writes++; throw new Error(PRIVATE, { cause: RAW }); } } }, () => POST(request()));
      same(logs, [["[activity] API request log write failed"]], "BACKUP_AUDIT_LOG_NOT_FIXED");
      logs.length = 0; await response(result); assert.equal(writes, 1); assert.equal(reads, 1); noPG();
    });
    await suite.test("same observers reject missing/extra/duplicate rows, wrong counts, top-level companion leakage and swallowed effects", async () => {
      configure();
      const mutations: Array<(body: typeof EXPECTED) => void> = [
        body => { body.data.coachFields.pop(); },
        body => { body.data.coachFields.push({ coachId: "extra", tagId: "extra" }); },
        body => { body.data.coachFields[1] = { ...body.data.coachFields[0] }; },
        body => { body.counts.coaches = 99; },
        body => { Object.assign(body.data.coaches[0], { namePiiIndex: "synthetic-hidden-index" }); }
      ];
      for (const mutate of mutations) {
        const changed = structuredClone(EXPECTED); mutate(changed);
        const fake = new NextResponse(JSON.stringify(changed), { headers: { "content-type": "application/json; charset=utf-8",
          "content-disposition": 'attachment; filename="hub_om_coach_backup_2026-09-30.json"', "x-request-id": "00000000-0000-4000-8000-000000000001" } });
        await assert.rejects(response(fake), { name: "AssertionError", message: "BACKUP_WHOLE_BODY" });
      }
      const log = audit(); const result = await runWithDataRepositories({ adminBackup: { async read() {
        try { await fetch("https://example.invalid/forbidden-backup-source"); } catch { /* Real fetch trap, deliberately swallowed. */ }
        return structuredClone(DATA);
      } }, requestActivity: log.repository }, () => POST(request()));
      await assert.rejects(response(result), { name: "AssertionError", message: "BACKUP_UNEXPECTED_EFFECT" });
      same(unexpected, ["fetch"], "BACKUP_NEGATIVE_CONTROL_EVENT"); unexpected.length = 0;
      // Drive the same synthetic Prisma delegate observer used by the actual PG
      // repository: even a correct response cannot hide a wrong-backend read.
      const wrongBackend = await runWithDataRepositories({ adminBackup: { async read() {
        const delegate = Reflect.get(cached, "coach") as { findMany(): Promise<unknown> };
        await delegate.findMany(); return structuredClone(DATA);
      } }, requestActivity: audit().repository }, () => POST(request()));
      await response(wrongBackend);
      assert.throws(noPG, { name: "AssertionError", message: "BACKUP_PG_FALLBACK" });
      same(pgCalls, [{ name: "coach", args: [] }], "BACKUP_NEGATIVE_CONTROL_PG"); pgCalls.length = 0;
      console.info({ long: "x".repeat(1024), nested: { raw: PRIVATE, cause: RAW } });
      assert.throws(observedClean, { name: "AssertionError", message: "BACKUP_APPLICATION_OUTPUT" });
      logs.length = 0; observedClean(); noPG();
    });
  } finally {
    suite.mock.timers.reset(); hooks.deregister(); modules.forEach(module => module.restore());
    fetchTrap.mock.restore(); captures.forEach(capture => capture.mock.restore());
    if (previous === undefined) delete globals.prisma; else globals.prisma = previous;
    for (const name of envNames) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  }
});
