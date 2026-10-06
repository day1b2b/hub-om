/** Fresh-process import probe. Normal imports must never call storage or source.
 * Negative controls inject a source call during actual workflow module evaluation.
 * A load hook adds entry counters to the real scanner bodies; it does not replace
 * their return values, configuration checks, parsing, or transport behavior.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { basename } from "node:path";
import { mock } from "node:test";
import pg from "pg";

const violations: string[] = [];
const mode = process.argv[2] ?? "normal";
assert.ok(["normal", "negative-scan", "negative-search"].includes(mode));
for (const name of ["GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_DRIVE_PRIVATE_KEY",
  "GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL", "GOOGLE_CALENDAR_PRIVATE_KEY"]) assert.equal(process.env[name], undefined);
const entries = { scan: 0, search: 0 };
const observation = globalThis as typeof globalThis & { __driveScopeSourceEntry?: (kind: "scan" | "search") => void };
assert.equal(observation.__driveScopeSourceEntry, undefined);
observation.__driveScopeSourceEntry = kind => { entries[kind]++; };
const scannerURL = new URL("../driveImports/googleDriveOperationScanner.ts", import.meta.url);
const workflowURL = new URL("../driveImports/driveImportDryRun.ts", import.meta.url);
let scannerLoads = 0, injectedWorkflowLoads = 0;
const hook = registerHooks({
  load(url, context, next) {
    if (url === scannerURL.href) {
      scannerLoads++;
      let source = fs.readFileSync(scannerURL, "utf8");
      for (const [signature, kind] of [
        ["export async function scanOperationDriveFolder(folderUrl: string): Promise<DriveImportScanResult> {", "scan"],
        ["export async function searchOperationDriveFolders(operation: OperationSession): Promise<DriveFolderSearchResult> {", "search"]
      ] as const) {
        assert.equal(source.split(signature).length, 2, "SCANNER_ENTRY_INSTRUMENTATION_MISMATCH");
        source = source.replace(signature, `${signature}\nglobalThis.__driveScopeSourceEntry(${JSON.stringify(kind)});`);
      }
      return { format: "module", source: stripTypeScriptTypes(source, { mode: "strip" }), shortCircuit: true };
    }
    if (url === workflowURL.href && mode !== "normal") {
      injectedWorkflowLoads++;
      const source = fs.readFileSync(workflowURL, "utf8");
      const call = mode === "negative-scan"
        ? 'await getDriveImportSource().scan("synthetic-folder-reference");'
        : 'await getDriveImportSource().search({ id: "synthetic-id", operationId: "synthetic-operation", companyName: "synthetic-company", courseName: "synthetic-course", startDate: "2026-09-30", endDate: "2026-09-30", om: "", ld: "", driveLink: "", lectureManagementLink: "" });';
      // The regression is in the imported module's top-level evaluation, not a
      // fixture helper invoked after imports or a fabricated scanner result.
      return { format: "module", source: stripTypeScriptTypes(`${source}\n${call}\n`, { mode: "strip" }), shortCircuit: true };
    }
    return next(url, context);
  }
});
const forbidden = (kind: string): never => { violations.push(kind); throw new Error("SYNTHETIC_IMPORT_IO_FORBIDDEN"); };
const isEnv = (value: unknown) => {
  const name = value instanceof URL ? basename(value.pathname) : typeof value === "string" ? basename(value) : "";
  return name === ".env" || name === ".env.local";
};
const exists = fs.existsSync, read = fs.readFileSync;
mock.method(fs, "existsSync", (...values: Parameters<typeof fs.existsSync>) => {
  if (isEnv(values[0])) return forbidden("env-exists");
  return exists(...values);
});
// Preserve overloaded fs return types; only forbidden env paths change behavior.
mock.method(fs, "readFileSync", ((...values: Parameters<typeof fs.readFileSync>) => {
  if (isEnv(values[0])) return forbidden("env-read");
  return read(...values);
}) as typeof fs.readFileSync);
mock.method(pg.Client.prototype, "connect", () => forbidden("pg-client"));
mock.method(pg.Pool.prototype, "connect", () => forbidden("pg-pool"));
mock.method(globalThis, "fetch", async () => forbidden("fetch"));
mock.method(process, "exit", () => forbidden("exit"));

try {
  const cliUrl = new URL("../../../scripts/run-drive-import-dry-run.mjs", import.meta.url);
  await import(cliUrl.href);
  await import("../driveImports/driveImportDryRun");
  const { getDriveImportWriterRepository } = await import("./driveImportWriterFactory");
  const { PrismaDriveImportWriterRepository } = await import("./prismaDriveImportWriterRepository");
  const { getDriveImportSource } = await import("./driveImportSource");
  const { scanOperationDriveFolder } = await import("../driveImports/googleDriveOperationScanner");
  const writer = getDriveImportWriterRepository();
  assert.ok(writer instanceof PrismaDriveImportWriterRepository);
  assert.equal(getDriveImportSource().scan, scanOperationDriveFolder);
  assert.equal(scannerLoads, 1);
  assert.equal(injectedWorkflowLoads, mode === "normal" ? 0 : 1);
  const assertImportQuiet = () => {
    assert.deepEqual(entries, { scan: 0, search: 0 }, "IMPORT_SOURCE_ENTRY_FORBIDDEN");
    assert.deepEqual(violations, []);
  };
  if (mode === "normal") assertImportQuiet();
  else {
    assert.deepEqual(entries, mode === "negative-scan" ? { scan: 1, search: 0 } : { scan: 0, search: 1 });
    // Real missing-config source calls returned without HTTP, yet the exact
    // same source0 assertion used by the positive import probe must reject.
    assert.throws(assertImportQuiet, { name: "AssertionError", message: /IMPORT_SOURCE_ENTRY_FORBIDDEN/ });
  }
  assert.deepEqual(violations, []);
  process.stdout.write(JSON.stringify({ imported: true, mode, defaultWriter: writer.constructor.name, defaultScanIdentity: true,
    entries, noHttpNegativeControl: mode !== "normal", violations }));
} finally { hook.deregister(); delete observation.__driveScopeSourceEntry; mock.restoreAll(); }
