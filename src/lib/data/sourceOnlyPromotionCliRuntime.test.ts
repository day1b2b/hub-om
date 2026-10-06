import assert from "node:assert/strict";
import test from "node:test";
import { runSourceOnlyPromotionCli } from "./sourceOnlyPromotionCliRuntime";

const env = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_source_only", MONGODB_SHADOW_NAMESPACE: "shadow_source_only" };
function fixture(fail?: "connect" | "open" | "command" | "close") {
  const counts = { connect: 0, open: 0, command: 0, close: 0 };
  return { counts, dependencies: {
    createClient() { return { async connect() { counts.connect++; if (fail === "connect") throw new Error("private canary"); }, async close() { counts.close++; if (fail === "close") throw new Error("private canary"); } }; },
    async openRuntime() { counts.open++; if (fail === "open") throw new Error("private canary"); return { run: <T>(callback: () => Promise<T>) => callback() }; },
    async runCommand(args: string[]) { counts.command++; if (fail === "command") throw new Error("private canary"); assert.ok(!args.some(arg => arg.startsWith("--backend="))); return { options: { apply: false, sourceTeam: "TEAM_1" as const }, result: { sourceRows: 1, promoted: 1, linkedExisting: 0, blocked: 0, blockedReasons: {} } }; }
  } };
}

test("source-only Mongo selector is exact, private and always closes", async () => {
  const f = fixture(); await runSourceOnlyPromotionCli(["--backend=mongodb-shadow"], env, () => { throw new Error("must not load PG"); }, f.dependencies);
  assert.deepEqual(f.counts, { connect: 1, open: 1, command: 1, close: 1 });
  for (const args of [["--backend=postgres"], ["--backend=mongodb-shadow", "--backend=mongodb-shadow"]]) await assert.rejects(runSourceOnlyPromotionCli(args, env, () => {}, f.dependencies), /SOURCE_ONLY_PROMOTION_FAILED/);
  for (const failure of ["connect", "open", "command", "close"] as const) {
    const broken = fixture(failure);
    const expected = failure === "close" ? "SOURCE_ONLY_PROMOTION_CLEANUP_FAILED" : "SOURCE_ONLY_PROMOTION_FAILED";
    await assert.rejects(runSourceOnlyPromotionCli(["--backend=mongodb-shadow"], env, () => {}, broken.dependencies), error => error instanceof Error && error.message === expected && !error.message.includes("canary"));
    assert.equal(broken.counts.close, 1);
  }
});
