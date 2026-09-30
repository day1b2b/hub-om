import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { getDriveImportWriterRepository } from "./driveImportWriterFactory";
import { getDriveImportSource, type DriveImportSource } from "./driveImportSource";
import { PrismaDriveImportWriterRepository } from "./prismaDriveImportWriterRepository";
import type { DriveImportArgs, DriveImportOperation, DriveImportResultInput, DriveImportSummary, DriveImportWriterRepository } from "./driveImportWriterRepository";
import { parseDriveImportArgs, runDriveImportDryRun } from "../driveImports/driveImportDryRun";

// These are port/scope unit witnesses, not native storage or actual scanner evidence.
const args: DriveImportArgs = { concurrency: 1, limit: 0, mode: "dry_run" };
const emptySummary: DriveImportSummary = {
  avgSatisfactionCandidates: 0, errors: 0, folderSearches: 0, folderSearchWithCandidates: 0,
  instructorCandidates: 0, instructorSatisfactionCandidates: 0, scanFoundFolder: 0,
  scanIssues: 0, scannedRefs: 0, suspicious: { badInstructorFragments: 0, clockInstructorCandidates: 0, zeroSatisfactionCandidates: 0 },
  suspiciousCandidateCount: 0
};
function operation(marker: string): DriveImportOperation {
  return { id: `synthetic-id-${marker}`, operationId: `synthetic-operation-${marker}`,
    companyName: "synthetic-company", courseName: "synthetic-course", startDate: "2026-09-30", endDate: "2026-10-01",
    om: "synthetic-om", ld: "synthetic-ld", driveLink: "", lectureManagementLink: "" };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function ports(marker: string, operations: DriveImportOperation[] = [operation(marker)]) {
  const calls: string[] = [];
  const results: DriveImportResultInput[] = [];
  const writer: DriveImportWriterRepository = {
    async loadOperations(limit) { calls.push(`load:${limit}`); return operations; },
    async createRun(input, count) { calls.push(`create:${input.mode}:${count}`); return `run-${marker}`; },
    async appendResult(runId, row, input, result) {
      calls.push(`append:${runId}:${row.operationId}:${input.kind}`); results.push(result);
    },
    async finishRun(runId, summary, status) { calls.push(`finish:${runId}:${status}:${summary.errors}`); },
    async close() { calls.push("close"); }
  };
  const source: DriveImportSource = {
    async scan(value) {
      calls.push(`scan:${value}`);
      return { folderId: "", folderTitle: "", folderUrl: value, scannedAt: "synthetic-clock", candidates: [], files: [], issues: [] };
    },
    async search(row) {
      calls.push(`search:${row.operationId}`);
      return { candidates: [], issues: [], searchedAt: "synthetic-clock" };
    }
  };
  return { writer, source, calls, results, scope: { driveImportWriter: writer, driveImportSource: source } };
}
function defaultTripwires(t: TestContext) {
  const violations: string[] = [];
  for (const name of ["loadOperations", "createRun", "appendResult", "finishRun", "close"] as const) {
    t.mock.method(PrismaDriveImportWriterRepository.prototype, name, async () => {
      violations.push(`default:${name}`); throw new Error("SYNTHETIC_DEFAULT_FORBIDDEN");
    });
  }
  t.mock.method(globalThis, "fetch", async () => {
    violations.push("fetch"); throw new Error("SYNTHETIC_HTTP_FORBIDDEN");
  });
  return () => assert.deepEqual(violations, []);
}

test("Drive writer args: original literal parsing, including zero workers and flag values", () => {
  const cases: Array<[string[], string | undefined, DriveImportArgs]> = [
    [[], undefined, { concurrency: 3, limit: 0, mode: "dry_run" }],
    [[], "", { concurrency: 3, limit: 0, mode: "dry_run" }],
    [[], "4.8", { concurrency: 4, limit: 0, mode: "dry_run" }],
    [[], "0.5", { concurrency: 0, limit: 0, mode: "dry_run" }],
    [[], "0", { concurrency: 3, limit: 0, mode: "dry_run" }],
    [[], "-2", { concurrency: 3, limit: 0, mode: "dry_run" }],
    [[], "NaN", { concurrency: 3, limit: 0, mode: "dry_run" }],
    [[], "Infinity", { concurrency: 3, limit: 0, mode: "dry_run" }],
    [["--concurrency", "0.5", "--limit", "0.5"], undefined, { concurrency: 0, limit: 0, mode: "dry_run" }],
    [["--concurrency", "0", "--limit", "-1"], undefined, { concurrency: 3, limit: 0, mode: "dry_run" }],
    [["--concurrency", "Infinity", "--limit", "NaN"], undefined, { concurrency: 3, limit: 0, mode: "dry_run" }],
    [["--concurrency", "2.9", "--limit", "7.9", "--mode", "synthetic-mode"], "9", { concurrency: 2, limit: 7, mode: "synthetic-mode" }],
    [["--concurrency"], "8", { concurrency: 3, limit: 0, mode: "dry_run" }],
    [["--limit"], undefined, { concurrency: 3, limit: 0, mode: "dry_run" }],
    [["--mode"], undefined, { concurrency: 3, limit: 0, mode: "dry_run" }],
    [["--limit", "1", "--limit", "3"], undefined, { concurrency: 3, limit: 3, mode: "dry_run" }],
    [["--mode", "--limit", "2"], undefined, { concurrency: 3, limit: 2, mode: "--limit" }],
    [["--concurrency", "--limit", "2"], undefined, { concurrency: 3, limit: 2, mode: "dry_run" }]
  ];
  for (const [argv, env, expected] of cases) assert.deepEqual(parseDriveImportArgs(argv, env), expected, JSON.stringify([argv, env]));
});

test("Drive writer scope: either missing port rejects before any port IO or progress", async t => {
  const checkDefault = defaultTripwires(t);
  const h = ports("missing");
  const progress: string[] = [];
  for (const [scope, missing] of [
    [{}, "driveImportWriter"],
    [{ driveImportSource: h.source }, "driveImportWriter"],
    [{ driveImportWriter: h.writer }, "driveImportSource"]
  ] as const) {
    await assert.rejects(runWithDataRepositories(scope, () => runDriveImportDryRun(args, line => progress.push(line))), {
      message: `DATA_REPOSITORY_NOT_CONFIGURED: ${missing}`
    });
  }
  assert.deepEqual(h.calls, []); assert.deepEqual(progress, []); checkDefault();
});

test("Drive writer scope: load/create rejection never starts source or fallback or closes borrowed writer", async t => {
  const checkDefault = defaultTripwires(t);
  for (const stage of ["loadOperations", "createRun"] as const) {
    const h = ports(stage), failure = new Error("SYNTHETIC_PREFLIGHT_FAILURE");
    h.writer[stage] = async () => { h.calls.push(stage); throw failure; };
    await assert.rejects(runWithDataRepositories(h.scope, () => runDriveImportDryRun(args)), error => error === failure);
    assert.deepEqual(h.calls, stage === "loadOperations" ? [stage] : ["load:0", stage]);
  }
  checkDefault();
});

test("Drive writer scope: concurrent A/B ports stay paired after a shared barrier; nested partial scopes do not inherit", { timeout: 5000 }, async t => {
  const checkDefault = defaultTripwires(t);
  const a = ports("a"), b = ports("b"), bothEntered = deferred();
  let entered = 0;
  for (const h of [a, b]) {
    h.source.search = async row => {
      h.calls.push(`search:${row.operationId}`);
      if (++entered === 2) bothEntered.resolve();
      await bothEntered.promise;
      assert.equal(getDriveImportWriterRepository(), h.writer);
      assert.equal(getDriveImportSource(), h.source);
      await assert.rejects(runWithDataRepositories({ driveImportWriter: h.writer }, () => runDriveImportDryRun(args)), {
        message: "DATA_REPOSITORY_NOT_CONFIGURED: driveImportSource"
      });
      assert.equal(getDriveImportSource(), h.source);
      return { candidates: [], issues: [], searchedAt: "synthetic-clock" };
    };
  }
  const result = await Promise.all([a, b].map(h => runWithDataRepositories(h.scope, () => runDriveImportDryRun(args))));
  assert.equal(entered, 2);
  for (const [index, marker] of ["a", "b"].entries()) {
    assert.deepEqual(result[index], { runId: `run-${marker}`, status: "completed", summary: { ...emptySummary, folderSearches: 1 } });
    assert.deepEqual([a, b][index].calls, ["load:0", "create:dry_run:1", `search:synthetic-operation-${marker}`,
      `append:run-${marker}:synthetic-operation-${marker}:folderSearch`, `finish:run-${marker}:completed:0`]);
  }
  checkDefault();
});

test("Drive workflow: zero operations and fractional concurrency preserve source0/results0 completion", async () => {
  for (const count of [0, 2]) {
    const h = ports("zero", Array.from({ length: count }, (_, i) => operation(String(i))));
    const input = parseDriveImportArgs(["--concurrency", "0.5"]);
    const progress: string[] = [];
    const result = await runWithDataRepositories(h.scope, () => runDriveImportDryRun(input, line => progress.push(line)));
    assert.deepEqual(result, { runId: "run-zero", status: "completed", summary: emptySummary });
    assert.deepEqual(h.calls, ["load:0", `create:dry_run:${count}`, "finish:run-zero:completed:0"]);
    assert.deepEqual(h.results, []); assert.deepEqual(progress, []);
  }
});

test("Drive workflow: source Error/non-Error text goes only to the result port, not console", async t => {
  const output: unknown[][] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) t.mock.method(console, method, (...values: unknown[]) => { output.push(values); });
  for (const thrown of [new Error("synthetic-private-source-error"), "synthetic-private-string", null]) {
    const h = ports("failure");
    h.source.search = async () => { throw thrown; };
    const result = await runWithDataRepositories(h.scope, () => runDriveImportDryRun(args));
    assert.deepEqual(h.results, [{ error: thrown instanceof Error ? "synthetic-private-source-error" : thrown === null ? "null" : "synthetic-private-string", resultKind: "error" }]);
    assert.deepEqual(result, { runId: "run-failure", status: "completed_with_errors", summary: { ...emptySummary, folderSearches: 1, errors: 1 } });
  }
  assert.deepEqual(output, []);
});

