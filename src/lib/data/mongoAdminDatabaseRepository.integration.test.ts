import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { AbstractCursor, AggregationCursor, BSON, Collection, MongoClient, type AggregateOptions, type CommandFailedEvent, type CommandStartedEvent, type CommandSucceededEvent, type Document } from "mongodb";
import { activityContext } from "../activity/context";
import { ADMIN_DATABASE_MODELS, MongoAdminDatabaseRepository, prepareMongoAdminDatabaseStore } from "./mongoAdminDatabaseRepository";
import { AdminDatabaseCellError, type AdminDatabaseRepository, type AdminDatabaseCellUpdate } from "./adminDatabaseRepository";
import type { DatabaseDashboardSnapshot, DatabaseRowPreview } from "../admin/databaseDashboardPresenter";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoCourseAdminRepository } from "./mongoCourseAdminRepository";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationError, MongoOperationStore, completeMongoRow, prepareMongoOperationStore, operationMongoIndexes, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_ADMIN_DATABASE_TEST_URI;
const actor = "synthetic-admin@example.invalid", epoch = new Date("2099-01-01T00:00:00.000Z");
const modelKeys = [["Company", "companies"], ["Course", "courses"], ["OperationSession", "operation_sessions"], ["Member", "members"], ["DataImportRun", "data_import_runs"], ["OperationSourceRecord", "operation_source_records"], ["DriveImportRun", "drive_import_runs"], ["DriveImportResult", "drive_import_results"]] as const;
const uuid = (model: number, n: number) => `eeeeeeee-1234-4abc-8abc-${(model * 10000 + n).toString(16).padStart(12, "0")}`;
const table = (dashboard: DatabaseDashboardSnapshot, key: string) => { const found = dashboard.tables.find(row => row.key === key); assert.ok(found); return found; };
const cell = (row: DatabaseRowPreview, label: string) => { const found = row.cells.find(item => item.label === label); assert.ok(found); return found; };
const clean = (value: unknown) => JSON.parse(JSON.stringify(value));
function attributed<T>(work: () => Promise<T>, requestId = randomUUID()) { return activityContext.run({ requestId, actorType: "user", actorEmail: actor, actorName: "Synthetic admin", route: "/api/admin/database", method: "PATCH" }, work); }
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic barrier deadline")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
function safeError(error: unknown) { assert.ok(error instanceof AdminDatabaseCellError || error instanceof MongoOperationError); assert.doesNotMatch(String(error), /synthetic-admin@example.invalid|Synthetic private|synthetic-injected-secret/); assert.equal((error as Error & { cause?: unknown }).cause, undefined); return true; }
function code(expected: string) { return (error: unknown) => { safeError(error); assert.equal((error as AdminDatabaseCellError).code, expected); return true; }; }

