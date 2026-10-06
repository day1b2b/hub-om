import assert from "node:assert/strict";
import test from "node:test";
import { runSatisfactionDryRunCli } from "./satisfactionDryRunCliRuntime";

const env = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_satisfaction", MONGODB_SHADOW_NAMESPACE: "shadow_satisfaction" };
test("satisfaction dry-run Mongo selector is exact, scoped and closes its client", async () => {
  const calls: string[] = [];
  const dependencies = {
    createClient() { return { async connect() { calls.push("connect"); }, async close() { calls.push("close"); } }; },
    async openRuntime() { calls.push("open"); return { run: <T>(work: () => Promise<T>) => work() }; },
    async runCommand(args: string[]) { assert.deepEqual(args, ["--csv=synthetic.csv"]); calls.push("command"); return { candidates: 0, limit: 200, results: [], stats: { total: 0, matched: 0, ambiguous: 0, unmatched: 0 } }; }
  };
  await runSatisfactionDryRunCli(["--csv=synthetic.csv", "--backend=mongodb-shadow"], env, () => { calls.push("env"); }, dependencies);
  assert.deepEqual(calls, ["env", "connect", "open", "command", "close"]);
  await assert.rejects(runSatisfactionDryRunCli(["--csv=x", "--backend=postgres"], env, () => {}, dependencies), /SATISFACTION_DRY_RUN_FAILED/);
});
