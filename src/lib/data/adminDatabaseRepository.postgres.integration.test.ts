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
import { getPrismaClient } from "./prisma";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { readDatabaseDashboard as originalDashboard, type DatabaseDashboardSnapshot } from "./adminDatabaseOriginalOracle.fixture";
import type { AdminDatabaseRepository, AdminDatabaseCellUpdate } from "./adminDatabaseRepository";
import { PrismaAdminDatabaseRepository } from "./prismaAdminDatabaseRepository";
import { MongoAdminDatabaseRepository, prepareMongoAdminDatabaseStore } from "./mongoAdminDatabaseRepository";

const pgUrl = process.env.ADMIN_DATABASE_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_ADMIN_DATABASE_TEST_URI;
const id = (n: number) => `adbaabcd-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (n: number) => new Date(`2099-01-${String(n).padStart(2, "0")}T00:00:00.000Z`);
const models = ["Company", "Course", "OperationSession", "Member", "DataImportRun", "OperationSourceRecord", "DriveImportRun", "DriveImportResult", "ActivityChange"] as const;
const tables = ["companies", "courses", "operation_sessions", "members", "data_import_runs", "operation_source_records", "drive_import_runs", "drive_import_results", "activity_changes"] as const;
const actor = { requestId: id(9000), route: "/api/admin/database/cell", method: "PATCH", actorEmail: "synthetic-editor@example.invalid", actorName: "Synthetic private admin", actorType: "user" as const };
type Database = ReturnType<typeof getPrismaClient>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("4db4cf6 dashboard query AND formatter oracle are byte-identical", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("./adminDatabaseOriginalOracle.fixture.ts", import.meta.url))).digest("hex"), "e0eaed35f992b8bb638170fbd3c0cd4d99a313b965719c0495b985507e8df62f");
});

/** Frozen original route allowlist/branches after parseEditableValue. No new
 * presenter, update adapter, normalization or derived-status helper is called.
 * HTTP parsing/auth/null-JSON behavior is owned by the separate handler suite.
 */
const allowed: Record<string, readonly string[]> = {
  companies: ["name"], courses: ["courseId", "name", "operationType", "revenue"],
  members: ["role", "sourceTeam", "name", "roleTitle", "calendarId", "isActive", "displayOrder"],
  operation_sessions: ["operationStatus", "archiveStatus", "educationFormat", "operationChannel", "roundNo", "educationDays", "startDate", "endDate", "timeText", "omName", "ldName", "instructorsText", "coachText", "region", "onsiteRequired", "onsiteOmName", "specialNotes", "operationIssue", "omUpdate", "driveLink", "operationDetail", "companyWikiLink", "instructorWikiLink", "costRaw", "totalCost", "instructorCost", "operationCost", "avgSatisfaction", "instructorSatisfaction", "hasResultReport", "resultReportLink", "lectureManagementLink", "padletLink"]
};
async function originalUpdate(db: Database, input: AdminDatabaseCellUpdate): Promise<void> {
  if (!allowed[input.table]?.includes(input.field)) throw Object.assign(new Error("Synthetic read-only field"), { code: "READ_ONLY_FIELD" });
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  if (input.table === "companies") {
    await db.company.update({ data: input.field === "name" ? { name: String(input.value), normalizedName: normalize(String(input.value)) } : { [input.field]: input.value }, where: { id: input.rowId } }); return;
  }
  if (input.table === "courses") { await db.course.update({ data: { [input.field]: input.value }, where: { id: input.rowId } }); return; }
  if (input.table === "members") {
    await db.member.update({ data: input.field === "name" ? { name: String(input.value), normalizedName: normalize(String(input.value)) } : { [input.field]: input.value }, where: { id: input.rowId } }); return;
  }
  await db.operationSession.update({ data: { [input.field]: input.value, updatedBy: input.updatedBy }, where: { id: input.rowId } });
}
function fixture() {
  const data = new Map<string, MongoRow[]>();
  const add = (model: string, values: MongoRow) => data.set(model, [...(data.get(model) ?? []), coachFixtureRow(model, values)]);
  for (const [n, name] of [[1, "Synthetic Alpha"], [2, "Synthetic Beta"]] as const) add("Company", { id: id(n), name, normalizedName: name.toLowerCase(), createdAt: day(1), updatedAt: day(n) });
  for (const [n, name] of [[101, "Synthetic Course"], [102, "Synthetic Other Course"]] as const) add("Course", { id: id(n), companyId: id(1), processSeq: n, courseId: "SYNTHETIC-SHARED", name, operationType: "LONG", revenue: n === 101 ? "0.00" : null, createdAt: day(1), updatedAt: day(n - 100) });
  add("OperationSession", { id: id(301), operationId: "SYNTHETIC-OP", courseRecordId: id(101), startDate: day(1), endDate: day(2), educationDates: [day(1), day(2)],
    operationStatus: "DONE", archiveStatus: "DONE", educationFormat: "OFFLINE", operationChannel: "ONSITE", onsiteRequired: "N", hasResultReport: "YES",
    roundNo: "1", totalCost: "0.00", omName: null, ldName: "", onsiteText: "Synthetic private onsite unchanged", specialNotes: "Synthetic private note",
    deletedAt: day(3), deletedBy: "synthetic-deleter@example.invalid", updatedBy: "synthetic-old-editor@example.invalid", createdAt: day(1), updatedAt: day(3) });
  for (const [n, name, role, order, active, updated] of [[201, "Synthetic Member One", "OM", 0, true, 1], [202, "Synthetic Member Two", "OM", 5, true, 4], [203, "Synthetic Nullable", null, null, true, 5], [204, "Synthetic Nullable", null, -1, false, 6]] as const) add("Member", {
    id: id(n), name, normalizedName: name.toLowerCase(), role, sourceTeam: "TEAM_1", displayOrder: order, isActive: active,
    roleTitle: null, calendarId: null, createdAt: day(1), updatedAt: day(updated)
  });
  add("DataImportRun", { id: id(401), sourceTeam: "TEAM_2", sourceType: "synthetic", sourceName: "Synthetic private import", fileName: "synthetic-file", status: "COMPLETED_WITH_ERRORS", rowCount: 4, successCount: 3, errorCount: 1, startedAt: day(4), finishedAt: day(5) });
  const summaries: Array<[unknown, unknown, unknown]> = [
    [{ private: "synthetic-raw-secret", another: 1 }, [1, 2], { invalid: true }],
    [MongoJsonNull, MongoDbNull, MongoJsonNull], [{}, [], {}], ["Synthetic scalar display", 0, false]
  ];
  summaries.forEach(([rowSnapshot, mappedFields, validationErrors], index) => add("OperationSourceRecord", {
    id: id(501 + index), importRunId: id(401), operationSessionId: index === 0 ? id(301) : null, sourceTeam: "TEAM_2", sourceWorkbook: "Synthetic Workbook", sourceSheet: "Synthetic Sheet", sourceRowNumber: index + 1,
    sourceFingerprint: index === 0 ? "synthetic-fingerprint-long" : null, rowSnapshot, mappedFields, validationErrors, createdAt: day(8 - index)
  }));
  add("DriveImportRun", { id: id(601), mode: "dry_run", status: "PENDING", operationCount: 1, scannedRefCount: 2, folderSearchCount: 3, errorCount: 0, startedAt: day(9), finishedAt: null });
  add("DriveImportResult", { id: id(701), runId: id(601), operationSessionId: id(301), operationId: "SYNTHETIC-OP", companyName: "Synthetic Alpha", courseName: "Synthetic Course",
    inputKind: "driveLink", resultKind: "error", candidateCount: 0, fileCount: 2, issues: ["synthetic issue"], error: "Synthetic visible error", createdAt: day(10) });
  return data;
}
const withoutGeneratedAt = (value: DatabaseDashboardSnapshot) => ({ tables: value.tables, totalRows: value.totalRows });
function assertFixedDashboard(value: DatabaseDashboardSnapshot) {
  assert.deepEqual(value.tables.map(table => [table.key, table.title, table.rowCount]), [
    ["companies", "기업", 2], ["courses", "과정", 2], ["operation_sessions", "운영 차수", 1], ["members", "구성원", 4],
    ["data_import_runs", "적재 실행", 1], ["operation_source_records", "원천 행", 4], ["drive_import_runs", "Drive 조회 실행", 1], ["drive_import_results", "Drive 조회 결과", 1]
  ]);
  assert.equal(value.totalRows, 16);
  const table = (key: string) => value.tables.find(row => row.key === key)!;
  const row = (key: string, n: number) => table(key).rows.find(value => value.id === id(n))!;
  const cell = (key: string, n: number, label: string) => row(key, n).cells.find(value => value.label === label)!;
  assert.deepEqual(table("companies").rows.map(row => row.id), [id(2), id(1)]);
  assert.equal(row("companies", 1).title, "Synthetic Alpha"); assert.equal(cell("companies", 1, "과정 연결").value, "있음");
  assert.equal(cell("companies", 2, "과정 연결").tone, "muted");
  assert.equal(cell("courses", 101, "과정ID").value, "PRC-000101");
  assert.equal(cell("courses", 101, "매출").rawValue, "0"); assert.equal(cell("courses", 101, "매출").value, "0");
  assert.equal(cell("courses", 102, "매출").rawValue, "");
  assert.equal(row("operation_sessions", 301).href, "/operations/SYNTHETIC-OP");
  assert.equal(row("operation_sessions", 301).title, "SYNTHETIC-OP · Synthetic Course");
  assert.equal(cell("operation_sessions", 301, "상태").value, "완료"); assert.equal(cell("operation_sessions", 301, "상태").rawValue, "DONE");
  assert.equal(cell("operation_sessions", 301, "시작일").rawValue, "2099-01-01");
  assert.equal(cell("operation_sessions", 301, "총비용").rawValue, "0");
  assert.equal(cell("operation_sessions", 301, "OM").tone, "warning"); assert.equal(cell("operation_sessions", 301, "LD").tone, "muted");
  assert.equal(cell("operation_sessions", 301, "삭제").tone, "warning");
  assert.deepEqual(table("members").rows.map(row => row.id), [id(201), id(202), id(203), id(204)]);
  assert.equal(table("members").latestActivity, day(1).toISOString(), "first sorted member, not max timestamp");
  assert.deepEqual(cell("members", 201, "역할").options, [{ label: "비움", value: "" }, { label: "OM", value: "OM" }, { label: "LD", value: "LD" }]);
  assert.equal(cell("members", 203, "표시순서").rawValue, ""); assert.equal(cell("members", 201, "표시순서").rawValue, "0");
  assert.equal(cell("members", 204, "활성").value, "비활성"); assert.equal(cell("members", 204, "활성").tone, "muted");
  assert.equal(cell("data_import_runs", 401, "성공/전체").value, "3/4"); assert.equal(cell("data_import_runs", 401, "상태").value, "오류 포함 완료");
  assert.equal(cell("data_import_runs", 401, "파일").value, "입력 있음"); assert.equal(cell("data_import_runs", 401, "오류").tone, "warning");
  for (const [n, source, mapped, validation] of [[501, "2개 필드", "2개 항목", "1개 필드"], [502, "-", "-", "-"], [503, "-", "-", "-"], [504, "Synthetic scalar display", "0", "false"]] as const) {
    assert.equal(cell("operation_source_records", n, "원천 요약").value, source);
    assert.equal(cell("operation_source_records", n, "매핑 요약").value, mapped);
    assert.equal(cell("operation_source_records", n, "검증").value, validation);
  }
  assert.equal(cell("operation_source_records", 502, "운영").value, "미연결"); assert.equal(cell("operation_source_records", 502, "운영").tone, "warning");
  assert.equal(cell("operation_source_records", 504, "검증").tone, "warning", "false is scalar content in original formatter");
  assert.equal(cell("drive_import_runs", 601, "모드").value, "드라이런"); assert.equal(cell("drive_import_runs", 601, "완료").value, "진행/미완료");
  assert.equal(cell("drive_import_results", 701, "입력").value, "Drive 값"); assert.equal(cell("drive_import_results", 701, "이슈").value, "1개 항목");
  assert.equal(cell("drive_import_results", 701, "오류").value, "Synthetic visible error"); assert.equal(row("drive_import_results", 701).href, "/operations/SYNTHETIC-OP");
  assert.equal(cell("companies", 1, "생성").value, "99. 1. 1. 오전 9:00", "Seoul datetime, not UTC display");
}
const statusOf = (error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return code === "P2002" ? 409 : code === "P2025" ? 404 : code === "READ_ONLY_FIELD" ? 403 : 500;
};

// Main owns real execution/server lifecycle. This suite resets only the exact named
// disposable PG database and cleans only its own random Mongo namespace.
test("admin database: frozen dashboard/new PG/native Mongo 8-table DTO and 4-table edit parity", { skip: !pgUrl || !mongoUri, timeout: 240_000 }, async suite => {
  const p = new URL(pgUrl!), m = new URL(mongoUri!);
  assert.ok(["postgres:", "postgresql:"].includes(p.protocol)); assert.equal(p.hostname, "127.0.0.1"); assert.equal(p.username, "synthetic");
  assert.equal(p.password, ""); assert.ok(p.port); assert.equal(p.pathname, "/admin_database_parity"); assert.equal(p.search, ""); assert.equal(p.hash, "");
  assert.equal(m.protocol, "mongodb:"); assert.equal(m.hostname, "127.0.0.1"); assert.ok(m.port); assert.equal(m.username, ""); assert.equal(m.password, "");
  assert.equal(m.pathname, "/"); assert.equal(m.hash, ""); assert.deepEqual([...m.searchParams.keys()], ["replicaSet"]); assert.ok(m.searchParams.get("replicaSet"));
  const names = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: pgUrl, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: pgUrl }); const client = new MongoClient(mongoUri!, { serverSelectionTimeoutMS: 5000 });
  const namespace = `shadow_admin_database_pg_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName: "hub_om_shadow_admin_database_parity", namespace, allowShadowWrites: true as const };
  let db: Database | undefined, pgConnected = false, mongoConnected = false;
  try {
    await sql.connect(); pgConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0], { db: "admin_database_parity", usr: "synthetic" });
    await client.connect(); mongoConnected = true;
    const hello = await client.db("admin").command({ hello: 1 }); assert.equal(hello.isWritablePrimary, true); assert.equal(hello.setName, m.searchParams.get("replicaSet"));
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations"), migrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrations.length, 45);
    for (const migration of migrations) await sql.query(readFileSync(path.join(root, migration, "migration.sql"), "utf8"));
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    db = getPrismaClient(); const pgDb = db;
    await prepareMongoAdminDatabaseStore(options);
    const store = new MongoOperationStore(options, models), mongo = await MongoAdminDatabaseRepository.open(options);
    const data = fixture(), delegates = pgDb as unknown as Record<string, { createMany(args: { data: MongoRow[] }): Promise<unknown>; findMany(args: unknown): Promise<MongoRow[]> }>;
    const seedPg = async () => {
      await sql.query(`TRUNCATE ${tables.join(", ")} CASCADE`);
      for (const [model, rows] of data) await delegates[model[0].toLowerCase() + model.slice(1)].createMany({ data: rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === MongoDbNull ? Prisma.DbNull : value === MongoJsonNull ? Prisma.JsonNull : value]))) });
    };
    for (const [model, rows] of data) await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    const summaries: unknown[] = [];
    console.log(`[admin-database-pg] migrations=${migrations.length} oracle=4db4cf6 tables=8`);
    for (const backend of ["original PG", "new PG", "native Mongo"] as const) await suite.test(backend, async () => {
      const isMongo = backend === "native Mongo"; if (!isMongo) await seedPg();
      const repo: AdminDatabaseRepository = isMongo ? mongo : backend === "new PG" ? new PrismaAdminDatabaseRepository() : { readDashboard: originalDashboard, updateCell: input => originalUpdate(pgDb, input) };
      const rawRows = async (model: string): Promise<MongoRow[]> => isMongo ? await store.collection(model).find({}).sort({ _id: 1 }).toArray()
        : (await sql.query(`SELECT row_to_json(t) AS row FROM ${tables[models.indexOf(model as typeof models[number])]} t ORDER BY id`)).rows.map(entry => entry.row);
      const logicalRows = async (model: string): Promise<MongoRow[]> => isMongo ? (await rawRows(model)).map(row => decodeMongoRuntimeDocument(model, row as Parameters<typeof decodeMongoRuntimeDocument>[1])) : delegates[model[0].toLowerCase() + model.slice(1)].findMany({ orderBy: { id: "asc" } });
      const snapshot = async () => {
        const state: Record<string, string> = {};
        for (const model of models) state[model] = hash(await rawRows(model));
        return state;
      };
      const before = await snapshot(), dashboard = await repo.readDashboard();
      assertFixedDashboard(dashboard); assert.deepEqual(await snapshot(), before);
      if (!isMongo) assert.deepEqual(withoutGeneratedAt(dashboard), withoutGeneratedAt(await originalDashboard()));
      const outcomes: unknown[] = [];
      let request = 9100;
      const input = (table: AdminDatabaseCellUpdate["table"], field: string, n: number, value: AdminDatabaseCellUpdate["value"], rowId = id(n)): AdminDatabaseCellUpdate => ({ table, field, rowId, value, updatedBy: actor.actorEmail });
      const errorCase = async (value: AdminDatabaseCellUpdate, expectedStatus: number) => {
        const beforeError = await snapshot(); let failed = false;
        try { await activityContext.run({ ...actor, requestId: id(request++) }, () => repo.updateCell(value)); }
        catch (error) { failed = true; assert.equal(statusOf(error), expectedStatus); }
        assert.equal(failed, true, "expected a rejected edit"); assert.deepEqual(await snapshot(), beforeError);
        outcomes.push({ table: value.table, field: value.field, status: expectedStatus });
      };
      const edit = async (value: AdminDatabaseCellUpdate, expected: unknown, scenario: string | null = null) => {
        const model = models[tables.indexOf(value.table)], canonicalId = value.rowId.replace(/[{}-]/g, "").toLowerCase();
        const match = (row: MongoRow) => String(row.id ?? row._id).replaceAll("-", "") === canonicalId;
        const beforeRows = await rawRows(model), old = beforeRows.find(match)!;
        const oldAuditCount = (await logicalRows("ActivityChange")).length;
        await delay(3); const start = Date.now();
        await activityContext.run({ ...actor, requestId: id(request++) }, () => repo.updateCell(value));
        const afterRows = await rawRows(model), afterRow = afterRows.find(match)!, logical = (await logicalRows(model)).find(match)!;
        const actual = value.field === "revenue" || ["totalCost", "instructorCost", "operationCost"].includes(value.field) ? logical[value.field] === null ? null : Number(String(logical[value.field])) : logical[value.field];
        assert.deepEqual(actual, expected);
        assert.ok(logical.updatedAt instanceof Date); assert.ok(logical.updatedAt.getTime() >= start && logical.updatedAt.getTime() <= Date.now());
        const millis = (value: unknown) => value instanceof Date ? value.getTime() : Date.parse(String(value));
        assert.notEqual(millis(afterRow[isMongo ? "updatedAt" : "updated_at"]), millis(old[isMongo ? "updatedAt" : "updated_at"]));
        const fieldColumn = (field: string) => model === "Course" && field === "name" ? "course_name" : field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        const changed = [value.field, `${value.field}PiiIndex`, `${value.field}Encrypted`, "updatedAt"];
        if ((model === "Company" || model === "Member") && value.field === "name") {
          changed.push("normalizedName", "normalizedNamePiiIndex");
          assert.equal(logical.normalizedName, String(value.value).trim().replace(/\s+/g, " ").toLowerCase());
        }
        if (model === "OperationSession") { changed.push("updatedBy", "updatedByPiiIndex"); assert.equal(logical.updatedBy, value.updatedBy); }
        const allowedColumns = new Set(isMongo ? changed : changed.map(fieldColumn));
        const strip = (row: MongoRow) => Object.fromEntries(Object.entries(row).filter(([key]) => !allowedColumns.has(key)));
        assert.deepEqual(strip(afterRow), strip(old), "unrelated raw/private ciphertext and derived fields stay unchanged");
        assert.deepEqual(afterRows.filter(row => !match(row)), beforeRows.filter(row => !match(row)));
        const audit = await logicalRows("ActivityChange");
        outcomes.push({ table: value.table, field: value.field, actual, auditDelta: audit.length - oldAuditCount, scenario });
        if (scenario) console.log(`[admin-database-pg] backend=${backend} scenario=${scenario} auditDelta=${audit.length - oldAuditCount}`);
        return audit.filter(row => row.requestId === id(request - 1));
      };
      // Existing rows are genuinely present under all four accepted PG UUID spellings.
      for (const [table, field, n, value] of [["companies", "name", 1, "Synthetic Alpha"], ["courses", "name", 101, "Synthetic Course"], ["members", "name", 201, "Synthetic Member One"], ["operation_sessions", "roundNo", 301, "1"]] as const) {
        const compact = id(n).replaceAll("-", "");
        for (const form of [id(n).toUpperCase(), compact, `{${id(n)}}`, compact.match(/.{4}/g)!.join("-")]) await edit(input(table, field, n, value, form), value);
        await errorCase(input(table, field, n, value, id(9999)), 404);
        await errorCase(input(table, field, n, value, "not-a-uuid"), 500);
        await errorCase(input(table, field, n, value, `${compact.slice(0, 3)}-${compact.slice(3)}`), 500);
      }
      // Unique collisions before changing any of the participating logical keys.
      await errorCase(input("companies", "name", 1, "Synthetic Beta"), 409);
      await errorCase(input("courses", "name", 102, "Synthetic Course"), 409);
      await errorCase(input("members", "name", 201, "Synthetic Member Two"), 409);
      await errorCase(input("courses", "courseId", 101, null), 500);
      await errorCase(input("members", "displayOrder", 201, 2147483648), 500);
      await errorCase(input("members", "displayOrder", 201, -2147483649), 500);
      await errorCase(input("courses", "revenue", 101, 999999999999.995), 500);
      await errorCase(input("courses", "revenue", 101, -999999999999.995), 500);
      await errorCase(input("courses", "processSeq", 101, 10), 403);
      await edit(input("companies", "name", 1, "Synthetic   Renamed Alpha"), "Synthetic   Renamed Alpha");
      await edit(input("members", "name", 201, "Synthetic   Renamed Member"), "Synthetic   Renamed Member");
      await edit(input("members", "name", 201, "Synthetic   Renamed Member"), "Synthetic   Renamed Member", "same-plaintext-Member.name");
      const nonPiiRepeat = await edit(input("courses", "name", 101, "Synthetic Course"), "Synthetic Course", "same-nonPII-Course.name");
      assert.equal(nonPiiRepeat.length, 0);
      // Nullable composite uniqueness: duplicate normalized name is permitted with role NULL.
      await edit(input("members", "name", 203, "Synthetic Member Two"), "Synthetic Member Two");
      const roleAudit = await edit(input("members", "role", 201, "LD"), "LD");
      assert.equal(roleAudit.length, 1); assert.deepEqual(roleAudit[0].changes, { role: { before: "om", after: "ld" } });
      const teamAudit = await edit(input("members", "sourceTeam", 201, "TEAM_2"), "TEAM_2");
      assert.equal(teamAudit.length, 1); assert.deepEqual(teamAudit[0].changes, { source_team: { before: "team_1", after: "team_2" } });
      const titleAudit = await edit(input("members", "roleTitle", 201, "Synthetic private role title"), "Synthetic private role title");
      assert.deepEqual(titleAudit[0].changes, { role_title: { redacted: true } });
      await edit(input("members", "role", 201, null), null); await edit(input("members", "sourceTeam", 201, null), null);
      for (const value of [2147483647, -2147483648, 0, null]) await edit(input("members", "displayOrder", 201, value), value);
      await edit(input("members", "isActive", 201, false), false);
      for (const [value, expected] of [[1.005, 1.01], [-1.005, -1.01], [2.675, 2.68], [-2.675, -2.68], [999999999999.994, 999999999999.99], [-999999999999.994, -999999999999.99], [0, 0], [null, null]] as const) await edit(input("courses", "revenue", 101, value), expected);
      await edit(input("courses", "operationType", 101, "SHORT"), "SHORT");
      await edit(input("operation_sessions", "omName", 301, "Synthetic private new owner"), "Synthetic private new owner");
      await edit(input("operation_sessions", "omName", 301, "Synthetic private new owner"), "Synthetic private new owner", "same-plaintext-OperationSession.omName");
      await edit(input("operation_sessions", "onsiteRequired", 301, "Y"), "Y");
      await edit(input("operation_sessions", "startDate", 301, day(5)), day(5)); // Do not invent start<=end validation.
      // The route accepts JS year zero, but the real original PG adapter rejects it.
      // Preserve that DB failure, valid year endpoints and JS calendar rollover.
      const yearZero = new Date("0000-01-01T00:00:00.000Z");
      assert.equal(yearZero.toISOString(), "0000-01-01T00:00:00.000Z");
      await errorCase(input("operation_sessions", "startDate", 301, yearZero), 500);
      for (const iso of ["0001-01-01T00:00:00.000Z", "9999-12-31T00:00:00.000Z"]) {
        const boundary = new Date(iso);
        assert.equal(boundary.toISOString(), iso);
        await edit(input("operation_sessions", "startDate", 301, boundary), boundary, `date-boundary-${iso.slice(0, 4)}`);
      }
      const rollover = new Date("2099-02-31T00:00:00.000Z");
      assert.equal(rollover.toISOString(), "2099-03-03T00:00:00.000Z");
      await edit(input("operation_sessions", "startDate", 301, rollover), new Date("2099-03-03T00:00:00.000Z"), "date-rollover");
      await edit(input("operation_sessions", "totalCost", 301, -1.005), -1.01);
      await edit({ ...input("operation_sessions", "totalCost", 301, null), updatedBy: null }, null);
      const session = (await logicalRows("OperationSession"))[0]; assert.equal(session.deletedAt instanceof Date && session.deletedAt.toISOString(), day(3).toISOString());
      assert.equal(session.updatedBy, null);
      const sessionRaw = (await rawRows("OperationSession"))[0]; assert.equal(sessionRaw[isMongo ? "updatedByPiiIndex" : "updated_by_pii_index"], null);
      const current = await logicalRows("Member"), unchangedNullMember = current.find(row => row.id === id(204))!;
      assert.equal(unchangedNullMember.role, null); assert.equal(unchangedNullMember.normalizedName, "synthetic nullable");
      const allAudits = await logicalRows("ActivityChange");
      for (const row of allAudits) { assert.equal(row.actorEmail, actor.actorEmail); assert.equal(row.actorName, actor.actorName); assert.equal(row.route, actor.route); }
      const normalizeAudit = (rows: MongoRow[]) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "occurredAt", "actorEmailPiiIndex", "actorNamePiiIndex"].includes(key)))).sort((a, b) => String(a.requestId).localeCompare(String(b.requestId)));
      const after = await snapshot();
      for (const model of ["DataImportRun", "OperationSourceRecord", "DriveImportRun", "DriveImportResult"]) assert.equal(after[model], before[model], `${model} relation unchanged`);
      const secrets = [actor.actorEmail, actor.actorName, "Synthetic private new owner", "Synthetic private note", "Synthetic private onsite unchanged", "Synthetic private role title", "Synthetic Member Two", "synthetic-last-editor@example.invalid", "synthetic-raw-secret"];
      for (const model of ["Member", "OperationSession", "OperationSourceRecord", "ActivityChange"]) {
        const raw = JSON.stringify(await rawRows(model)); for (const secret of secrets) assert.equal(raw.includes(secret), false, `${model} raw privacy`);
      }
      summaries.push({ dashboard: withoutGeneratedAt(dashboard), outcomes, audit: normalizeAudit(allAudits) });
    });
    assert.equal(summaries.length, 3); assert.deepEqual(summaries[1], summaries[0]); assert.deepEqual(summaries[2], summaries[0]);
  } finally {
    try { if (db) await db.$disconnect(); }
    finally {
      try { if (pgConnected) await sql.end(); }
      finally {
        try {
          if (mongoConnected) {
            assert.match(namespace, /^shadow_admin_database_pg_[a-f0-9]{16}$/);
            const owned = await client.db(options.databaseName).listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray();
            for (const collection of owned) { assert.ok(collection.name.startsWith(`${namespace}_`)); await client.db(options.databaseName).collection(collection.name).drop(); }
          }
        } finally { await client.close(); for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
      }
    }
  }
});
