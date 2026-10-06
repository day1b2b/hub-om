/** Parent-run isolated worker: one immutable synthetic credential and one owned shadow DB. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import { BSON, MongoClient } from "mongodb";
import { installOriginalResolver, originalURL, verifyBytes } from "../../../.claude/plans/mongodb-drive-import-writer/original/original-resolver.fixture.ts";
import { URI, ROOT, CASES, TOKEN, CANARY, OP, HttpOracle, operation, expectation, assertSource, withoutSourceTime, isSearch,
  type Scenario } from "./driveImportWriterSourceHttp.fixture.ts";
import type { DriveImportScanResult, DriveFolderSearchResult } from "../driveImports/driveImportTypes";

let stage = "bootstrap";
let failedStage: string | undefined;
async function main() {
  const scenario = process.argv[2] as Scenario;
  assert.ok(CASES.includes(scenario)); assert.equal(process.env.MONGODB_DRIVE_IMPORT_WRITER_SOURCE_TEST_URI, URI);
  for (const key of ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS",
    "GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_DRIVE_PRIVATE_KEY", "GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL", "GOOGLE_CALENDAR_PRIVATE_KEY"])
    assert.equal(process.env[key], undefined, `INHERITED_CONFIGURATION:${key}`);
  assert.equal(process.env.TZ, "UTC");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ source: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "source",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/source_tripwire" });
  if (scenario !== "missing_config") Object.assign(process.env, { GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL: "synthetic-drive@example.invalid", GOOGLE_DRIVE_PRIVATE_KEY: privateKey });
  // No plaintext source copy. Verify the unchanged scanner/cache implementation before cache-expiry exclusion.
  verifyBytes("src/lib/driveImports/googleDriveOperationScanner.ts", readFileSync(new URL("../driveImports/googleDriveOperationScanner.ts", import.meta.url)));
  // The generic loader anchors aliases to cwd, which is deliberately synthetic here.
  // Register this first so the frozen resolver runs first and validates its own edges.
  const repositoryURL = new URL("../../../", import.meta.url);
  const currentHook = registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith("@/") && context.parentURL?.startsWith(repositoryURL.href)) {
      for (const suffix of [".ts", "/index.ts"]) {
        const target = new URL(`src/${specifier.slice(2)}${suffix}`, repositoryURL);
        if (existsSync(target)) return { url: target.href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  } });
  const hook = installOriginalResolver();
  let pgCalls = 0;
  const pgPatch = mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("SOURCE_PG_TRIPWIRE"); } } } });
  let active: HttpOracle | undefined;
  let outsideAttempts = 0;
  const fetchPatch = mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (!active) { outsideAttempts++; throw new Error("SOURCE_EXTERNAL_FETCH_FORBIDDEN"); }
    return active.fetch(input, init);
  });
  const logs: unknown[][] = [];
  const captures = (["log", "warn", "error", "info", "debug"] as const).map(level => mock.method(console, level, (...args: unknown[]) => { logs.push(args); }));
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 15000 });
  const databaseName = `hub_om_shadow_drive_writer_source_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  assert.ok(databaseName.length <= 63, "OWNED_DATABASE_NAME_TOO_LONG");
  let owned = false;
  try {
    stage = "imports";
    const { MongoDriveImportWriterRepository, prepareMongoDriveImportWriter } = await import("./mongoDriveImportWriterRepository.ts");
    const { MongoDriveImportHistoryRepository } = await import("./mongoDriveImportHistoryRepository.ts");
    const { MongoOperationStore, completeMongoRow } = await import("./mongoOperationStore.ts");
    const { encodeMongoRuntimeDocument, decodeMongoRuntimeDocument } = await import("./mongoRuntimeCodec.ts");
    const { getDriveImportSource } = await import("./driveImportSource.ts");
    const { runWithDataRepositories } = await import("./dataRepositoryContext.ts");
    const { runDriveImportDryRun } = await import("../driveImports/driveImportDryRun.ts");
    const source = getDriveImportSource(); // Select actual default BEFORE entering explicit native scope.
    assert.equal(source, getDriveImportSource());
    const original = await import(originalURL("src/lib/driveImports/googleDriveOperationScanner.ts")) as {
      scanOperationDriveFolder: typeof source.scan; searchOperationDriveFolders: typeof source.search
    };
    stage = "connect";
    await client.connect();
    assert.equal((await client.db("admin").command({ hello: 1 })).setName, "drivewriter20260930");
    assert.equal((await client.db("admin").command({ getCmdLineOpts: 1 })).parsed?.storage?.dbPath, `${ROOT}/mongo`);
    assert.equal((await client.db("admin").admin().listDatabases()).databases.some(db => db.name === databaseName), false);
    owned = true;
    stage = "prepare";
    const options = { client, databaseName, namespace: "shadow_drive_source", allowShadowWrites: true as const };
    await prepareMongoDriveImportWriter(options);
    const models = ["Company", "Course", "OperationSession", "DriveImportRun", "DriveImportResult"];
    const store = new MongoOperationStore(options, models);
    const companyId = randomUUID(), courseId = randomUUID(), sessionId = randomUUID(), at = new Date("2030-01-01T00:00:00.000Z");
    stage = "seed";
    const put = async (model: string, values: Record<string, unknown>) => store.collection(model).insertOne(encodeMongoRuntimeDocument(model, completeMongoRow(model, values)));
    await put("Company", { id: companyId, name: "FixtureOrg", normalizedName: "fixtureorg", createdAt: at, updatedAt: at });
    await put("Course", { id: courseId, companyId, courseId: "SYNTHETIC-SOURCE-COURSE", name: "FixtureCourse", operationType: "NEEDS_REVIEW", processSeq: 1, createdAt: at, updatedAt: at });
    const input = operation(sessionId, scenario);
    await put("OperationSession", { id: sessionId, courseRecordId: courseId, operationId: OP, operationStatus: "ASSIGNMENT_NEEDED", archiveStatus: "NOT_READY",
      educationFormat: "NEEDS_REVIEW", operationChannel: "NEEDS_REVIEW", onsiteRequired: "UNKNOWN", hasSatisfactionSurvey: "NEEDS_REVIEW", hasResultReport: "NEEDS_REVIEW",
      startDate: new Date("2032-02-03T00:00:00.000Z"), endDate: new Date("2032-02-04T00:00:00.000Z"), educationDates: [],
      omName: null, ldName: null, driveLink: input.driveLink || null, lectureManagementLink: null, createdAt: at, updatedAt: at });
    const business = async () => BSON.EJSON.stringify(await Promise.all(models.slice(0, 3).map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray())), { relaxed: false });
    const beforeBusiness = await business();
    stage = "load";
    const writer = await MongoDriveImportWriterRepository.open(options);
    const loaded = await writer.loadOperations(0);
    assert.deepEqual(loaded, [input], "ACTUAL_DB_OPERATION_WITH_NON_NULL_DATES");
    const outputs: Array<DriveImportScanResult | DriveFolderSearchResult> = [];
    const traces: string[][] = [];
    for (const implementation of [original, { scanOperationDriveFolder: source.scan, searchOperationDriveFolders: source.search }]) {
      stage = implementation === original ? "frozen-source" : "current-source";
      const oracle = new HttpOracle(scenario, publicKey, true); active = oracle;
      try {
        const result = isSearch(scenario) ? await implementation.searchOperationDriveFolders(loaded[0]) : await implementation.scanOperationDriveFolder(loaded[0].driveLink);
        assertSource(scenario, result); outputs.push(result);
      } finally { oracle.assertComplete(); active = undefined; }
      traces.push([...oracle.attempts].sort());
    }
    assert.deepEqual(traces[0], traces[1], "FROZEN_CURRENT_OUTGOING_REQUESTS");
    assert.deepEqual(withoutSourceTime(outputs[0]), withoutSourceTime(outputs[1]), "FROZEN_CURRENT_WHOLE_SOURCE_RESULT");
    const expected = expectation(scenario), progress: string[] = [];
    stage = "workflow";
    // Current scanner cache is warm after its direct call, except rejected OAuth/missing config.
    const workflowHTTP = new HttpOracle(scenario, publicKey, scenario === "oauth_error"); active = workflowHTTP;
    const started = Date.now();
    let result: Awaited<ReturnType<typeof runDriveImportDryRun>>;
    try { result = await runWithDataRepositories({ driveImportWriter: writer, driveImportSource: source }, () =>
      runDriveImportDryRun({ concurrency: 1, limit: 0, mode: "dry_run" }, message => { progress.push(message); })); }
    finally { workflowHTTP.assertComplete(); active = undefined; }
    const ended = Date.now();
    stage = "stored-ledger";
    assert.deepEqual(result, { runId: result.runId, status: "completed", summary: expected.summary });
    assert.deepEqual(progress, ["[drive-import-dry-run] 1/1"]);
    assert.equal(await business(), beforeBusiness, "WHOLE_BUSINESS_RAW_UNCHANGED");
    const runs = await store.collection("DriveImportRun").find({}).toArray(), results = await store.collection("DriveImportResult").find({}).toArray();
    assert.equal(runs.length, 1); assert.equal(results.length, 1);
    const run = decodeMongoRuntimeDocument("DriveImportRun", runs[0]), row = decodeMongoRuntimeDocument("DriveImportResult", results[0]);
    for (const id of [run.id, row.id]) assert.match(String(id), /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    for (const value of [run.startedAt, run.finishedAt, row.createdAt]) { assert.ok(value instanceof Date); assert.ok(value.getTime() >= started && value.getTime() <= ended); }
    const search = isSearch(scenario);
    // Decoder authenticates companion values. Keep every companion in whole-row assertions;
    // only its nondisclosed HMAC value is accepted after shape/nullability checks.
    assert.match(String(run.notesPiiIndex), /^[a-f0-9]{64}$/);
    assert.match(String(row.inputValuePiiIndex), /^[a-f0-9]{64}$/);
    for (const field of ["folderIdPiiIndex", "folderTitlePiiIndex", "folderUrlPiiIndex"]) {
      if (search) assert.equal(row[field], null); else assert.match(String(row[field]), /^[a-f0-9]{64}$/);
    }
    assert.equal(row.errorPiiIndex, null);
    const counts = { avgSatisfactionCandidateCount: 0, errorCount: 0, folderSearchCount: Number(search), folderSearchWithCandidatesCount: Number(expected.folderCandidates.length > 0),
      instructorCandidateCount: 0, instructorSatisfactionCandidateCount: 0, operationCount: 1, scanFoundFolderCount: Number(!search),
      scanIssueCount: Number(!search && expected.issues.length > 0), scannedRefCount: Number(!search), suspiciousCandidateCount: 0 };
    assert.deepEqual(run, { id: result.runId, mode: "dry_run", status: "COMPLETED", ...counts, notes: "Read-only Drive import dry run. Operation data is not modified.",
      summary: expected.summary, startedAt: run.startedAt, finishedAt: run.finishedAt, notesPiiIndex: run.notesPiiIndex });
    assert.deepEqual(row, { id: row.id, runId: result.runId, operationSessionId: sessionId, operationId: OP, companyName: "FixtureOrg", courseName: "FixtureCourse",
      startDate: new Date("2032-02-03T00:00:00.000Z"), endDate: new Date("2032-02-04T00:00:00.000Z"), inputKind: expected.inputKind, inputValue: expected.inputValue,
      resultKind: expected.resultKind, folderId: search ? null : "fixture-folder", folderTitle: search ? null : expected.folderTitle,
      folderUrl: search ? null : expected.folderUrl, fileCount: expected.fileCount, candidateCount: expected.candidateCount,
      keyCandidates: expected.keyCandidates, folderCandidates: expected.folderCandidates, issues: expected.issues, error: null, createdAt: row.createdAt,
      inputValuePiiIndex: row.inputValuePiiIndex, folderIdPiiIndex: row.folderIdPiiIndex, folderTitlePiiIndex: row.folderTitlePiiIndex,
      folderUrlPiiIndex: row.folderUrlPiiIndex, errorPiiIndex: null });
    const historyBeforeRead = BSON.EJSON.stringify([runs, results], { relaxed: false });
    stage = "reader";
    const reader = await MongoDriveImportHistoryRepository.open(options);
    const startISO = (run.startedAt as Date).toISOString(), finishISO = (run.finishedAt as Date).toISOString(), createdISO = (row.createdAt as Date).toISOString();
    const shared = { candidateCount: expected.candidateCount, createdAt: createdISO, fileCount: expected.fileCount, folderCandidates: expected.folderCandidates,
      folderTitle: expected.folderTitle, folderUrl: expected.folderUrl, inputKind: expected.inputKind, inputValue: expected.inputValue,
      issues: expected.issues, keyCandidates: expected.keyCandidates, resultKind: expected.resultKind };
    assert.deepEqual(await reader.readLatestDriveImportResult(OP), { ...shared, runId: result.runId, runStartedAt: startISO, runStatus: "COMPLETED" });
    assert.deepEqual(await reader.readLatestDriveImportRun(), { ...counts, id: result.runId, mode: "dry_run", status: "COMPLETED", startedAt: startISO, finishedAt: finishISO,
      results: [{ ...shared, companyName: "FixtureOrg", courseName: "FixtureCourse", startDate: "2032-02-03", endDate: "2032-02-04", error: "", operationId: OP }] });
    assert.equal(BSON.EJSON.stringify([await store.collection("DriveImportRun").find({}).toArray(), await store.collection("DriveImportResult").find({}).toArray()], { relaxed: false }), historyBeforeRead);
    // Full raw scans: public synthetic company/course snapshots are intentionally not secret markers.
    stage = "privacy";
    const raw = inspect(await Promise.all(models.map(model => store.collection(model).find({}).toArray())), { depth: null, maxArrayLength: null, maxStringLength: null });
    const logText = inspect(logs, { depth: null, maxArrayLength: null, maxStringLength: null });
    for (const secret of [CANARY, TOKEN, privateKey, "https://example.invalid", "FixtureRoom", "강의관리 패들렛"]) assert.ok(!raw.includes(secret), "RAW_PRIVATE_MARKER");
    for (const secret of [CANARY, TOKEN, privateKey, "FixtureOrg", "FixtureCourse", "https://example.invalid"]) assert.ok(!logText.includes(secret), "LOG_PRIVATE_MARKER");
    assert.equal(pgCalls, 0); assert.equal(outsideAttempts, 0);
    assert.equal((globalThis as { prisma?: unknown }).prisma, undefined);
    // The same transport oracle must reject a swallowed options assertion and an extra request.
    if (scenario === "scan") {
      stage = "negative-controls";
      const negative = new HttpOracle("scan", publicKey, false, true); active = negative;
      try { assertSource("metadata_error", await source.scan(input.driveLink)); }
      finally { active = undefined; }
      assert.deepEqual(negative.violations, ["HTTP_CONTRACT:1"]); assert.equal(negative.attempts.length, 1);
      assert.throws(() => negative.assertComplete(), { name: "AssertionError" });
      const extra = new HttpOracle("missing_config", publicKey, false);
      await assert.rejects(extra.fetch("https://example.invalid/unscripted"), /HTTP_ORACLE_FAILED/);
      assert.deepEqual(extra.violations, ["HTTP_CONTRACT:1"]); assert.equal(extra.attempts.length, 1);
      assert.throws(() => extra.assertComplete(), { name: "AssertionError" });
      // Whole tuple comparison detects omission without asking the product to build expectations.
      assert.throws(() => assert.deepEqual({ ...row, candidateCount: 3 }, row), { name: "AssertionError" });
    }
    // Detect newly-created out-of-scope collections, including unexpected audit writes.
    stage = "final-invariants";
    const names = (await store.db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name);
    assert.deepEqual(names.sort(), models.map(model => `shadow_drive_source_${model}`).sort(), "UNEXPECTED_COLLECTION_OR_AUDIT_WRITE");
    assert.equal(await business(), beforeBusiness, "FINAL_BUSINESS_RAW_UNCHANGED");
  } catch (error) {
    failedStage = stage;
    throw error;
  } finally {
    stage = "cleanup";
    try {
      if (owned) {
        assert.match(databaseName, /^hub_om_shadow_drive_writer_source_[a-f0-9]{20}$/);
        await client.db(databaseName).dropDatabase();
        assert.equal((await client.db("admin").admin().listDatabases()).databases.some(db => db.name === databaseName), false, "OWNED_DB_CLEANUP_FAILED");
      }
    } catch (error) {
      failedStage = "cleanup";
      throw error;
    } finally {
      stage = "close";
      try { await client.close(); }
      catch (error) { failedStage = "close"; throw error; }
      finally { fetchPatch.mock.restore(); pgPatch.restore(); captures.forEach(patch => patch.mock.restore()); hook.deregister(); currentHook.deregister(); }
    }
  }
  process.send?.({ ok: true, scenario, cleaned: true });
}
main().catch(() => {
  // Only fixture-owned literals cross IPC; assertion actual/expected and error.message never do.
  process.send?.({ ok: false, code: "SOURCE_WORKER_FAILED", stage: failedStage ?? stage });
  process.exitCode = 1;
});
