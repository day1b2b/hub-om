/** Preload for the REAL CLI entry. Source/repository ports are synthetic observers,
 * never persistence evidence. Missing-key mode keeps the real default PG repository
 * and instruments only entry to its real privacy check; all DB/HTTP IO is trapped.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { basename, join, resolve } from "node:path";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { mock } from "node:test";
import pg from "pg";
import type { DriveImportSource } from "./driveImportSource";
import type { DriveImportOperation, DriveImportWriterRepository } from "./driveImportWriterRepository";

const mode = process.env.DRIVE_CLI_TEST_MODE;
assert.ok(mode && ["success", "source-error", "missing-key", "close-error", "blocked-worker"].includes(mode), "CLI_PRELOAD_MODE_INVALID");
assert.ok(process.env.DRIVE_CLI_TEST_CWD, "CLI_PRELOAD_CWD_MISSING");
// macOS may report /private/tmp for a child launched with a /tmp cwd.
const cwd = fs.realpathSync(process.env.DRIVE_CLI_TEST_CWD);
assert.ok(fs.realpathSync(process.cwd()) === cwd, "CLI_PRELOAD_CWD_MISMATCH");
assert.ok(/^hub-om-drive-cli-[A-Za-z0-9]+$/.test(basename(cwd)), "CLI_PRELOAD_CWD_NOT_OWNED");
const ledger = join(cwd, "observer.jsonl");
const record = (event: string, value: unknown = null) => fs.appendFileSync(ledger, `${JSON.stringify({ event, value })}\n`);
const secret = "synthetic-cli-private-error@example.invalid";
const failure = () => new Error(secret, { cause: new Error("synthetic-cli-private-cause") });
const forbidden = (kind: string): never => { record("forbidden", kind); throw failure(); };
const operation = (id: string): DriveImportOperation => ({ id, operationId: `synthetic-${id}`, companyName: "synthetic-company",
  courseName: "synthetic-course", startDate: "2026-09-30", endDate: "2026-10-01", om: "", ld: "", driveLink: "", lectureManagementLink: "" });
let releaseA!: () => void;
const bEntered = new Promise<void>(done => { releaseA = done; });
let blocked = false, bCompleted = false;
const writer: DriveImportWriterRepository = {
  async loadOperations(limit) {
    record("load", { limit, env: Object.fromEntries([
      "DRIVE_IMPORT_DRY_RUN_CONCURRENCY", "DRIVE_CLI_ORDER", "DRIVE_CLI_BASE_ONLY", "DRIVE_CLI_EMPTY",
      "DRIVE_CLI_DOUBLE", "DRIVE_CLI_SINGLE", "DRIVE_CLI_UNQUOTED", "DRIVE_CLI_EQUALS", "DRIVE_CLI_IGNORED"
    ].map(key => [key, process.env[key] ?? null])) });
    return mode === "blocked-worker" ? [operation("a"), operation("b")] : [operation("a")];
  },
  async createRun(args, operationCount) { record("create", { args, operationCount }); return "synthetic-cli-run"; },
  async appendResult(runId, row, input, result) {
    record("append", { runId, operationId: row.operationId, input, result });
    if (mode === "blocked-worker") throw failure(); // A normal append AND its catch append fail.
  },
  async finishRun(runId, summary, status) { record("finish", { runId, summary, status }); },
  async close() { record("close"); if (mode === "close-error") throw failure(); }
};
const source: DriveImportSource = {
  async scan() { return forbidden("unexpected-scan"); },
  async search(row) {
    record("source-enter", row.operationId);
    if (mode === "source-error") throw failure();
    if (mode === "blocked-worker") {
      if (row.id === "a") await bEntered;
      else {
        blocked = true; record("worker-blocked", row.operationId); releaseA();
        // Keep the process alive unless the actual CLI calls process.exit(1).
        // There is deliberately no timer-based completion or invented DB commit.
        const keepAlive = setInterval(() => {}, 1000);
        try { await new Promise<void>(() => {}); }
        finally { clearInterval(keepAlive); }
        bCompleted = true;
      }
    }
    record("source-return", row.operationId);
    return { candidates: [], issues: [], searchedAt: "synthetic-clock" };
  }
};
const globalProbe = globalThis as typeof globalThis & {
  __driveCliPorts?: { writer: () => DriveImportWriterRepository; source: () => DriveImportSource };
  __driveCliPrivacyEntry?: () => void;
};
assert.equal(globalProbe.__driveCliPorts, undefined);
globalProbe.__driveCliPorts = {
  writer: () => { record("writer-resolve"); return writer; },
  source: () => { record("source-resolve"); return source; }
};
globalProbe.__driveCliPrivacyEntry = () => { record("real-privacy-check"); };
const repositoryURL = new URL("../../../", import.meta.url);
const factoryURL = new URL("driveImportWriterFactory.ts", import.meta.url);
const sourceURL = new URL("driveImportSource.ts", import.meta.url);
const cryptoURL = new URL("../privacy/crypto.ts", import.meta.url);
const seam = (kind: "writer" | "source") => `data:text/javascript,${encodeURIComponent(`export function ${kind === "writer" ? "getDriveImportWriterRepository" : "getDriveImportSource"}(){return globalThis.__driveCliPorts.${kind}();}`)}`;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(repositoryURL.href)) {
      if (specifier.startsWith(".")) {
        const target = new URL(specifier, context.parentURL).href.replace(/\.ts$/, "");
        if (target === factoryURL.href.replace(/\.ts$/, "") && mode !== "missing-key") return { url: seam("writer"), shortCircuit: true };
        if (target === sourceURL.href.replace(/\.ts$/, "")) return { url: seam("source"), shortCircuit: true };
      }
      if (specifier.startsWith("@/")) for (const suffix of [".ts", "/index.ts"]) {
        const target = new URL(`src/${specifier.slice(2)}${suffix}`, repositoryURL);
        if (fs.existsSync(target)) return { url: target.href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (mode === "missing-key" && url === cryptoURL.href) {
      const text = fs.readFileSync(cryptoURL, "utf8");
      const signature = "export function assertPrivacyConfiguration() {";
      assert.equal(text.split(signature).length, 2, "REAL_PRIVACY_ENTRY_NOT_FOUND");
      return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(
        text.replace(signature, `${signature} globalThis.__driveCliPrivacyEntry();`), { mode: "strip" }) };
    }
    return next(url, context);
  }
});
const read = fs.readFileSync;
mock.method(fs, "readFileSync", ((...values: Parameters<typeof fs.readFileSync>) => {
  const path = typeof values[0] === "string" ? resolve(values[0]) : null;
  if (path && [".env", ".env.local"].includes(basename(path))) {
    if (path !== join(cwd, basename(path))) return forbidden("foreign-env");
    record("env-read", basename(path));
  }
  return read(...values);
}) as typeof fs.readFileSync);
mock.method(pg.Client.prototype, "connect", () => forbidden("pg-client"));
mock.method(pg.Pool.prototype, "connect", () => forbidden("pg-pool"));
mock.method(globalThis, "fetch", async () => forbidden("http"));
const log = console.log.bind(console), error = console.error.bind(console);
mock.method(console, "log", (...values: unknown[]) => { record("stdout", values); log(...values); });
mock.method(console, "error", (...values: unknown[]) => { record("stderr", values); error(...values); });
process.once("exit", code => {
  record("exit", { code, blocked, bCompleted });
  hook.deregister(); mock.restoreAll(); delete globalProbe.__driveCliPorts; delete globalProbe.__driveCliPrivacyEntry;
});
record("preload-ready");
