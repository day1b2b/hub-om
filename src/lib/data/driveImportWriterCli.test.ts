/** Actual new CLI/main/exit with explicitly synthetic source/repository ports.
 * These tests prove entry behavior, NOT PG/native persistence or actual scanner IO.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

type Mode = "success" | "source-error" | "missing-key" | "close-error" | "blocked-worker";
interface Event { event: string; value: unknown }
const repository = new URL("../../../", import.meta.url);
const rawError = "synthetic-cli-private-error@example.invalid";
const summary = { avgSatisfactionCandidates: 0, errors: 0, folderSearches: 1, folderSearchWithCandidates: 0,
  instructorCandidates: 0, instructorSatisfactionCandidates: 0, scanFoundFolder: 0, scanIssues: 0, scannedRefs: 0,
  suspicious: { badInstructorFragments: 0, clockInstructorCandidates: 0, zeroSatisfactionCandidates: 0 }, suspiciousCandidateCount: 0 };
const outcome = (failed = false) => ({ runId: "synthetic-cli-run", status: failed ? "completed_with_errors" : "completed",
  summary: { ...summary, errors: failed ? 1 : 0 } });
const fixedError = "DRIVE_IMPORT_WRITER_FAILED\n";
const values = (events: Event[], name: string) => events.filter(entry => entry.event === name).map(entry => entry.value);
let interruptedRun = false;

/** Classification only: never return arbitrary stderr, stack, path, or error.message. */
function bootstrapDiagnostic(stderr: string): string {
  for (const code of ["CLI_PRELOAD_MODE_INVALID", "CLI_PRELOAD_CWD_MISSING", "CLI_PRELOAD_CWD_MISMATCH", "CLI_PRELOAD_CWD_NOT_OWNED",
    "ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX", "ERR_UNKNOWN_FILE_EXTENSION", "ERR_ASSERTION", "ENOENT", "EACCES"]) {
    if (new RegExp(`\\b${code}\\b`).test(stderr)) return code;
  }
  for (const kind of ["SyntaxError", "TypeError", "ReferenceError", "RangeError", "AssertionError"]) {
    if (new RegExp(`\\b${kind}\\b`).test(stderr)) return kind;
  }
  return "UNCLASSIFIED";
}

