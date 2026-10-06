import assert from "node:assert/strict";
import test from "node:test";
import { runDuplicateCompanyMergeCli } from "./duplicateCompanyMergeCliRuntime";

const env = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_merge", MONGODB_SHADOW_NAMESPACE: "shadow_merge" };
function fixture(fail?: "connect" | "open" | "command" | "close") {
  const counts = { connect: 0, open: 0, command: 0, close: 0 };
  const dependencies = {
    createClient() { return { async connect() { counts.connect++; if (fail === "connect") throw new Error("canary"); }, async close() { counts.close++; if (fail === "close") throw new Error("canary"); } }; },
    async openRuntime() { counts.open++; if (fail === "open") throw new Error("canary"); return { run: <T>(callback: () => Promise<T>) => callback() }; },
    async runCommand(args: string[]) { counts.command++; if (fail === "command") throw new Error("canary"); assert.ok(!args.some(arg => arg.startsWith("--backend="))); return { options: { sourceName: "Typo", targetName: "Correct", apply: false }, result: { sourceId: "s", targetId: "t", courses: [], labels: [], remainingCourses: 0, reassignedCourses: 0, mergedCourses: 0, updatedSessions: 0, reassignedLabels: 0, discardedLabels: 0 } }; },
  };
  return { counts, dependencies };
}
test("Mongo selector is exact, scoped, and always closes", async () => {
  const f = fixture(); let loaded = 0;
  await runDuplicateCompanyMergeCli(["--source=Typo", "--target=Correct", "--backend=mongodb-shadow"], env, () => { loaded++; }, f.dependencies);
  assert.deepEqual(f.counts, { connect: 1, open: 1, command: 1, close: 1 }); assert.equal(loaded, 0);
  for (const args of [["--backend=postgres"], ["--backend=mongodb-shadow", "--backend=mongodb-shadow"]]) await assert.rejects(runDuplicateCompanyMergeCli(args, env, () => {}, f.dependencies), /DUPLICATE_COMPANY_MERGE_FAILED/);
  for (const failure of ["connect", "open", "command", "close"] as const) {
    const broken = fixture(failure); await assert.rejects(runDuplicateCompanyMergeCli(["--source=Typo", "--target=Correct", "--backend=mongodb-shadow"], env, () => {}, broken.dependencies), error => error instanceof Error && error.message === "DUPLICATE_COMPANY_MERGE_FAILED" && !error.message.includes("canary"));
    assert.equal(broken.counts.close, 1);
  }
});
