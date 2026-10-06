/** Actual upload/page/promotion boundaries for plan-v2 / validation-v2 (V1, V3, V5, V6, V8).
 * Parent owns execution. Opt in with a loopback MONGODB_IMPORT_STAGING_TEST_URI replica set.
 * Auth supplies identities; UI only captures props. Guards, parser, facade, repositories,
 * withActivity and getPrismaClient stay real, except for the explicitly labelled
 * repository-error injection case exercising the POST catch allowlist directly.
 * No shared test helper is required.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { MongoClient, MongoServerError } from "mongodb";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import * as XLSX from "xlsx";
import { runWithDataRepositories, type DataRepositories } from "./dataRepositoryContext";
import { MongoInstructorNoteRepository, INSTRUCTOR_NOTE_MODELS } from "./mongoInstructorNoteRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { MongoRequestAuditRepository, REQUEST_AUDIT_MODELS, prepareMongoRequestAuditStore } from "./mongoRequestAuditRepository";
import { MongoOperationStore, completeMongoRow, operationMongoValidator } from "./mongoOperationStore";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import type { ImportRunDetail, ImportRunSummary } from "./importTypes";

const LIMIT = 5 * 1024 * 1024;
const PRIVATE = "synthetic-import-private-marker";
const GENERIC_ERROR = "파일을 import staging에 저장하지 못했습니다.";
type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "import-admin@day1company.co.kr", name: `${PRIVATE}-admin` }, expires: "" };
const member: Session = { user: { email: "import-member@day1company.co.kr", name: `${PRIVATE}-member` }, expires: "" };
const outsider: Session = { user: { email: "import-outsider@example.invalid", name: "Synthetic outsider" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });

// The tripwire is BELOW the actual PG guard. Mocking ./prisma would make the
// promotion test pass even if assertDefaultDatabaseAccess were accidentally removed.
let pgCalls = 0, localCalls = 0, notionCalls = 0, calendarCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
  constructor() { pgCalls++; throw new Error("PG_ADAPTER_TRIPWIRE"); }
} } });
mock.module("./localJsonTeamMemberRepository", { namedExports: { LocalJsonTeamMemberRepository: class {
  constructor() { localCalls++; throw new Error("LOCAL_ROSTER_TRIPWIRE"); }
} } });
mock.module("./localJsonInstructorNoteRepository", { namedExports: { LocalJsonInstructorNoteRepository: class {
  constructor() { localCalls++; throw new Error("LOCAL_INSTRUCTOR_TRIPWIRE"); }
} } });
mock.module("./notionTeamMemberRepository", { namedExports: { getNotionTeamMemberRepository: () => {
  notionCalls++; throw new Error("NOTION_ROSTER_TRIPWIRE");
} } });
mock.module("@/lib/googleCalendar/backfillCalendarEvents", { namedExports: { backfillMissingCalendarEvents: async () => {
  calendarCalls++; throw new Error("CALENDAR_TRIPWIRE");
} } });

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/features/imports/ImportAdminDashboard") return {
      url: "data:text/javascript,export function ImportAdminDashboard(){return null;} export function ImportRunDetailView(){return null;}",
      shortCircuit: true
    };
    return next(["next/server", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText, shortCircuit: true };
    return next(url, context);
  }
});
// Contract supplied by parent: IMPORT_MODELS, prepareMongoImportStore and open({allowShadowWrites:true}).
const { IMPORT_MODELS, MongoImportRepository, prepareMongoImportStore } = await import("./mongoImportRepository");
const { getPrismaClient } = await import("./prisma");
const { POST: uploadPOST } = await import("../../app/api/admin/imports/upload/route");
const { POST: promotePOST } = await import("../../app/api/admin/imports/[id]/promote/route");
const { default: listPage } = await import("../../app/admin/imports/page");
const { default: detailPage } = await import("../../app/admin/imports/[id]/page");
hooks.deregister();

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function component(node: ReactNode, name: string) {
  const matches = elements(node).filter(element => typeof element.type === "function" && element.type.name === name);
  assert.equal(matches.length, 1, `Expected one ${name}`);
  return matches[0];
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function form(file?: File, fields: Record<string, string> = {}) {
  const data = new FormData();
  if (file) data.set("file", file);
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const request = (data: FormData) => new Request("https://example.invalid/api/admin/imports/upload", { method: "POST", body: data });
const names = (suffix = "a") => ({ om: `${PRIVATE}-om-${suffix}`, ld: `${PRIVATE}-ld-${suffix}`, instructors: `${PRIVATE}-instructor-${suffix}` });
const validRow = (suffix = "a") => ({ companyName: `${PRIVATE}-company-${suffix}`, courseName: `${PRIVATE}-course-${suffix}`,
  startDate: "2026-09-30", endDate: "2026-10-01", ...names(suffix) });
const jsonFile = (rows: unknown = [validRow()], name = `${PRIVATE}-${randomUUID()}.json`) => new File([JSON.stringify(rows)], name, { type: "application/json" });
function csvFile(name = `${PRIVATE}-${randomUUID()}.csv`) {
  const row = validRow();
  return new File([`${Object.keys(row).join(",")}\r\n${Object.values(row).join(",")}\r\n,,,,,,\r\n`], name, { type: "text/csv" });
}
function xlsxFile() {
  const row = validRow(), workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Synthetic workbook introduction"],
    Object.keys(row),
    [row.companyName, row.courseName, new Date(2026, 8, 30), new Date(2026, 9, 1), row.om, row.ld, row.instructors],
    []
  ], { cellDates: true });
  XLSX.utils.book_append_sheet(workbook, sheet, "First synthetic sheet");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([validRow("ignored-second-sheet")]), "Ignored synthetic sheet");
  const bytes: ArrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellDates: true });
  return new File([bytes], `${PRIVATE}-${randomUUID()}.xlsx`);
}
type UploadResult = { ok: true; importRunId: string; rowCount: number; storedCount: number; duplicateCount: number; errorCount: number; headerRowNumber: number };
async function uploaded(response: Response): Promise<UploadResult> {
  assert.equal(response.status, 200);
  const result = await response.json() as UploadResult;
  assert.equal(result.ok, true);
  assert.match(result.importRunId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.deepEqual(Object.keys(result).sort(), ["ok", "importRunId", "rowCount", "storedCount", "duplicateCount", "errorCount", "headerRowNumber"].sort());
  return result;
}
async function rejected(response: Response, error: string) {
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error });
}
function redirectTo(path: string) {
  return (error: unknown) => {
    assert.ok(error instanceof Error && "digest" in error);
    assert.equal(error.digest, `NEXT_REDIRECT;replace;${path};307;`);
    return true;
  };
}
const uri = process.env.MONGODB_IMPORT_STAGING_TEST_URI;

test("native Mongo actual import upload and admin review preserve boundaries", { skip: !uri, timeout: 240_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  // Disallow URI options that can redirect connection discovery away from loopback.
  for (const [key, value] of url.searchParams) {
    assert.ok(["replicaSet", "directConnection"].includes(key), `Unsupported test URI option: ${key}`);
    if (key === "directConnection") assert.equal(value, "true");
  }
  const environmentKeys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS",
    "ADMIN_EMAILS", "DEV_AUTH_BYPASS", "DATABASE_URL", "OPERATION_DATA_SOURCE"];
  const savedEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));
  const globals = globalThis as unknown as { prisma?: unknown };
  const savedPrisma = globals.prisma;
  delete globals.prisma;
  Object.assign(process.env, {
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email,
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/import_tripwire", OPERATION_DATA_SOURCE: "local"
  });
  delete process.env.DEV_AUTH_BYPASS;
  const databases = ["a", "b"].map(suffix => `hub_om_shadow_import_handlers_${randomBytes(8).toString("hex")}_${suffix}`);
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("EXTERNAL_FETCH_TRIPWIRE"); });
  const logs: unknown[][] = [];
  const loggers = ["error", "warn", "log"] as const;
  const captures = loggers.map(level => mock.method(console, level, (...values: unknown[]) => { logs.push(values); }));
  let connected = false;
  try {
    // Positive control proves this test can detect PG entry while preserving the real guard.
    assert.throws(() => getPrismaClient(), /PG_ADAPTER_TRIPWIRE/);
    assert.equal(pgCalls, 1); pgCalls = 0;
    await client.connect(); connected = true;
    assert.deepEqual([...IMPORT_MODELS], ["DataImportRun", "OperationSourceRecord", "OperationSession", "Course", "Company"]);
    const models = [...new Set([...IMPORT_MODELS, ...TEAM_READ_MODELS, ...INSTRUCTOR_NOTE_MODELS, ...REQUEST_AUDIT_MODELS])];
    async function setup(databaseName: string, suffix: string) {
      const options = { client, databaseName, namespace: "shadow_import_handlers", allowShadowWrites: true as const };
      await prepareMongoImportStore(options);
      await prepareMongoReadStore(options, TEAM_READ_MODELS);
      await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
      await prepareMongoRequestAuditStore(options);
      const store = new MongoOperationStore(options, models);
      for (const role of ["OM", "LD"] as const) {
        const row = completeMongoRow("TeamUser", { id: randomUUID(), name: names(suffix)[role === "OM" ? "om" : "ld"],
          email: `synthetic-${role.toLowerCase()}-${suffix}@example.invalid`, slackId: `synthetic-${role}-${suffix}`,
          team: "1팀", role, createdAt: new Date() });
        await store.collection("TeamUser").insertOne(encodeMongoRuntimeDocument("TeamUser", row));
      }
      const now = new Date();
      await store.collection("InstructorNote").insertOne(encodeMongoRuntimeDocument("InstructorNote", completeMongoRow("InstructorNote", {
        id: randomUUID(), instructorName: `${PRIVATE}-original-instructor-${suffix}`, displayName: names(suffix).instructors,
        recruitAvoid: false, createdAt: now, updatedAt: now
      })));
      const scope = {
        imports: await MongoImportRepository.open(options),
        teamMembers: await MongoTeamMemberRepository.open(options),
        instructorNote: await MongoInstructorNoteRepository.open(options),
        requestActivity: await MongoRequestAuditRepository.open(options)
      };
      return { store, scope };
    }
    const a = await setup(databases[0], "a"), b = await setup(databases[1], "b");
    const run = <T>(work: () => Promise<T>, actor: Session | null = admin, scope: Partial<DataRepositories> = a.scope) =>
      runWithDataRepositories(scope, () => actors.run(actor, work));
    const upload = (data: FormData, actor: Session | null = admin, scope: Partial<DataRepositories> = a.scope) => run(() => uploadPOST(request(data)), actor, scope);
    // Ciphertext, IDs and dates are compared exactly. Only independent request audits
    // are excluded from business rollback assertions; no row/time normalization is used.
    async function rawBusiness(store = a.store) {
      const collections = (await store.db.listCollections({}, { nameOnly: true }).toArray())
        .map(item => item.name).filter(name => name !== store.collection("ActivityRequest").collectionName).sort();
      return Promise.all(collections.map(async name => [name, await store.db.collection(name).find({}).sort({ _id: 1 }).toArray()]));
    }
    async function audit(response: Response, actor = admin, store = a.store, route = "/api/admin/imports/upload") {
      const id = response.headers.get("X-Request-Id"); assert.ok(id);
      const row = await store.one("ActivityRequest", { _id: id }); assert.ok(row);
      assert.equal(row.id, id); assert.equal(row.actorEmail, actor.user.email); assert.equal(row.actorName, actor.user.name);
      assert.equal(row.actorType, "user"); assert.equal(row.route, route); assert.equal(row.method, "POST");
      assert.equal(row.status, response.status); assert.ok(typeof row.durationMs === "number" && row.durationMs >= 0);
      assert.equal(await store.collection("ActivityChange").countDocuments({ requestId: id }), 0);
      return row;
    }
    async function detail(id: string, scope: Partial<DataRepositories> = a.scope): Promise<ImportRunDetail> {
      return component(await run(() => detailPage(context(id)), admin, scope), "ImportRunDetailView").props.run as ImportRunDetail;
    }
    function noFallback() {
      assert.equal(pgCalls, 0); assert.equal(localCalls, 0); assert.equal(notionCalls, 0); assert.equal(calendarCalls, 0);
      assert.equal(external.mock.callCount(), 0);
    }

    await suite.test("without explicit scope actual upload and pages still select PG despite local/Notion environment", async () => {
      const before = await rawBusiness();
      for (const source of ["local", "notion"]) {
        process.env.OPERATION_DATA_SOURCE = source;
        const logStart = logs.length;
        // Only the downstream adapter throws: default factory, writer and audit are real.
        const response = await actors.run(member, () => uploadPOST(request(form(jsonFile()))));
        await rejected(response, GENERIC_ERROR);
        assert.equal(pgCalls, 2); // business entry plus best-effort request audit
        assert.deepEqual(logs.slice(logStart), [["[activity] API request log write failed"]]);
        await assert.rejects(actors.run(admin, () => listPage()), /PG_ADAPTER_TRIPWIRE/);
        await assert.rejects(actors.run(admin, () => detailPage(context(randomUUID()))), /PG_ADAPTER_TRIPWIRE/);
        assert.equal(pgCalls, 4); pgCalls = 0;
        noFallback();
      }
      process.env.OPERATION_DATA_SOURCE = "local";
      assert.deepEqual(await rawBusiness(), before);
      assert.equal(await a.store.collection("ActivityRequest").countDocuments(), 0);
    });

    await suite.test("actual guards distinguish workspace upload from both admin pages", async () => {
      const before = await rawBusiness();
      for (const actor of [null, outsider]) {
        const auditIds = new Set((await a.store.scan("ActivityRequest")).map(row => row.id));
        await assert.rejects(upload(form(jsonFile()), actor), redirectTo("/sign-in"));
        const added = (await a.store.scan("ActivityRequest")).filter(row => !auditIds.has(row.id));
        assert.equal(added.length, 1); assert.equal(added[0].status, 307); assert.equal(added[0].actorType, "anonymous");
        assert.equal(added[0].actorEmail, null); assert.equal(added[0].actorName, null);
      }
      // Empty scope proves page authorization runs before attempting repository access.
      for (const actor of [null, outsider, member]) {
        await assert.rejects(run(() => listPage(), actor, {}), redirectTo("/dashboard"));
        await assert.rejects(run(() => detailPage(context(randomUUID())), actor, {}), redirectTo("/dashboard"));
      }
      assert.deepEqual(await rawBusiness(), before);
      assert.deepEqual(component(await run(() => listPage()), "ImportAdminDashboard").props, { runs: [] });
      const response = await upload(form(jsonFile()), member), result = await uploaded(response);
      assert.equal(result.errorCount, 0); assert.equal((await detail(result.importRunId)).importedBy, member.user.email);
      await audit(response, member); noFallback();
    });

    await suite.test("missing file, >5MiB, empty files and empty rows reject without staging mutations", async () => {
      const before = await rawBusiness();
      const textFile = form(); textFile.set("file", "not a File");
      const cases: Array<[FormData, string]> = [
        [form(), "업로드할 파일을 선택해 주세요."], [textFile, "업로드할 파일을 선택해 주세요."],
        [form(new File([new Uint8Array(LIMIT + 1)], "oversize.json")), "파일은 5MB 이하만 업로드할 수 있습니다."],
        [form(new File([], "empty.csv")), "헤더로 사용할 행을 찾지 못했습니다. 시트에 제목 행과 데이터가 있는지 확인해 주세요."],
        [form(new File([], "empty.json")), GENERIC_ERROR],
        [form(jsonFile([])), "저장할 row가 없습니다."],
        [form(jsonFile([{}, null, [], { companyName: "  " }])), "저장할 row가 없습니다."],
        [form(new File(["companyName,courseName\n,,\n"], "empty-rows.csv")), "저장할 row가 없습니다."]
      ];
      for (const [data, error] of cases) { const response = await upload(data); await rejected(response, error); await audit(response); }
      assert.deepEqual(await rawBusiness(), before); noFallback();
    });

    await suite.test("synthetic JSON/CSV/XLSX use native roster and first sheet, preserve defaults and return real UI props", async () => {
      for (const file of [jsonFile({ rows: [validRow(), {}] }), csvFile(), xlsxFile()]) {
        const started = Date.now();
        const response = await upload(form(file, { sourceName: "  ", sourceType: " ", sourceSheet: " " }));
        const finished = Date.now(), result = await uploaded(response);
        assert.deepEqual({ ...result, importRunId: "id" }, { ok: true, importRunId: "id", rowCount: 1, storedCount: 1,
          duplicateCount: 0, errorCount: 0, headerRowNumber: file.name.endsWith("xlsx") ? 2 : 1 });
        const row = await a.store.one("DataImportRun", { _id: result.importRunId }); assert.ok(row);
        assert.equal(row.fileName, file.name); assert.equal(row.workbookName, file.name); assert.equal(row.sourceName, file.name);
        assert.equal(row.sourceTeam, "UNKNOWN"); assert.equal(row.importedBy, admin.user.email);
        assert.equal(row.sourceType, file.name.endsWith("xlsx") ? "spreadsheet" : file.name.endsWith("csv") ? "csv" : "json");
        for (const key of ["startedAt", "finishedAt"] as const) {
          assert.ok(row[key] instanceof Date); assert.ok(row[key].getTime() >= started && row[key].getTime() <= finished);
        }
        assert.ok((row.finishedAt as Date).getTime() >= (row.startedAt as Date).getTime());
        const records = await a.store.scan("OperationSourceRecord", { importRunId: result.importRunId }); assert.equal(records.length, 1);
        assert.equal(records[0].sourceSheet, "upload"); assert.equal(records[0].sourceWorkbook, file.name);
        assert.equal(records[0].sourceRowNumber, file.name.endsWith("xlsx") ? 3 : 2);
        assert.deepEqual(records[0].mappedFields, validRow()); assert.deepEqual(records[0].validationErrors, []);
        const page = await detail(result.importRunId);
        assert.deepEqual(page, await a.scope.imports.getImportRunById(result.importRunId));
        assert.equal(page.fileName, file.name); assert.equal(page.sourceTeam, "미확인"); assert.equal(page.status, "완료");
        assert.equal(page.sourceRecordCount, 1); assert.equal(page.records[0].reviewStatus, "적용 준비");
        assert.deepEqual(page.records[0].validationErrors, []); assert.equal(page.records[0].linkedOperation, null);
        assert.equal(page.records[0].linkedOperationId, "");
        const visible = JSON.stringify(page); assert.ok(visible.includes(validRow().companyName)); assert.ok(visible.includes(names().instructors));
        const runs = component(await run(() => listPage()), "ImportAdminDashboard").props.runs as ImportRunSummary[];
        assert.deepEqual(runs, await a.scope.imports.listImportRuns()); assert.ok(runs.some(run => run.id === page.id));
        await audit(response);
      }
      await assert.rejects(run(() => detailPage(context(randomUUID()))), /NEXT_HTTP_ERROR_FALLBACK;404/);
      noFallback();
    });

    await suite.test("actual detail accepts UUID aliases and both pages reject damaged ciphertext without partial props", async () => {
      const result = await uploaded(await upload(form(jsonFile()))), expected = await detail(result.importRunId);
      for (const id of [result.importRunId.toUpperCase(), result.importRunId.replaceAll("-", ""), `{${result.importRunId}}`]) {
        assert.deepEqual(await detail(id), expected);
      }
      await assert.rejects(run(() => detailPage(context("not-a-uuid"))), /IMPORT_INVALID_UUID/);
      const collection = a.store.collection("DataImportRun"), original = await collection.findOne({ _id: result.importRunId });
      assert.ok(original);
      await collection.updateOne({ _id: result.importRunId }, { $set: { sourceName: PRIVATE } }, { bypassDocumentValidation: true });
      const corrupted = await rawBusiness(), logStart = logs.length;
      try {
        for (const page of [() => listPage(), () => detailPage(context(result.importRunId))]) {
          await assert.rejects(run(page), error => {
            assert.ok(error instanceof Error); assert.match(error.message, /IMPORT_FAILED/);
            assert.ok(!error.message.includes(PRIVATE)); return true;
          });
        }
        assert.deepEqual(await rawBusiness(), corrupted);
        assert.ok(!inspect(logs.slice(logStart), { depth: null }).includes(PRIVATE)); noFallback();
      } finally { await collection.replaceOne({ _id: result.importRunId }, original); }
    });

    await suite.test("exact 5MiB is accepted; team aliases, explicit metadata and import-year boundaries remain intact", async () => {
      const text = JSON.stringify([validRow()]);
      const file = new File([text, " ".repeat(LIMIT - Buffer.byteLength(text))], "exact-limit.json");
      assert.equal(file.size, LIMIT);
      const boundary = await uploaded(await upload(form(file))); assert.equal(boundary.storedCount, 1);
      const teams = [["team_1", "TEAM_1"], ["1팀", "TEAM_1"], ["team_2", "TEAM_2"], ["2팀", "TEAM_2"], ["TEAM_1", "UNKNOWN"], ["unknown", "UNKNOWN"]];
      for (const [value, expected] of teams) {
        const result = await uploaded(await upload(form(jsonFile(), { sourceTeam: ` ${value} `,
          sourceName: ` ${PRIVATE}-${randomUUID()} `, sourceSheet: " synthetic-sheet ", sourceType: " synthetic-type " })));
        const row = await a.store.one("DataImportRun", { _id: result.importRunId }); assert.ok(row);
        assert.equal(row.sourceTeam, expected); assert.equal(row.sourceType, "synthetic-type"); assert.equal(String(row.sourceName).trim(), row.sourceName);
        const records = await a.store.scan("OperationSourceRecord", { importRunId: result.importRunId });
        assert.equal(records[0].sourceSheet, "synthetic-sheet"); assert.equal(records[0].sourceTeam, expected);
      }
      for (const [year, expected] of [["2000", "2000-09-30"], [" 2100 ", "2100-09-30"], ["2027", "2027-09-30"],
        ["1999", "9/30"], ["2101", "9/30"], ["2026.5", "9/30"], ["invalid", "9/30"], ["", "9/30"]]) {
        const result = await uploaded(await upload(form(jsonFile([{ ...validRow(), startDate: "9/30" }]), { importYear: year })));
        const rows = await a.store.scan("OperationSourceRecord", { importRunId: result.importRunId });
        assert.equal((rows[0].mappedFields as Record<string, string>).startDate, expected);
      }
      noFallback();
    });

    await suite.test("invalid rows retain parser, OM/LD then instructor errors and reruns retain duplicate-only runs", async () => {
      const unknown = { om: `${PRIVATE}-unknown-om`, ld: `${PRIVATE}-unknown-ld`, instructors: `${PRIVATE}-unknown-instructor` };
      const bad = { ...validRow(), ...unknown, startDate: "not-a-date" };
      const file = jsonFile([validRow(), bad, validRow()]);
      const response = await upload(form(file)), result = await uploaded(response);
      assert.deepEqual({ ...result, importRunId: "id" }, { ok: true, importRunId: "id", rowCount: 3, storedCount: 2, duplicateCount: 1, errorCount: 2, headerRowNumber: 1 });
      const page = await detail(result.importRunId);
      assert.equal(page.successCount, 1); assert.equal(page.errorCount, 2); assert.equal(page.sourceRecordCount, 2);
      assert.deepEqual(page.records[1].validationErrors, ["시작일 형식을 확인해야 합니다.",
        `담당OM에 멤버 관리(팀 유저)에 없는 이름이 있습니다: ${unknown.om}`,
        `담당LD에 멤버 관리(팀 유저)에 없는 이름이 있습니다: ${unknown.ld}`,
        `강사에 강사DB 노션에 없는 이름이 있습니다: ${unknown.instructors}`]);
      assert.equal(page.records[1].reviewStatus, "확인 필요"); await audit(response);
      const repeat = await uploaded(await upload(form(file)));
      assert.notEqual(repeat.importRunId, result.importRunId);
      assert.equal(repeat.storedCount, 0); assert.equal(repeat.duplicateCount, 3); assert.equal(repeat.errorCount, 3);
      const duplicatePage = await detail(repeat.importRunId);
      assert.equal(duplicatePage.rowCount, 3); assert.equal(duplicatePage.successCount, 0); assert.equal(duplicatePage.validationLogCount, 3);
      assert.deepEqual(duplicatePage.records, []); noFallback();
    });

    await suite.test("native parser public errors and invalid JSON/XLSX never expose private payloads", async () => {
      const before = await rawBusiness(), logStart = logs.length;
      const cases: Array<[File, string]> = [
        [new File([PRIVATE], "unsupported.bin"), "CSV, JSON, 엑셀(xlsx) 파일만 업로드할 수 있습니다."],
        [jsonFile({ private: PRIVATE }), "JSON은 object 배열이거나 { rows: [...] } 형태여야 합니다."],
        // SheetJS accepts SpreadsheetML through the same real workbook reader.
        [new File(['<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"></Workbook>'], "no-sheets.xlsx"), "엑셀 파일에서 시트를 찾지 못했습니다."],
        [new File([`{"${PRIVATE}": invalid}`], "invalid.json"), GENERIC_ERROR],
        [new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04]), PRIVATE], "invalid.xlsx"), GENERIC_ERROR]
      ];
      for (const [file, message] of cases) { const response = await upload(form(file)); await rejected(response, message); await audit(response); }
      assert.deepEqual(await rawBusiness(), before); assert.ok(!inspect(logs.slice(logStart), { depth: null }).includes(PRIVATE)); noFallback();
    });

    await suite.test("error injection: actual POST allows only exact public messages, never prefixes or arbitrary Korean errors", async () => {
      // Deliberate repository-boundary injection, NOT a native Mongo failure.
      // The native-driver test below separately exercises actual server rejection.
      // Inject after the real parser/facade and outside Mongo's safe() wrapper so
      // IMPORT_FAILED cannot mask a startsWith/Korean-text regression in POST catch.
      const publicMessages = [
        "CSV, JSON, 엑셀(xlsx) 파일만 업로드할 수 있습니다.",
        "엑셀 파일에서 시트를 찾지 못했습니다.",
        "JSON은 object 배열이거나 { rows: [...] } 형태여야 합니다.",
        "헤더로 사용할 행을 찾지 못했습니다. 시트에 제목 행과 데이터가 있는지 확인해 주세요."
      ];
      const cases: Array<{ message: string; expected: string }> = [
        ...publicMessages.map(message => ({ message, expected: message })),
        ...publicMessages.map(message => ({ message: `${message} ${PRIVATE}`, expected: GENERIC_ERROR })),
        { message: `등록되지 않은 내부 저장 오류: ${PRIVATE}`, expected: GENERIC_ERROR }
      ];
      const constructors: Array<(message: string) => Error> = [
        message => new Error(message),
        // Driver-shaped fault injection; constructing MongoServerError is not
        // evidence that a native driver/server emitted this particular message.
        message => new MongoServerError({ message, code: 121 })
      ];
      const before = await rawBusiness(), original = a.scope.imports.storeParsedImport;
      const requestCount = await a.store.collection("ActivityRequest").countDocuments();
      for (const makeError of constructors) {
        for (const { message, expected } of cases) {
          const error = makeError(message), logStart = logs.length;
          const injected = mock.method(a.scope.imports, "storeParsedImport", async () => { throw error; });
          try {
            const response = await upload(form(jsonFile()));
            assert.equal(injected.mock.callCount(), 1);
            const [input] = injected.mock.calls[0].arguments;
            assert.ok(input); assert.equal(input.parsed.rows.length, 1);
            assert.ok(!(await response.clone().text()).includes(PRIVATE));
            await rejected(response, expected);
            await audit(response);
            assert.ok(!inspect(logs.slice(logStart), { depth: null }).includes(PRIVATE));
            assert.deepEqual(await rawBusiness(), before); noFallback();
          } finally { injected.mock.restore(); }
          assert.equal(a.scope.imports.storeParsedImport, original);
        }
      }
      assert.equal(await a.store.collection("ActivityRequest").countDocuments(), requestCount + cases.length * constructors.length);
    });

    await suite.test("native driver validation error contains private marker but actual POST rolls back and redacts it", async () => {
      const collection = a.store.collection("OperationSourceRecord"), before = await rawBusiness(), logStart = logs.length;
      const example = await collection.findOne({}); assert.ok(example);
      const validator = { $and: [operationMongoValidator("OperationSourceRecord"), { $jsonSchema: {
        description: PRIVATE, properties: { sourceRowNumber: { bsonType: "int", maximum: 0, description: PRIVATE } }
      } }] };
      await a.store.db.command({ collMod: collection.collectionName, validator });
      try {
        // Native positive control: the rejected document really produces a driver
        // exception with a sensitive body; neither parser nor driver is mocked.
        await assert.rejects(collection.insertOne({ ...example, _id: randomUUID() }), error => {
          assert.ok(error instanceof MongoServerError); assert.equal(error.code, 121);
          assert.ok(JSON.stringify(error.errInfo).includes(PRIVATE)); return true;
        });
        const response = await upload(form(jsonFile())); await rejected(response, GENERIC_ERROR); await audit(response);
        assert.deepEqual(await rawBusiness(), before);
        assert.ok(!inspect(logs.slice(logStart), { depth: null }).includes(PRIVATE)); noFallback();
      } finally { await a.store.db.command({ collMod: collection.collectionName, validator: operationMongoValidator("OperationSourceRecord") }); }
    });

    await suite.test("each missing scope blocks staging writes and PG/local/Notion fallback", async () => {
      for (const source of ["local", "notion", "postgres"]) {
        process.env.OPERATION_DATA_SOURCE = source;
        for (const missing of ["imports", "teamMembers", "instructorNote", "requestActivity"] as const) {
          const partial: Partial<DataRepositories> = { ...a.scope }; delete partial[missing];
          const before = await rawBusiness(), requestCount = await a.store.collection("ActivityRequest").countDocuments();
          if (missing === "requestActivity") {
            await assert.rejects(upload(form(jsonFile()), admin, partial), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
            assert.equal(await a.store.collection("ActivityRequest").countDocuments(), requestCount);
          } else {
            const response = await upload(form(jsonFile()), admin, partial);
            await rejected(response, GENERIC_ERROR); await audit(response);
            assert.equal(await a.store.collection("ActivityRequest").countDocuments(), requestCount + 1);
          }
          assert.deepEqual(await rawBusiness(), before); noFallback();
        }
      }
      process.env.OPERATION_DATA_SOURCE = "local";
      const before = await rawBusiness();
      await assert.rejects(run(() => listPage(), admin, {}), /DATA_REPOSITORY_NOT_CONFIGURED: imports/);
      await assert.rejects(run(() => detailPage(context(randomUUID())), admin, {}), /DATA_REPOSITORY_NOT_CONFIGURED: imports/);
      assert.deepEqual(await rawBusiness(), before); noFallback();
    });

    await suite.test("overlapping native request scopes isolate imports, roster validation, actors and both page props", async () => {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let ready!: () => void;
      const arrived = new Promise<void>(resolve => { ready = resolve; });
      let count = 0;
      async function scopedUpload(scope: typeof a.scope, actor: Session, suffix: string) {
        return run(async () => {
          count++; if (count === 2) ready();
          await gate;
          return uploadPOST(request(form(jsonFile([validRow(suffix)], "shared-source.json"))));
        }, actor, scope);
      }
      const first = scopedUpload(a.scope, admin, "a"), second = scopedUpload(b.scope, member, "b");
      await arrived; release();
      const outcomes = await Promise.allSettled([first, second]);
      const [ra, rb] = outcomes.map(outcome => {
        assert.equal(outcome.status, "fulfilled");
        return outcome.value;
      });
      const [pa, pb] = await Promise.all([uploaded(ra), uploaded(rb)]);
      assert.equal(pa.errorCount, 0); assert.equal(pb.errorCount, 0); assert.notEqual(pa.importRunId, pb.importRunId);
      const [da, db] = await Promise.all([detail(pa.importRunId, a.scope), detail(pb.importRunId, b.scope)]);
      assert.equal(da.importedBy, admin.user.email); assert.equal(db.importedBy, member.user.email);
      assert.ok(JSON.stringify(da).includes(validRow("a").companyName)); assert.ok(JSON.stringify(db).includes(validRow("b").companyName));
      assert.equal(await b.scope.imports.getImportRunById(pa.importRunId), null);
      assert.equal(await a.scope.imports.getImportRunById(pb.importRunId), null);
      const lists = await Promise.all([run(() => listPage(), admin, a.scope), run(() => listPage(), admin, b.scope)]);
      const ids = lists.map(tree => (component(tree, "ImportAdminDashboard").props.runs as ImportRunSummary[]).map(row => row.id));
      assert.ok(ids[0].includes(pa.importRunId)); assert.ok(!ids[0].includes(pb.importRunId));
      assert.deepEqual(ids[1], [pb.importRunId]);
      await audit(ra, admin, a.store); await audit(rb, member, b.store);
      assert.equal(await a.store.one("ActivityRequest", { _id: rb.headers.get("X-Request-Id")! }), null);
      assert.equal(await b.store.one("ActivityRequest", { _id: ra.headers.get("X-Request-Id")! }), null);
      noFallback();
    });

    await suite.test("late native request audit failure remains best-effort after staging commit", async () => {
      const collection = a.store.collection("ActivityRequest"), logStart = logs.length;
      await a.store.db.command({ collMod: collection.collectionName,
        validator: { $and: [operationMongoValidator("ActivityRequest"), { status: { $lt: 0 } }] } });
      try {
        const response = await upload(form(jsonFile())), result = await uploaded(response);
        assert.equal(result.storedCount, 1); assert.equal(result.errorCount, 0);
        assert.equal((await detail(result.importRunId)).sourceRecordCount, 1);
        assert.equal(await a.store.collection("OperationSourceRecord").countDocuments({ importRunId: result.importRunId }), 1);
        const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
        assert.equal(await collection.countDocuments({ _id: requestId }), 0);
        assert.equal(await a.store.collection("ActivityChange").countDocuments({ requestId }), 0);
        assert.deepEqual(logs.slice(logStart), [["[activity] API request log write failed"]]); noFallback();
      } finally { await a.store.db.command({ collMod: collection.collectionName, validator: operationMongoValidator("ActivityRequest") }); }
    });

    await suite.test("missing promotion scope blocks before storage, leaves staging untouched and never invokes Calendar", async () => {
      const seed = await uploaded(await upload(form(jsonFile()))), before = await rawBusiness();
      // Also prove the guard's exact error independently of route catch/response handling.
      assert.throws(() => runWithDataRepositories(a.scope, () => getPrismaClient()), /^Error: DEFAULT_DATABASE_ACCESS_BLOCKED$/);
      const response = await run(() => promotePOST(new Request(`https://example.invalid/api/admin/imports/${seed.importRunId}/promote`, { method: "POST" }), context(seed.importRunId)), member);
      await rejected(response, "반영 요청을 처리하지 못했습니다.");
      await audit(response, member, a.store, "/api/admin/imports/[id]/promote");
      assert.deepEqual(await rawBusiness(), before); noFallback();
    });

    await suite.test("raw staging and real request audits contain no synthetic private values or staging mutation audits", async () => {
      for (const store of [a.store, b.store]) {
        const raw = JSON.stringify([await rawBusiness(store), await store.collection("ActivityRequest").find({}).toArray()]);
        for (const secret of [PRIVATE, admin.user.email, member.user.email]) assert.ok(!raw.includes(secret));
        // No ActivityChange rows at all: seeding was outside activity context and all
        // tested writes belong to the two models excluded by existing audit policy.
        assert.equal(await store.collection("ActivityChange").countDocuments(), 0);
        for (const model of ["OperationSession", "Course", "Company"]) assert.equal(await store.collection(model).countDocuments(), 0);
      }
      // inspect includes non-enumerable Error.message/stack; JSON.stringify(Error)
      // would hide exactly the accidental raw exception logging this checks.
      assert.ok(!inspect(logs, { depth: null }).includes(PRIVATE)); noFallback();
    });
  } finally {
    try {
      if (connected) {
        const results = await Promise.allSettled(databases.map(name => client.db(name).dropDatabase()));
        for (const result of results) if (result.status === "rejected") throw result.reason;
      }
    } finally {
      try { await client.close(); }
      finally {
        external.mock.restore(); for (const capture of captures) capture.mock.restore();
        if (savedPrisma === undefined) delete globals.prisma; else globals.prisma = savedPrisma;
        for (const [key, value] of savedEnvironment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    }
  }
});