async function actualCli(mode: Mode, args: string[] = []) {
  assert.equal(interruptedRun, false, "PRIOR_CLI_INTERRUPTION_STOPPED_FURTHER_CHILDREN");
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "hub-om-drive-cli-")));
  let closed = false, spawned = false;
  try {
    writeFileSync(join(cwd, ".env"), [
      "# Synthetic only; inherited values must be overwritten.", "DRIVE_IMPORT_DRY_RUN_CONCURRENCY=3", "DRIVE_CLI_ORDER=base",
      "DRIVE_CLI_BASE_ONLY=synthetic-base", "DRIVE_CLI_EMPTY=base", "DRIVE_CLI_DOUBLE=base", "DRIVE_CLI_SINGLE=base",
      "DATABASE_URL=postgresql://synthetic@127.0.0.1:1/forbidden", "export DRIVE_CLI_IGNORED=not-loaded"
    ].join("\n"));
    writeFileSync(join(cwd, ".env.local"), [
      "  DRIVE_IMPORT_DRY_RUN_CONCURRENCY=2  ", "DRIVE_CLI_ORDER=local", "DRIVE_CLI_EMPTY=",
      'DRIVE_CLI_DOUBLE="synthetic-first\\nsynthetic-second"', "DRIVE_CLI_SINGLE='synthetic-third\\nsynthetic-fourth'",
      "DRIVE_CLI_UNQUOTED=synthetic-left\\nsynthetic-right", "DRIVE_CLI_EQUALS=synthetic=value"
    ].join("\n"));
    const child = spawn(process.execPath, ["--experimental-strip-types", "--experimental-loader", fileURLToPath(new URL("scripts/ts-loader.mjs", repository)),
      "--import", new URL("driveImportWriterCli.fixture.ts", import.meta.url).href,
      fileURLToPath(new URL("scripts/run-drive-import-dry-run.mjs", repository)), ...args], {
      cwd, env: { PATH: process.env.PATH, TZ: "UTC", NODE_ENV: "test", NODE_NO_WARNINGS: "1",
        DRIVE_CLI_TEST_MODE: mode, DRIVE_CLI_TEST_CWD: cwd, DRIVE_IMPORT_DRY_RUN_CONCURRENCY: "9", DRIVE_CLI_ORDER: "inherited" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    spawned = true;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    child.stdout.on("data", data => stdout.push(Buffer.from(data)));
    child.stderr.on("data", data => stderr.push(Buffer.from(data)));
    let interrupted = false, spawnError: Error | undefined;
    let kill: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => { interrupted = true; child.kill("SIGTERM"); kill = setTimeout(() => child.kill("SIGKILL"), 2000); }, 15_000);
    child.once("error", error => { spawnError = error; });
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
      child.once("close", (code, signal) => { closed = true; clearTimeout(timer); clearTimeout(kill); resolve({ code, signal }); });
    });
    if (interrupted || exit.signal) interruptedRun = true;
    assert.ifError(spawnError);
    assert.equal(interrupted, false, "CLI_REQUIRED_FORCED_TERMINATION"); assert.equal(exit.signal, null);
    const out = Buffer.concat(stdout).toString(), err = Buffer.concat(stderr).toString();
    const observerPath = join(cwd, "observer.jsonl");
    if (!existsSync(observerPath)) {
      throw new Error(`CLI_PRELOAD_OBSERVER_MISSING:${bootstrapDiagnostic(err)}:exit=${exit.code ?? "null"}`);
    }
    const events = readFileSync(observerPath, "utf8").trim().split("\n").map(line => JSON.parse(line) as Event);
    assert.deepEqual(values(events, "forbidden"), [], "CLI_FORBIDDEN_IO");
    for (const marker of [rawError, "synthetic-cli-private-cause", "postgresql://", "synthetic-company", "PII_ACTIVE_KEY_ID"]) {
      assert.ok(!out.includes(marker) && !err.includes(marker), "CLI_PRIVATE_OUTPUT");
    }
    assert.deepEqual(values(events, "env-read"), [".env", ".env.local"]);
    assert.equal(events[0].event, "preload-ready"); assert.equal(events.at(-1)?.event, "exit");
    return { ...exit, out, err, events };
  } finally {
    // Never remove a child's files while it may still be running.
    if (!spawned || closed) rmSync(cwd, { recursive: true });
  }
}

test("Drive CLI actual entry: env overwrite order, quoted multiline, real run -> close -> final JSON (synthetic ports)", async () => {
  const result = await actualCli("success");
  assert.equal(result.code, 0); assert.equal(result.err, "");
  assert.deepEqual(values(result.events, "load"), [{ limit: 0, env: {
    DRIVE_IMPORT_DRY_RUN_CONCURRENCY: "2", DRIVE_CLI_ORDER: "local", DRIVE_CLI_BASE_ONLY: "synthetic-base", DRIVE_CLI_EMPTY: "",
    DRIVE_CLI_DOUBLE: "synthetic-first\nsynthetic-second", DRIVE_CLI_SINGLE: "synthetic-third\nsynthetic-fourth",
    DRIVE_CLI_UNQUOTED: "synthetic-left\\nsynthetic-right", DRIVE_CLI_EQUALS: "synthetic=value", DRIVE_CLI_IGNORED: null
  } }]);
  assert.deepEqual(values(result.events, "create"), [{ args: { concurrency: 2, limit: 0, mode: "dry_run" }, operationCount: 1 }]);
  assert.deepEqual(values(result.events, "source-enter"), ["synthetic-a"]);
  assert.deepEqual(values(result.events, "append"), [{ runId: "synthetic-cli-run", operationId: "synthetic-a",
    input: { kind: "folderSearch", value: "" }, result: { candidateCount: 0, folderCandidates: [], issues: [], resultKind: "folder_search_empty" } }]);
  assert.equal(result.out, `[drive-import-dry-run] 1/1\n${JSON.stringify(outcome(), null, 2)}\n`);
  assert.deepEqual(values(result.events, "finish"), [outcome()]);
  assert.deepEqual(values(result.events, "close"), [null]);
  assert.deepEqual(result.events.filter(event => ["finish", "close", "stdout"].includes(event.event)), [
    { event: "stdout", value: ["[drive-import-dry-run] 1/1"] }, { event: "finish", value: outcome() },
    { event: "close", value: null }, { event: "stdout", value: [JSON.stringify(outcome(), null, 2)] }
  ]);
  assert.deepEqual(values(result.events, "exit"), [{ code: 0, blocked: false, bCompleted: false }]);
});