test("admin database repository on an isolated Mongo replica set", { skip: !uri, timeout: 300_000 }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/"); assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const databaseName = `hub_om_shadow_admin_database_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture(n = 1, writers = false) {
    const options = { client, databaseName, namespace: `shadow_admin_database_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoAdminDatabaseStore(options); if (writers) await prepareMongoOperationStore({ ...options, processSequenceHighWater: 1000 });
    const store = new MongoOperationStore(options, ADMIN_DATABASE_MODELS), data = new Map<string, MongoRow[]>();
    for (let i = 0; i < n; i++) {
      const time = new Date(epoch.getTime() + i * 1000);
      const rows: Array<[string, MongoRow]> = [
        ["Company", { id: uuid(0, i), name: `Synthetic company ${i}`, normalizedName: `synthetic company ${i}`, createdAt: time, updatedAt: time }],
        ["Course", { id: uuid(1, i), companyId: uuid(0, i), processSeq: i + 1, courseId: `SYNTHETIC-COURSE-${i}`, name: `Synthetic course ${i}`, operationType: "SHORT", revenue: "0.00", createdAt: time, updatedAt: time }],
        ["OperationSession", { id: uuid(2, i), operationId: `SYNTHETIC-OP-${i}`, courseRecordId: uuid(1, i), startDate: epoch, endDate: epoch, educationDates: [], operationStatus: "ASSIGNMENT_NEEDED", archiveStatus: "NOT_READY", educationFormat: "OFFLINE", operationChannel: "ONSITE", onsiteRequired: "N", onsiteText: "Synthetic private original onsite", omName: null, roundNo: "1", totalCost: "0.00", hasResultReport: "NO", deletedAt: i === 0 ? epoch : null, deletedBy: i === 0 ? actor : null, updatedBy: "synthetic-old@example.invalid", updatedAt: time }],
        ["Member", { id: uuid(3, i), role: "OM", sourceTeam: "TEAM_1", name: `Synthetic member ${i}`, normalizedName: `synthetic member ${i}`, isActive: true, displayOrder: i, calendarId: null, roleTitle: null, updatedAt: time }],
        ["DataImportRun", { id: uuid(4, i), sourceTeam: "TEAM_1", sourceType: "synthetic", sourceName: `Synthetic source ${i}`, workbookName: null, fileName: null, status: "COMPLETED", rowCount: 2, successCount: 1, errorCount: 1, startedAt: time, finishedAt: null }],
        ["OperationSourceRecord", { id: uuid(5, i), importRunId: uuid(4, i), operationSessionId: uuid(2, i), sourceTeam: "TEAM_1", sourceWorkbook: "Synthetic workbook", sourceSheet: "Synthetic sheet", sourceRowNumber: i + 1, sourceFingerprint: null, rowSnapshot: { secret: "Synthetic private row", flag: true }, mappedFields: [], validationErrors: MongoDbNull, createdAt: time }],
        ["DriveImportRun", { id: uuid(6, i), mode: "dry_run", status: "PENDING", operationCount: 1, scannedRefCount: 2, folderSearchCount: 3, errorCount: 0, startedAt: time, finishedAt: null }],
        ["DriveImportResult", { id: uuid(7, i), runId: uuid(6, i), operationSessionId: uuid(2, i), operationId: `SYNTHETIC-OP-${i}`, companyName: `Synthetic company ${i}`, courseName: `Synthetic course ${i}`, inputKind: "driveLink", resultKind: "scan_no_folder", candidateCount: 0, fileCount: 0, issues: ["Synthetic private issue"], error: null, createdAt: time }]
      ];
      for (const [model, values] of rows) data.set(model, [...(data.get(model) ?? []), coachFixtureRow(model, values)]);
    }
    for (const [model, rows] of data) await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    const repo: AdminDatabaseRepository = await MongoAdminDatabaseRepository.open(options);
    const replace = async (model: string, id: string, values: MongoRow) => { const row = await store.one(model, { _id: id }); assert.ok(row); await store.collection(model).replaceOne({ _id: id }, encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...row, ...values }))); };
    const snapshot = async (): Promise<Record<string, Document[]>> => Object.fromEntries(await Promise.all(ADMIN_DATABASE_MODELS.map(async (model: string) => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()])));
    const edit = (table: AdminDatabaseCellUpdate["table"], rowId: string, field: string, value: AdminDatabaseCellUpdate["value"]) => repo.updateCell({ table, rowId, field, value, updatedBy: actor });
    return { options, store, repo, data, replace, snapshot, edit };
  }
  async function wire<T>(work: () => Promise<T>) {
    const names: string[] = [], sessions = new Set<string>(), reads = new Map<number, string>();
    const batches: Array<{ collection: string; count: number; bytes: number }> = []; let conflicts = 0;
    const started = (event: CommandStartedEvent) => {
      if (event.databaseName === databaseName && (event.commandName === "find" || (event.commandName === "aggregate" && event.command.pipeline?.some((stage: Document) => "$sort" in stage)))) reads.set(event.requestId, String(event.command.find ?? event.command.aggregate));
      const sessionId = event.command.lsid?.id?.toString();
      if (event.databaseName === databaseName && sessionId) sessions.add(sessionId);
      if (event.databaseName === databaseName || (event.databaseName === "admin" && sessions.has(sessionId))) names.push(event.commandName);
    };
    const failed = (event: CommandFailedEvent) => { if ((event.failure as { code?: number }).code === 112) conflicts++; };
    const succeeded = (event: CommandSucceededEvent) => {
      const reply = event.reply as Document;
      if (reply.writeErrors?.some((error: { code: number }) => error.code === 112)) conflicts++;
      const collection = reads.get(event.requestId);
      if (collection && reply.cursor) batches.push({ collection, count: reply.cursor.firstBatch.length, bytes: BSON.calculateObjectSize(reply) });
      reads.delete(event.requestId);
    };
    client.on("commandStarted", started); client.on("commandFailed", failed); client.on("commandSucceeded", succeeded);
    try { return { result: await work(), names, batches, get conflicts() { return conflicts; } }; }
    finally { client.off("commandStarted", started); client.off("commandFailed", failed); client.off("commandSucceeded", succeeded); }
  }
  function holdRead(namespace: string, model: string, requestId: string) {
    const held = signal(), release = signal(), original = AbstractCursor.prototype.close; let paused = false;
    const patch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) {
      await original.apply(this, args);
      if (!paused && this.namespace.collection === `${namespace}_${model}` && activityContext.getStore()?.requestId === requestId) { paused = true; held.resolve(); await release.promise; }
    });
    return { held, release, patch };
  }
  try {
    await client.connect(); connected = true;
    for (const n of [0, 99, 100, 101]) {
      await suite.test(`all eight tables have exact count ${n}, deterministic sample min(100,n), and read performs no writes`, async () => {
        const f = await fixture(n), before = await f.snapshot(), observed = await wire(() => f.repo.readDashboard());
        assert.equal(observed.result.totalRows, 8 * n); assert.deepEqual(observed.result.tables.map(row => row.key), modelKeys.map(([, key]) => key));
        for (let model = 0; model < modelKeys.length; model++) {
          const entry = table(observed.result, modelKeys[model][1]); assert.equal(entry.rowCount, n); assert.equal(entry.rows.length, Math.min(n, 100));
          const indexes = Array.from({ length: Math.min(n, 100) }, (_, i) => model === 3 ? i : n - 1 - i);
          assert.deepEqual(entry.rows.map(row => row.id), indexes.map(i => uuid(model, i)));
          assert.equal(entry.latestActivity, n ? new Date(epoch.getTime() + (model === 3 ? 0 : n - 1) * 1000).toISOString() : "");
        }
        assert.ok(!observed.names.some(name => ["insert", "update", "delete", "create", "collMod", "createIndexes"].includes(name))); assert.ok(!observed.names.includes("getMore"));
        assert.deepEqual(await f.snapshot(), before);
      });
    }
    await suite.test("independent fixed eight-table display values include zero decimals, options, deleted row, JSON summaries, UTC date and Seoul time", async () => {
      const f = await fixture(), dashboard = await f.repo.readDashboard();
      assert.deepEqual(dashboard.tables.map(row => [row.key, row.title, row.rowCount]), [["companies", "기업", 1], ["courses", "과정", 1], ["operation_sessions", "운영 차수", 1], ["members", "구성원", 1], ["data_import_runs", "적재 실행", 1], ["operation_source_records", "원천 행", 1], ["drive_import_runs", "Drive 조회 실행", 1], ["drive_import_results", "Drive 조회 결과", 1]]);
      const rows = Object.fromEntries(dashboard.tables.map(entry => [entry.key, entry.rows[0]]));
      assert.equal(rows.companies.title, "Synthetic company 0"); assert.equal(cell(rows.companies, "정규화명").value, "synthetic company 0");
      assert.equal(cell(rows.companies, "과정 연결").value, "있음"); assert.equal(cell(rows.companies, "생성").value, "99. 1. 1. 오전 9:00");
      assert.equal(rows.courses.title, "Synthetic course 0"); assert.equal(cell(rows.courses, "과정ID").value, "PRC-000001");
      assert.deepEqual(clean(cell(rows.courses, "매출")), { editable: true, field: "revenue", input: "money", label: "매출", rawValue: "0", value: "0" });
      assert.equal(rows.operation_sessions.href, "/operations/SYNTHETIC-OP-0"); assert.equal(rows.operation_sessions.title, "SYNTHETIC-OP-0 · Synthetic course 0");
      assert.equal(cell(rows.operation_sessions, "시작일").rawValue, "2099-01-01"); assert.equal(cell(rows.operation_sessions, "삭제").tone, "warning");
      assert.equal(cell(rows.operation_sessions, "OM").tone, "warning"); assert.equal(cell(rows.operation_sessions, "총비용").rawValue, "0");
      assert.deepEqual(cell(rows.operation_sessions, "출강").options, [{ label: "예", value: "Y" }, { label: "아니오", value: "N" }, { label: "일부", value: "PARTIAL" }, { label: "확인필요", value: "UNKNOWN" }]);
      assert.equal(rows.members.title, "Synthetic member 0"); assert.equal(cell(rows.members, "표시순서").rawValue, "0"); assert.equal(cell(rows.members, "캘린더ID").tone, "muted");
      assert.deepEqual(cell(rows.members, "역할").options, [{ label: "비움", value: "" }, { label: "OM", value: "OM" }, { label: "LD", value: "LD" }]);
      assert.deepEqual(rows.data_import_runs.cells.map(row => row.value), ["1팀", "synthetic", "Synthetic source 0", "-", "완료", "1/2", "1", "99. 1. 1. 오전 9:00"]);
      assert.equal(cell(rows.data_import_runs, "오류").tone, "warning");
      assert.deepEqual(rows.operation_source_records.cells.map(row => row.value), ["1팀", "Synthetic workbook / Synthetic sheet", "1", "SYNTHETIC-OP-0", "-", "2개 필드", "-", "-"]);
      assert.deepEqual(rows.drive_import_runs.cells.map(row => row.value), ["드라이런", "진행중", "1", "2", "3", "0", "99. 1. 1. 오전 9:00", "진행/미완료"]);
      assert.deepEqual(rows.drive_import_results.cells.map(row => row.value), ["SYNTHETIC-OP-0", "Synthetic company 0", "Drive 값", "폴더 미확인", "0", "0", "1개 항목", "-"]);
      assert.equal(rows.drive_import_results.href, "/operations/SYNTHETIC-OP-0"); assert.equal(cell(rows.drive_import_results, "이슈").tone, "warning");
      assert.doesNotMatch(JSON.stringify(dashboard), /PiiIndex|Encrypted|Synthetic private row|Synthetic private issue/);
    });
    await suite.test("Member NULLS LAST works within each active segment and across the 100-row boundary; latestActivity uses first sorted member", async () => {
      const f = await fixture(101); await f.replace("Member", uuid(3, 0), { displayOrder: null, updatedAt: new Date("2100-01-01") });
      let members = table(await f.repo.readDashboard(), "members"); assert.deepEqual(members.rows.map(row => row.id), Array.from({ length: 100 }, (_, i) => uuid(3, i + 1)));
      assert.equal(members.latestActivity, new Date(epoch.getTime() + 1000).toISOString());
      await f.replace("Member", uuid(3, 1), { isActive: false, displayOrder: -100 });
      members = table(await f.repo.readDashboard(), "members"); assert.equal(members.rows.at(-1)?.id, uuid(3, 0)); assert.ok(!members.rows.some(row => row.id === uuid(3, 1)));
    });
    await suite.test("Member compound keyset crosses active, null and tied groups over real short server batches", async () => {
      const f = await fixture(8);
      for (let i = 0; i < 8; i++) await f.replace("Member", uuid(3, i), {
        isActive: i < 4, displayOrder: i % 4 < 2 ? 0 : null, updatedAt: epoch
      });
      // Restrict only wire batch size, never returned documents or query filters.
      // Each keyset query still executes against the native replica set.
      const original = Collection.prototype.aggregate;
      for (const batchSize of [1, 3]) {
        const patch = mock.method(Collection.prototype, "aggregate", function (this: Collection, pipeline: Document[] = [], options?: AggregateOptions) {
          return original.call(this, pipeline, this.collectionName === `${f.options.namespace}_Member`
            ? { ...options, batchSize } : options);
        });
        try {
          const observed = await wire(() => f.repo.readDashboard());
          const members = table(observed.result, "members");
          assert.equal(members.rowCount, 8);
          assert.deepEqual(members.rows.map(row => row.id), Array.from({ length: 8 }, (_, i) => uuid(3, i)));
          const pages = observed.batches.filter(row => row.collection === `${f.options.namespace}_Member` && row.count > 0);
          assert.ok(pages.length >= Math.ceil(8 / batchSize));
          assert.ok(pages.every(row => row.count <= batchSize));
          assert.ok(!observed.names.includes("getMore"));
        } finally { patch.mock.restore(); }
      }
    });
    await suite.test("sample joins follow related rows outside every table's 100-row sample", async () => {
      const f = await fixture(101);
      await f.replace("Course", uuid(1, 100), { companyId: uuid(0, 0) }); await f.replace("Course", uuid(1, 0), { companyId: uuid(0, 100) });
      await f.replace("OperationSession", uuid(2, 100), { courseRecordId: uuid(1, 0) }); await f.replace("OperationSession", uuid(2, 0), { courseRecordId: uuid(1, 100) });
      await f.replace("OperationSourceRecord", uuid(5, 100), { operationSessionId: uuid(2, 0) });
      const dashboard = await f.repo.readDashboard();
      assert.equal(cell(table(dashboard, "courses").rows[0], "기업").value, "Synthetic company 0");
      assert.equal(cell(table(dashboard, "courses").rows[0], "운영 연결").value, "있음");
      assert.equal(table(dashboard, "operation_sessions").rows[0].title, "SYNTHETIC-OP-100 · Synthetic course 0");
      assert.equal(cell(table(dashboard, "operation_source_records").rows[0], "운영").value, "SYNTHETIC-OP-0");
    });
    await suite.test("JSON SQL-null/JSON-null/empty/scalar summaries and optional null link retain original display policy", async () => {
      const f = await fixture();
      for (const [value, expected, warning] of [[MongoDbNull, "-", false], [MongoJsonNull, "-", false], [{}, "-", false], [[], "-", false], [[1, 2], "2개 항목", true], [{ a: 1 }, "1개 필드", true], ["scalar synthetic", "scalar synthetic", true], [0, "0", true]] as const) {
        await f.replace("OperationSourceRecord", uuid(5, 0), { mappedFields: value, validationErrors: value, operationSessionId: null });
        const row = table(await f.repo.readDashboard(), "operation_source_records").rows[0];
        assert.equal(cell(row, "매핑 요약").value, expected); assert.equal(cell(row, "검증").tone, warning ? "warning" : undefined);
        assert.equal(cell(row, "운영").value, "미연결"); assert.equal(cell(row, "운영").tone, "warning");
      }
    });
    for (const relation of ["company", "course", "optional-nonnull"] as const) {
      await suite.test(`dangling ${relation} relation fails closed instead of silently omitting it`, async () => {
        const f = await fixture();
        if (relation === "company") await f.replace("Course", uuid(1, 0), { companyId: randomUUID() });
        else if (relation === "course") await f.replace("OperationSession", uuid(2, 0), { courseRecordId: randomUUID() });
        else await f.replace("OperationSourceRecord", uuid(5, 0), { operationSessionId: randomUUID() });
        await assert.rejects(f.repo.readDashboard(), safeError);
      });
    }
    await suite.test("all dashboard counts and related names use one snapshot while a concurrent write commits", async () => {
      const f = await fixture(), requestId = randomUUID(), barrier = holdRead(f.options.namespace, "Company", requestId);
      const pending = attributed(() => f.repo.readDashboard(), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Dashboard snapshot barrier not reached"); })]));
        await f.replace("Company", uuid(0, 0), { name: "Synthetic changed company" });
        const member = coachFixtureRow("Member", { ...f.data.get("Member")![0], id: uuid(3, 1), name: "Synthetic extra member", normalizedName: "synthetic extra member" });
        await f.store.collection("Member").insertOne(encodeMongoRuntimeDocument("Member", member));
        barrier.release.resolve(); const dashboard = await pending;
        assert.equal(table(dashboard, "members").rowCount, 1); assert.equal(cell(table(dashboard, "courses").rows[0], "기업").value, "Synthetic company 0");
      } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
      const fresh = await f.repo.readDashboard(); assert.equal(table(fresh, "members").rowCount, 2); assert.equal(cell(table(fresh, "courses").rows[0], "기업").value, "Synthetic changed company");
    });
    await suite.test("real BSON-short sample continues without getMore, while 32MiB fails without a partial dashboard", async () => {
      const f = await fixture(6);
      for (let n = 0; n < 3; n++) await f.replace("OperationSession", uuid(2, n), { operationDetail: "x".repeat(5 * 1024 * 1024) });
      const observed = await wire(() => f.repo.readDashboard()); assert.equal(table(observed.result, "operation_sessions").rows.length, 6); assert.ok(!observed.names.includes("getMore"));
      const pages = observed.batches.filter(row => row.collection === `${f.options.namespace}_OperationSession`);
      assert.ok(pages.some(row => row.count > 0 && row.count < 6 && row.bytes > 6 * 1024 * 1024)); assert.ok(pages.filter(row => row.count > 0).length >= 2);
      for (let n = 3; n < 6; n++) await f.replace("OperationSession", uuid(2, n), { operationDetail: "x".repeat(5 * 1024 * 1024) });
      await assert.rejects(f.repo.readDashboard(), code("ADMIN_DATABASE_SAMPLE_LIMIT"));
    });
    await suite.test("a damaged operation outside every selected sample is not decoded by an unbounded full scan", async () => {
      const f = await fixture(101);
      await f.store.collection("OperationSession").updateOne({ _id: uuid(2, 0) }, { $set: { omName: "Synthetic private forbidden plaintext", omNamePiiIndex: "0".repeat(64) } }, { bypassDocumentValidation: true });
      const result = await f.repo.readDashboard(); assert.equal(table(result, "operation_sessions").rowCount, 101); assert.equal(table(result, "operation_sessions").rows.length, 100);
      assert.ok(!table(result, "operation_sessions").rows.some(row => row.id === uuid(2, 0)));
    });
    const edits = [
      { model: "Company", table: "companies", field: "name", value: " Synthetic  NEW Name ", changed: ["name", "normalizedName", "updatedAt"] },
      { model: "Course", table: "courses", field: "revenue", value: 1.005, changed: ["revenue", "updatedAt"] },
      { model: "Member", table: "members", field: "name", value: " Synthetic  NEW Name ", changed: ["name", "namePiiIndex", "normalizedName", "normalizedNamePiiIndex", "updatedAt"] },
      { model: "OperationSession", table: "operation_sessions", field: "omName", value: "Synthetic private new OM", changed: ["omName", "omNamePiiIndex", "updatedAt", "updatedBy", "updatedByPiiIndex"] }
    ] as const;
    for (const edit of edits) {
      await suite.test(`${edit.model}: allowlisted edit preserves all unrelated ciphertext, audits atomically, and same-value replay has no logical audit`, async () => {
        const f = await fixture(), rowId = String(f.data.get(edit.model)![0].id), before = await f.snapshot();
        await attributed(() => f.edit(edit.table, rowId, edit.field, edit.value));
        const after = await f.snapshot(), raw = after[edit.model][0], logical = await f.store.one(edit.model, { _id: rowId }); assert.ok(logical);
        for (const model of ADMIN_DATABASE_MODELS) {
          if (model === "ActivityChange") continue;
          if (model !== edit.model) assert.deepEqual(after[model], before[model]);
          else for (const key of Object.keys(before[model][0])) if (!(edit.changed as readonly string[]).includes(key)) assert.deepEqual(raw[key], before[model][0][key], key);
        }
        if (edit.field === "name") assert.equal(logical.normalizedName, "synthetic new name");
        if (edit.model === "Course") assert.equal(Number(logical.revenue), 1.01);
        if (edit.model === "Member") {
          assert.equal(raw.namePiiIndex, mongoRuntimeBlindIndex("Member", "name", String(edit.value)));
          assert.equal(raw.normalizedNamePiiIndex, mongoRuntimeBlindIndex("Member", "normalizedName", "synthetic new name"));
          assert.notEqual(raw.name, edit.value);
        }
        if (edit.model === "OperationSession") { assert.equal(logical.deletedAt?.toString(), epoch.toString()); assert.equal(logical.updatedBy, actor); assert.equal(raw.updatedByPiiIndex, mongoRuntimeBlindIndex("OperationSession", "updatedBy", actor)); }
        assert.equal(after.ActivityChange.length, 1); assert.doesNotMatch(JSON.stringify(after.ActivityChange), /synthetic-admin@example.invalid|Synthetic private new OM/);
        const timestamp = raw.updatedAt; await new Promise(resolve => setTimeout(resolve, 10));
        await attributed(() => f.edit(edit.table, rowId, edit.field, edit.value));
        assert.notDeepEqual((await f.store.collection(edit.model).findOne({ _id: rowId }))?.updatedAt, timestamp);
        assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
      });
    }
    await suite.test("Member audit exposes only role/sourceTeam; private fields remain redacted", async () => {
      const f = await fixture();
      await attributed(() => f.edit("members", uuid(3, 0), "role", "LD")); await attributed(() => f.edit("members", uuid(3, 0), "sourceTeam", "TEAM_2"));
      await attributed(() => f.edit("members", uuid(3, 0), "roleTitle", "Synthetic private title"));
      const changes = (await f.store.scan("ActivityChange", {})).map(row => clean(row.changes));
      assert.ok(changes.some(row => JSON.stringify(row) === JSON.stringify({ role: { before: "om", after: "ld" } })));
      assert.ok(changes.some(row => JSON.stringify(row) === JSON.stringify({ source_team: { before: "team_1", after: "team_2" } })));
      assert.ok(changes.some(row => JSON.stringify(row) === JSON.stringify({ role_title: { redacted: true } })));
    });
    await suite.test("PG-compatible UUID spelling, absent row P2025 and readonly direct calls are distinguished", async () => {
      const f = await fixture(), id = uuid(3, 0), compact = id.replaceAll("-", "");
      for (const rowId of [id.toUpperCase(), `{${id}}`, compact, compact.match(/.{4}/g)!.join("-")]) await f.edit("members", rowId, "roleTitle", "Synthetic title");
      await assert.rejects(f.edit("members", randomUUID(), "name", "Missing"), code("P2025"));
      for (const rowId of ["bad", ` ${id}`, `${id} `]) await assert.rejects(f.edit("members", rowId, "name", "Invalid"), error => { safeError(error); assert.notEqual((error as AdminDatabaseCellError).code, "P2025"); return true; });
      const before = await f.snapshot();
      for (const [tableName, field] of [["companies", "normalizedName"], ["courses", "companyId"], ["members", "normalizedNamePiiIndex"], ["operation_sessions", "deletedAt"], ["operation_sessions", "updatedBy"], ["data_import_runs", "status"], ["unknown", "name"]]) {
        await assert.rejects(f.repo.updateCell({ table: tableName, field, rowId: id, value: null, updatedBy: actor } as AdminDatabaseCellUpdate), code("READ_ONLY_FIELD"));
      }
      assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("nullable, boolean, Int32, numeric scale and UTC-date edits keep existing DB boundaries without derived-field updates", async () => {
      const f = await fixture();
      for (const value of [null, -2147483648, 2147483647]) { await f.edit("members", uuid(3, 0), "displayOrder", value); assert.equal((await f.store.one("Member", { _id: uuid(3, 0) }))?.displayOrder, value); }
      await f.edit("members", uuid(3, 0), "isActive", false); await f.edit("members", uuid(3, 0), "calendarId", null);
      for (const [value, expected] of [[1.005, 1.01], [-1.005, -1.01], [0, 0], [null, null]] as const) { await f.edit("courses", uuid(1, 0), "revenue", value); const revenue = (await f.store.one("Course", { _id: uuid(1, 0) }))?.revenue; assert.equal(revenue === null ? null : Number(revenue), expected); }
      const beforeDate = await f.store.collection("OperationSession").findOne({ _id: uuid(2, 0) }); assert.ok(beforeDate);
      const rollover = new Date("2099-02-31T00:00:00.000Z"); await f.edit("operation_sessions", uuid(2, 0), "startDate", rollover);
      const afterDate = await f.store.collection("OperationSession").findOne({ _id: uuid(2, 0) }); assert.ok(afterDate);
      assert.deepEqual(afterDate.startDate, rollover); assert.deepEqual(afterDate.endDate, beforeDate.endDate); assert.deepEqual(afterDate.operationMonth, beforeDate.operationMonth); assert.deepEqual(afterDate.educationDates, beforeDate.educationDates);
      const before = await f.snapshot();
      for (const [tableName, rowId, field, value] of [["members", uuid(3, 0), "displayOrder", 2147483648], ["members", uuid(3, 0), "displayOrder", 1.5], ["members", uuid(3, 0), "isActive", null], ["courses", uuid(1, 0), "courseId", null], ["courses", uuid(1, 0), "revenue", 1e12], ["courses", uuid(1, 0), "operationType", "INVALID"]] as const) await assert.rejects(f.edit(tableName, rowId, field, value), safeError);
      assert.deepEqual(await f.snapshot(), before);
    });
    for (const model of ["Company", "Course", "Member"] as const) {
      await suite.test(`${model} unique collision uses logical/index equality and atomically returns P2002`, async () => {
        const f = await fixture(2);
        if (model === "Course") await f.replace("Course", uuid(1, 1), { companyId: uuid(0, 0), courseId: "SYNTHETIC-COURSE-0" });
        const before = await f.snapshot(), key = model === "Company" ? "companies" : model === "Course" ? "courses" : "members", index = model === "Company" ? 0 : model === "Course" ? 1 : 3;
        await assert.rejects(attributed(() => f.edit(key, uuid(index, 1), "name", model === "Course" ? "Synthetic course 0" : model === "Company" ? " SYNTHETIC  COMPANY 0 " : " SYNTHETIC  MEMBER 0 ")), code("P2002"));
        assert.deepEqual(await f.snapshot(), before);
      });
    }
    await suite.test("Member null role/sourceTeam permits otherwise duplicate normalized names", async () => {
      const f = await fixture(2);
      for (const nullField of ["role", "sourceTeam"]) {
        await f.edit("members", uuid(3, 1), nullField, null); await f.edit("members", uuid(3, 1), "name", "Synthetic member 0");
        assert.equal((await f.store.one("Member", { _id: uuid(3, 1) }))?.normalizedName, "synthetic member 0");
        await f.edit("members", uuid(3, 1), "name", "Synthetic member 1"); await f.edit("members", uuid(3, 1), nullField, nullField === "role" ? "OM" : "TEAM_1");
      }
    });
    await suite.test("actual post-insert audit failure rolls back business/HMAC/timestamp/actor changes", async () => {
      const f = await fixture(), before = await f.snapshot(), original = Collection.prototype.insertOne; let inserted = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) { const result = await original.apply(this, args); if (this.collectionName === `${f.options.namespace}_ActivityChange`) { inserted++; throw new Error("synthetic-injected-secret"); } return result; });
      try { await assert.rejects(attributed(() => f.edit("operation_sessions", uuid(2, 0), "omName", "Synthetic private failed update")), safeError); }
      finally { patch.mock.restore(); }
      assert.equal(inserted, 1); assert.deepEqual(await f.snapshot(), before);
    });
    for (const corruption of ["key", "hmac", "ciphertext"] as const) {
      await suite.test(`${corruption} damage rejects read/edit without leaking or partially writing`, async () => {
        const f = await fixture(), priorKey = process.env.PII_ENCRYPTION_KEYS!;
        if (corruption === "key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
        else await f.store.collection("Member").updateOne({ _id: uuid(3, 0) }, { $set: corruption === "hmac" ? { namePiiIndex: "0".repeat(64) } : { name: "Synthetic private illegal plaintext" } }, { bypassDocumentValidation: true });
        const before = await f.snapshot();
        try { await assert.rejects(f.repo.readDashboard(), safeError); await assert.rejects(attributed(() => f.edit("members", uuid(3, 0), "roleTitle", "changed")), safeError); assert.deepEqual(await f.snapshot(), before); }
        finally { process.env.PII_ENCRYPTION_KEYS = priorKey; }
      });
    }
    for (const writer of ["same-field", "different-field", "delete", "bulk", "course"] as const) {
      await suite.test(`actual ${writer} writer commits first; stale admin edit retries with latest values and no audit duplicates`, async () => {
        const f = await fixture(1, true); await f.replace("OperationSession", uuid(2, 0), { deletedAt: null, deletedBy: null });
        const operations = await MongoOperationRepository.open(f.options), bulk = await MongoCourseAdminRepository.open(f.options), requestId = randomUUID();
        const isCourse = writer === "course", barrier = holdRead(f.options.namespace, isCourse ? "Course" : "OperationSession", requestId);
        const pending = attributed(() => isCourse ? f.edit("courses", uuid(1, 0), "revenue", 99) : f.edit("operation_sessions", uuid(2, 0), "omName", "Synthetic private admin winner"), requestId); void pending.catch(() => {});
        try {
          await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Admin edit barrier not reached"); })]));
          const observed = await wire(async () => {
            await attributed(async () => {
              if (writer === "same-field") await operations.updateOperation("SYNTHETIC-OP-0", { om: "Synthetic private prior writer" }, actor);
              else if (writer === "different-field") await operations.updateOperation("SYNTHETIC-OP-0", { region: "Synthetic preserved region" }, actor);
              else if (writer === "delete") await operations.deleteOperation("SYNTHETIC-OP-0", actor);
              else if (writer === "bulk") assert.equal(await bulk.softDeleteCourseSessions(uuid(1, 0), actor), 1);
              else await operations.updateOperation("SYNTHETIC-OP-0", { courseCategory: "Synthetic preserved category" }, actor);
            });
            barrier.release.resolve(); await pending;
          });
          assert.ok(observed.conflicts > 0, "a real Mongo write conflict must be observed");
        } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
        if (isCourse) { const course = await f.store.one("Course", { _id: uuid(1, 0) }); assert.equal(Number(course?.revenue), 99); assert.equal(course?.courseCategory, "Synthetic preserved category"); }
        else {
          const row = await f.store.one("OperationSession", { _id: uuid(2, 0) }); assert.ok(row); assert.equal(row.omName, "Synthetic private admin winner");
          assert.equal(row.deletedAt !== null, writer === "delete" || writer === "bulk");
          if (writer === "different-field") assert.equal(row.region, "Synthetic preserved region");
        }
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), 1);
        assert.equal(await f.store.collection("ActivityChange").countDocuments(), 2);
      });
    }
    // MongoTeamMemberRepository is read-only; the competing Member writer is
    // explicitly another admin repository instance, never a fictional member API.
    for (const sameField of [true, false]) {
      await suite.test(`two admin repositories edit Member ${sameField ? "same" : "different"} fields with real conflict retry`, async () => {
        const f = await fixture(), second = await MongoAdminDatabaseRepository.open(f.options), requestId = randomUUID(), barrier = holdRead(f.options.namespace, "Member", requestId);
        const pending = attributed(() => f.edit("members", uuid(3, 0), "roleTitle", "Synthetic final title"), requestId); void pending.catch(() => {});
        try {
          await bounded(Promise.race([barrier.held.promise, pending.then(() => { throw new Error("Member barrier not reached"); })]));
          const observed = await wire(async () => {
            await attributed(() => second.updateCell({ table: "members", rowId: uuid(3, 0), field: sameField ? "roleTitle" : "calendarId", value: "Synthetic other writer", updatedBy: actor }));
            barrier.release.resolve(); await pending;
          }); assert.ok(observed.conflicts > 0);
        } finally { barrier.release.resolve(); await Promise.allSettled([pending]); barrier.patch.mock.restore(); }
        const member = await f.store.one("Member", { _id: uuid(3, 0) }); assert.equal(member?.roleTitle, "Synthetic final title"); assert.equal(member?.calendarId, sameField ? null : "Synthetic other writer");
        assert.equal(await f.store.collection("ActivityChange").countDocuments(), 2);
      });
    }
    await suite.test("two real Member name updates competing for one normalized unique key commit exactly once", async () => {
      const f = await fixture(2), second = await MongoAdminDatabaseRepository.open(f.options), original = Collection.prototype.updateOne, release = signal(), both = signal(); let waiting = 0;
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        if (this.collectionName === `${f.options.namespace}_Member` && waiting < 2) { waiting++; if (waiting === 2) both.resolve(); await release.promise; }
        return original.apply(this, args);
      });
      const a = attributed(() => f.edit("members", uuid(3, 0), "name", "Synthetic unique shared"));
      const b = attributed(() => second.updateCell({ table: "members", rowId: uuid(3, 1), field: "name", value: "Synthetic unique shared", updatedBy: actor }));
      void a.catch(() => {}); void b.catch(() => {});
      try {
        await bounded(Promise.race([both.promise, Promise.all([a, b]).then(() => { throw new Error("Unique barrier not reached"); })])); release.resolve();
        const outcomes = await Promise.allSettled([a, b]); assert.equal(outcomes.filter(row => row.status === "fulfilled").length, 1);
        const failed = outcomes.find(row => row.status === "rejected"); assert.ok(failed?.status === "rejected"); code("P2002")(failed.reason);
      } finally { release.resolve(); await Promise.allSettled([a, b]); patch.mock.restore(); }
      assert.equal(await f.store.collection("Member").countDocuments({ normalizedNamePiiIndex: mongoRuntimeBlindIndex("Member", "normalizedName", "synthetic unique shared") }), 1);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
    });
    await suite.test("simulated sample15s and write30s deadlines refuse late success without partial state", async () => {
      const f = await fixture(), before = await f.snapshot();
      for (const phase of ["sample", "write"] as const) {
        const now = performance.now.bind(performance); let elapsed = 0;
        const clock = mock.method(performance, "now", () => now() + elapsed), close = AbstractCursor.prototype.close, insert = Collection.prototype.insertOne;
        const cursorPatch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) { await close.apply(this, args); if (phase === "sample" && this instanceof AggregationCursor && this.pipeline.some(stage => "$sort" in stage) && this.namespace.collection === `${f.options.namespace}_Company`) elapsed = 16_001; });
        const auditPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) { const result = await insert.apply(this, args); if (phase === "write" && this.collectionName === `${f.options.namespace}_ActivityChange`) elapsed = 30_001; return result; });
        try { await assert.rejects(phase === "sample" ? f.repo.readDashboard() : attributed(() => f.edit("members", uuid(3, 0), "roleTitle", "Synthetic late title")), code(phase === "sample" ? "ADMIN_DATABASE_SAMPLE_TIMEOUT" : "ADMIN_DATABASE_TIMEOUT")); }
        finally { cursorPatch.mock.restore(); auditPatch.mock.restore(); clock.mock.restore(); }
        assert.equal(elapsed, phase === "sample" ? 16_001 : 30_001); assert.deepEqual(await f.snapshot(), before);
      }
    });
    await suite.test("actual edit conflict retry keeps total30s: simulated20s+15s rolls back admin changes and preserves committed writer", async () => {
      const f = await fixture(1, true); await f.replace("OperationSession", uuid(2, 0), { deletedAt: null, deletedBy: null });
      const operations = await MongoOperationRepository.open(f.options), requestId = randomUUID(), held = signal(), release = signal();
      const originalWrite = Collection.prototype.updateOne, originalAudit = Collection.prototype.insertOne, now = performance.now.bind(performance);
      let elapsed = 0, paused = false, conflicts = 0, auditInserts = 0; let winner: Record<string, Document[]> | undefined;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const writePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const ours = this.collectionName === `${f.options.namespace}_OperationSession` && activityContext.getStore()?.requestId === requestId;
        if (ours && !paused) { paused = true; held.resolve(); await release.promise; }
        try { return await originalWrite.apply(this, args); }
        catch (error) { if (ours && (error as { code?: number }).code === 112) { conflicts++; elapsed = 20_000; } throw error; }
      });
      const auditPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await originalAudit.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange` && activityContext.getStore()?.requestId === requestId) { assert.equal(conflicts, 1); auditInserts++; elapsed += 15_000; }
        return result;
      });
      const pending = attributed(() => f.edit("operation_sessions", uuid(2, 0), "omName", "Synthetic private timed-out edit"), requestId); void pending.catch(() => {});
      try {
        await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Deadline write barrier not reached"); })]));
        const observed = await wire(async () => {
          await attributed(() => operations.updateOperation("SYNTHETIC-OP-0", { region: "Synthetic retained region" }, actor)); winner = await f.snapshot(); release.resolve(); await assert.rejects(pending, code("ADMIN_DATABASE_TIMEOUT"));
        }); assert.ok(observed.conflicts > 0);
      } finally { release.resolve(); await Promise.allSettled([pending]); auditPatch.mock.restore(); writePatch.mock.restore(); clock.mock.restore(); }
      assert.equal(conflicts, 1); assert.equal(auditInserts, 1); assert.equal(elapsed, 35_000); assert.ok(winner); assert.deepEqual(await f.snapshot(), winner);
    });
    for (const problem of ["validator", "index"] as const) {
      await suite.test(`unready ${problem} rejects open without repair`, async () => {
        const f = await fixture(), collection = f.store.collection("Member");
        if (problem === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "moderate" });
        else { const name = operationMongoIndexes("Member")[0]?.name; assert.ok(name); await collection.dropIndex(name); }
        const observed = await wire(async () => { await assert.rejects(MongoAdminDatabaseRepository.open(f.options)); });
        assert.ok(!observed.names.some(name => ["create", "createIndexes", "collMod", "insert", "update", "delete"].includes(name)));
      });
    }
  } finally {
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_admin_database_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
