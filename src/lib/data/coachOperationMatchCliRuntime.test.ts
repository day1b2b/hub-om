import assert from "node:assert/strict";
import test from "node:test";
import { runCoachOperationMatchCli } from "./coachOperationMatchCliRuntime";

const env = { MONGODB_SHADOW_NAMESPACE: "shadow_match", MONGODB_SHADOW_DATABASE: "hub_om_shadow_match" };
function fixture(fail?: "connect" | "open" | "command" | "close") {
  const calls = { connect: 0, open: 0, command: 0, close: 0 };
  return { calls, dependencies: {
    createClient() { return { async connect() { calls.connect++; if (fail === "connect") throw new Error("private-canary"); }, async close() { calls.close++; if (fail === "close") throw new Error("private-canary"); } }; },
    async openRuntime() { calls.open++; if (fail === "open") throw new Error("private-canary"); return { async run<T>(work: () => Promise<T>) { return work(); } }; }
  }, command: async () => { calls.command++; if (fail === "command") throw new Error("private-canary"); return 7; } };
}

test("coach operation CLI selects Mongo explicitly and closes its client", async () => {
  const f = fixture(); let loaded = 0;
  assert.equal(await runCoachOperationMatchCli(["--apply", "--backend=mongodb-shadow"], env, f.command, () => { loaded++; }, f.dependencies), 7);
  assert.deepEqual(f.calls, { connect: 1, open: 1, command: 1, close: 1 }); assert.equal(loaded, 0);
  for (const args of [["--backend=postgres"], ["--backend=mongodb-shadow", "--backend=mongodb-shadow"]])
    await assert.rejects(runCoachOperationMatchCli(args, env, f.command, () => {}, f.dependencies), /^Error: COACH_OPERATION_MATCH_FAILED$/);
});

test("coach operation CLI redacts lifecycle failures", async () => {
  for (const kind of ["connect", "open", "command", "close"] as const) {
    const f = fixture(kind);
    await assert.rejects(runCoachOperationMatchCli(["--backend=mongodb-shadow"], env, f.command, () => {}, f.dependencies), error => error instanceof Error && error.message === "COACH_OPERATION_MATCH_FAILED" && !error.message.includes("canary"));
    assert.equal(f.calls.close, 1);
  }
});