test("Drive CLI actual entry: argv overrides loaded concurrency and retains arbitrary mode (synthetic ports)", async () => {
  const result = await actualCli("success", ["--concurrency", "1.9", "--limit", "2.9", "--mode", "synthetic-mode"]);
  assert.equal(result.code, 0); assert.equal(result.err, "");
  assert.deepEqual(values(result.events, "create"), [{ args: { concurrency: 1, limit: 2, mode: "synthetic-mode" }, operationCount: 1 }]);
  assert.equal((values(result.events, "load")[0] as { limit: number }).limit, 2);
  assert.deepEqual(values(result.events, "source-enter"), ["synthetic-a"]);
});

test("Drive CLI actual entry: real default PG privacy check rejects missing keys before DB/source and exits1 safely", async () => {
  const result = await actualCli("missing-key");
  assert.equal(result.code, 1); assert.equal(result.out, ""); assert.equal(result.err, fixedError);
  assert.deepEqual(values(result.events, "real-privacy-check"), [null]);
  // No synthetic writer substitution in this mode; actual getPrismaClient fails before connection.
  for (const name of ["writer-resolve", "load", "create", "source-enter", "append", "finish", "close"]) assert.deepEqual(values(result.events, name), []);
  assert.deepEqual(values(result.events, "source-resolve"), [null]);
  assert.deepEqual(values(result.events, "exit"), [{ code: 1, blocked: false, bCompleted: false }]);
});

test("Drive CLI actual entry: source error text reaches synthetic append port while public JSON stays summary-only", async () => {
  const result = await actualCli("source-error");
  assert.equal(result.code, 0); assert.equal(result.err, "");
  assert.deepEqual(values(result.events, "append"), [{ runId: "synthetic-cli-run", operationId: "synthetic-a",
    input: { kind: "folderSearch", value: "" }, result: { error: rawError, resultKind: "error" } }]);
  assert.deepEqual(values(result.events, "finish"), [outcome(true)]);
  assert.equal(result.out, `[drive-import-dry-run] 1/1\n${JSON.stringify(outcome(true), null, 2)}\n`);
  assert.deepEqual(values(result.events, "close"), [null]);
});

test("Drive CLI actual entry: close failure exits1 with fixed error and never prints success JSON", async () => {
  const result = await actualCli("close-error");
  assert.equal(result.code, 1); assert.equal(result.err, fixedError);
  assert.equal(result.out, "[drive-import-dry-run] 1/1\n");
  assert.deepEqual(values(result.events, "finish"), [outcome()]);
  assert.deepEqual(values(result.events, "close"), [null]);
  assert.deepEqual(values(result.events, "stderr"), [["DRIVE_IMPORT_WRITER_FAILED"]]);
});

test("Drive CLI actual exit1 interrupts a barrier-blocked second worker; no completed persistence is claimed", async () => {
  const result = await actualCli("blocked-worker");
  assert.equal(result.code, 1); assert.equal(result.err, fixedError); assert.equal(result.out, "");
  assert.deepEqual(values(result.events, "source-enter"), ["synthetic-a", "synthetic-b"]);
  assert.deepEqual(values(result.events, "worker-blocked"), ["synthetic-b"]);
  assert.deepEqual(values(result.events, "source-return"), ["synthetic-a"]);
  assert.deepEqual(values(result.events, "append"), [
    { runId: "synthetic-cli-run", operationId: "synthetic-a", input: { kind: "folderSearch", value: "" },
      result: { candidateCount: 0, folderCandidates: [], issues: [], resultKind: "folder_search_empty" } },
    { runId: "synthetic-cli-run", operationId: "synthetic-a", input: { kind: "folderSearch", value: "" }, result: { error: rawError, resultKind: "error" } }
  ]);
  assert.deepEqual(values(result.events, "finish"), []); assert.deepEqual(values(result.events, "close"), []);
  assert.deepEqual(values(result.events, "exit"), [{ code: 1, blocked: true, bCompleted: false }]);
});
