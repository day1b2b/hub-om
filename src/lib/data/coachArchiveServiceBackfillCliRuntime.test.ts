import assert from "node:assert/strict";
import { test } from "node:test";
import { runCoachArchiveServiceBackfillCli } from "./coachArchiveServiceBackfillCliRuntime";

const summary = { coachRows: 1, changedCoaches: 1, accessLogRows: 1, updatedCoaches: 0, upsertedAccessLogs: 0 };
test("archive service CLI keeps PostgreSQL default", async () => {
  let loaded = 0;
  const result = await runCoachArchiveServiceBackfillCli([], {}, () => { loaded++; }, {
    createClient() { throw new Error("mongo must stay closed"); }, async openRuntime() { throw new Error("mongo must stay closed"); },
    async runCommand(args, load) { assert.deepEqual(args, []); load(); return { options: { apply: false }, summary }; },
  });
  assert.equal(loaded, 1); assert.deepEqual(result.summary, summary);
});

test("archive service CLI accepts only exact prepared Mongo selector and closes owned client", async () => {
  let connected = 0, closed = 0, opened = 0;
  const dependencies = {
    createClient() { return { async connect() { connected++; }, async close() { closed++; } }; },
    async openRuntime(input: { namespace: string }) { opened++; assert.equal(input.namespace, "shadow_fixture"); return { async run<T>(work: () => Promise<T>) { return work(); } }; },
    async runCommand(args: string[], load: () => void) { assert.deepEqual(args, ["--dry-run"]); assert.throws(load); return { options: { apply: false }, summary }; },
  };
  const env = { MONGODB_SHADOW_NAMESPACE: "shadow_fixture", MONGODB_SHADOW_DATABASE: "hub_om_shadow_fixture" };
  const result = await runCoachArchiveServiceBackfillCli(["--dry-run", "--backend=mongodb-shadow"], env, () => { throw new Error("default env"); }, dependencies);
  assert.deepEqual(result.summary, summary); assert.deepEqual([connected, opened, closed], [1, 1, 1]);
  for (const args of [["--backend=postgres"], ["--backend=mongodb-shadow", "--backend=mongodb-shadow"]]) {
    await assert.rejects(runCoachArchiveServiceBackfillCli(args, env, () => {}, dependencies));
  }
});
