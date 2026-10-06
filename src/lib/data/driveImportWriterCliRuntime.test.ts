import assert from "node:assert/strict";
import test from "node:test";
import type { DriveImportSource } from "./driveImportSource";
import { runDriveImportWriterCli, type DriveImportWriterCliDependencies } from "./driveImportWriterCliRuntime";

const result = { runId: "synthetic-run", status: "completed" as const, summary: { avgSatisfactionCandidates: 0, errors: 0, folderSearches: 0, folderSearchWithCandidates: 0, instructorCandidates: 0, instructorSatisfactionCandidates: 0, scanFoundFolder: 0, scanIssues: 0, scannedRefs: 0, suspicious: { badInstructorFragments: 0, clockInstructorCandidates: 0, zeroSatisfactionCandidates: 0 }, suspiciousCandidateCount: 0 } };
function fixture(failure?: "connect" | "open" | "workflow" | "close") {
  const seen: string[] = [];
  const source: DriveImportSource = { async scan() { throw new Error("unused"); }, async search() { throw new Error("unused"); } };
  const dependencies: DriveImportWriterCliDependencies = {
    source,
    createClient() { return { async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private canary"); }, async close() { seen.push("close"); if (failure === "close") throw new Error("private canary"); } }; },
    async openRuntime(input) { seen.push(`open:${input.databaseName}:${input.namespace}:${input.driveImportSource === source}`); if (failure === "open") throw new Error("private canary"); return { async run<T>(work: () => Promise<T>) { return work(); } }; },
    parseArgs(args, concurrency) { seen.push(`parse:${args.join(",")}:${concurrency ?? ""}`); return { concurrency: 2, limit: 3, mode: "dry_run" }; },
    async runWorkflow(args, progress) { seen.push(`workflow:${args.concurrency}:${args.limit}`); progress?.("progress"); if (failure === "workflow") throw new Error("private canary"); return result; },
    getDefaultWriter() { return { async loadOperations() { return []; }, async createRun() { return ""; }, async appendResult() {}, async finishRun() {}, async close() { seen.push("default-close"); } }; },
  };
  return { seen, dependencies };
}

test("Drive CLI keeps PostgreSQL default and legacy env ordering", async () => {
  const f = fixture(); const output: string[] = [];
  const actual = await runDriveImportWriterCli(["--limit", "3"], {}, () => { f.seen.push("env"); }, line => output.push(line), f.dependencies);
  assert.equal(actual, result); assert.deepEqual(output, ["progress"]);
  assert.deepEqual(f.seen, ["env", "parse:--limit,3:", "workflow:2:3", "default-close"]);
});

test("Drive CLI exact Mongo selector opens one scope and strips only selector", async () => {
  const f = fixture(); const env = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_drive", MONGODB_SHADOW_NAMESPACE: "shadow_drive", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: Buffer.alloc(32, 1).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: Buffer.alloc(32, 2).toString("base64") };
  assert.equal(await runDriveImportWriterCli(["--limit", "3", "--backend=mongodb-shadow"], env, () => { throw new Error("PG env"); }, undefined, f.dependencies), result);
  assert.deepEqual(f.seen, ["parse:--limit,3:", "connect", "open:hub_om_shadow_drive:shadow_drive:true", "workflow:2:3", "close"]);
  for (const args of [["--backend=postgres"], ["--backend=mongodb-shadow", "--backend=mongodb-shadow"]]) await assert.rejects(runDriveImportWriterCli(args, env, () => {}, undefined, f.dependencies), /^Error: DRIVE_IMPORT_WRITER_FAILED$/);
});

test("Drive CLI fails before client on invalid config and redacts runtime failures", async () => {
  for (const environment of [{ DRIVE_IMPORT_WRITER_BACKEND: "mongodb-shadow" }, { MONGODB_SHADOW_NAMESPACE: "bad" }]) {
    const f = fixture(); await assert.rejects(runDriveImportWriterCli(["--backend=mongodb-shadow"], environment, () => {}, undefined, f.dependencies), /^Error: DRIVE_IMPORT_WRITER_FAILED$/); assert.deepEqual(f.seen, ["parse::"]);
  }
  const env = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_drive", MONGODB_SHADOW_NAMESPACE: "shadow_drive", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: Buffer.alloc(32, 1).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: Buffer.alloc(32, 2).toString("base64") };
  for (const failure of ["connect", "open", "workflow", "close"] as const) { const f = fixture(failure); await assert.rejects(runDriveImportWriterCli(["--backend=mongodb-shadow"], env, () => {}, undefined, f.dependencies), error => error instanceof Error && error.message === "DRIVE_IMPORT_WRITER_FAILED" && !error.message.includes("canary")); assert.equal(f.seen.at(-1), "close"); }
});
