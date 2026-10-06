import assert from "node:assert/strict";
import test from "node:test";
import { runOperationImportCli } from "./operationImportCliRuntime";
const env = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_operation_import", MONGODB_SHADOW_NAMESPACE: "shadow_operation_import" };
test("operation import Mongo selector is exact and closes its client", async () => {
  const calls: string[] = [], dependencies = { createClient() { return { async connect() { calls.push("connect"); }, async close() { calls.push("close"); } }; }, async openRuntime() { calls.push("open"); return { run: <T>(work: () => Promise<T>) => work() }; }, async runCommand(args: string[]) { assert.ok(!args.some(arg => arg.startsWith("--backend="))); calls.push("command"); return { options: { apply: false, file: "x" }, result: { operations: 0, inserted: 0, updated: 0, sourceRecordsInserted: 0, sourceRecordsSkipped: 0 } }; } };
  await runOperationImportCli(["--backend=mongodb-shadow"], env, () => {}, dependencies); assert.deepEqual(calls, ["connect", "open", "command", "close"]);
  await assert.rejects(runOperationImportCli(["--backend=postgres"], env, () => {}, dependencies), /OPERATION_IMPORT_FAILED/);
});