test("Drive workflow: runtime malformed link fails outside per-operation catch and finally", async () => {
  const malformed = { ...operation("bad-link"), driveLink: 7 as unknown as string };
  const h = ports("bad-link", [malformed]), progress: string[] = [];
  await assert.rejects(runWithDataRepositories(h.scope, () => runDriveImportDryRun(args, line => progress.push(line))), TypeError);
  assert.deepEqual(h.calls, ["load:0", "create:dry_run:1"]);
  assert.deepEqual(h.results, []); assert.deepEqual(progress, []);
});

test("Drive workflow: numeric progress remains at 25 and final; caller owns close", async () => {
  const h = ports("progress", Array.from({ length: 26 }, (_, i) => operation(String(i)))), progress: string[] = [];
  await runWithDataRepositories(h.scope, () => runDriveImportDryRun(args, line => progress.push(line)));
  assert.deepEqual(progress, ["[drive-import-dry-run] 25/26", "[drive-import-dry-run] 26/26"]);
  assert.equal(h.results.length, 26); assert.equal(h.calls.includes("close"), false);
  await h.writer.close(); assert.equal(h.calls.at(-1), "close");
});

test("Drive workflow: Promise.all rejects without cancelling another scoped worker (port fault, not native)", { timeout: 5000 }, async t => {
  const checkDefault = defaultTripwires(t);
  const rows = [operation("a"), operation("b")], h = ports("partial", rows);
  const bothEntered = deferred(), releaseB = deferred(), appendedB = deferred();
  let entered = 0;
  const failure = new Error("SYNTHETIC_APPEND_FAILURE");
  h.source.search = async row => {
    h.calls.push(`search:${row.operationId}`);
    if (++entered === 2) bothEntered.resolve();
    await bothEntered.promise;
    if (row.id === rows[1].id) await releaseB.promise;
    return { candidates: [], issues: [], searchedAt: "synthetic-clock" };
  };
  h.writer.appendResult = async (_runId, row, _input, result) => {
    h.calls.push(`append:${row.operationId}:${result.resultKind}`);
    if (row.id === rows[0].id) throw failure; // Both normal/error appends fail for A.
    assert.equal(getDriveImportWriterRepository(), h.writer);
    assert.equal(getDriveImportSource(), h.source);
    h.results.push(result); appendedB.resolve();
  };
  const pending = runWithDataRepositories(h.scope, () => runDriveImportDryRun({ ...args, concurrency: 2 }));
  try {
    await assert.rejects(pending, error => error === failure);
    assert.equal(entered, 2); assert.deepEqual(h.results, []);
    assert.deepEqual(h.calls.filter(call => call.startsWith("append:")), [
      "append:synthetic-operation-a:folder_search_empty", "append:synthetic-operation-a:error"
    ]);
  } finally {
    releaseB.resolve();
    await appendedB.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.deepEqual(h.results, [{ candidateCount: 0, folderCandidates: [], issues: [], resultKind: "folder_search_empty" }]);
  assert.equal(h.calls.some(call => call.startsWith("finish:") || call === "close"), false);
  assert.equal(h.calls.filter(call => call.startsWith("search:")).length, 2);
  checkDefault();
});

test("Drive workflow: finish failure propagates with earlier result and without source retry/automatic close", async () => {
  const h = ports("finish"), failure = new Error("SYNTHETIC_FINISH_FAILURE");
  h.writer.finishRun = async () => { h.calls.push("finish-fault"); throw failure; };
  await assert.rejects(runWithDataRepositories(h.scope, () => runDriveImportDryRun(args)), error => error === failure);
  assert.equal(h.results.length, 1);
  assert.deepEqual(h.calls, ["load:0", "create:dry_run:1", "search:synthetic-operation-finish",
    "append:run-finish:synthetic-operation-finish:folderSearch", "finish-fault"]);
});

test("Drive CLI/workflow import: direct source entry counters reject real HTTP0 import regressions", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  for (const mode of ["normal", "negative-scan", "negative-search"]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-loader", "./scripts/ts-loader.mjs",
      fileURLToPath(new URL("./driveImportWriterScope.fixture.ts", import.meta.url)), mode], {
      cwd: root, env: { PATH: process.env.PATH, TZ: "UTC", NODE_ENV: "test", NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 15_000
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, "");
    assert.deepEqual(JSON.parse(child.stdout), { imported: true, mode, defaultWriter: "PrismaDriveImportWriterRepository", defaultScanIdentity: true,
      entries: { scan: mode === "negative-scan" ? 1 : 0, search: mode === "negative-search" ? 1 : 0 },
      noHttpNegativeControl: mode !== "normal", violations: [] });
  }
});
