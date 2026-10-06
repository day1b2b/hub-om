import assert from "node:assert/strict";
import test from "node:test";
import { runCoachDataVerificationCli } from "./coachDataVerificationCliRuntime";
const empty = { serviceCounts: [], latestImport: null, latestArchive: null, archiveCounts: [] };
test("coach data verification CLI keeps PostgreSQL default and exact Mongo selection", async () => {
  let connected = 0, closed = 0, opened = 0, ran = 0;
  const dependencies = { createClient: () => ({ connect: async () => { connected++; }, close: async () => { closed++; } }),
    openRuntime: async () => { opened++; return { run: async <T>(work: () => Promise<T>) => work() }; },
    runCommand: async (args: string[], load: () => void) => { ran++; if (opened === 0) load(); assert.deepEqual(args, []); return empty; } };
  assert.equal(await runCoachDataVerificationCli([], {}, () => {}, dependencies), empty); assert.deepEqual([connected, opened, closed, ran], [0, 0, 0, 1]);
  const mongoEnv = { MONGODB_SHADOW_NAMESPACE: "shadow_verify", MONGODB_SHADOW_DATABASE: "hub_om_shadow_verify" };
  assert.equal(await runCoachDataVerificationCli(["--backend=mongodb-shadow"], mongoEnv, () => {}, dependencies), empty);
  assert.deepEqual([connected, opened, closed, ran], [1, 1, 1, 2]);
  for (const args of [["--backend=postgres"], ["--backend=mongodb-shadow", "--backend=mongodb-shadow"], ["--backend=mongodb-shadow", "extra"]])
    await assert.rejects(runCoachDataVerificationCli(args, mongoEnv, () => {}, dependencies));
  await assert.rejects(runCoachDataVerificationCli(["--backend=mongodb-shadow"], { ...mongoEnv, MONGODB_SHADOW_NAMESPACE: "bad" }, () => {}, dependencies));
  for (const failure of ["connect", "open", "command", "close"] as const) {
    let failureClosed = 0;
    const failing = {
      createClient: () => ({ connect: async () => { if (failure === "connect") throw new Error("private connect canary"); },
        close: async () => { failureClosed++; if (failure === "close") throw new Error("private close canary"); } }),
      openRuntime: async () => { if (failure === "open") throw new Error("private open canary"); return { run: async <T>(work: () => Promise<T>) => work() }; },
      runCommand: async () => { if (failure === "command") throw new Error("private command canary"); return empty; },
    };
    await assert.rejects(runCoachDataVerificationCli(["--backend=mongodb-shadow"], mongoEnv, () => {}, failing), error => {
      assert.equal(String(error), "Error: COACH_DATA_VERIFICATION_FAILED"); assert.doesNotMatch(String(error), /canary/); return true;
    });
    assert.equal(failureClosed, 1);
  }
});
