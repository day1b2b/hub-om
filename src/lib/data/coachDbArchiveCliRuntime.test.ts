import assert from "node:assert/strict";
import test from "node:test";
import { runCoachDbArchiveCli } from "./coachDbArchiveCliRuntime";
const summary = { tableCount: 0, rowCount: 0, tables: [] };
function dependencies(fail?: "connect" | "open" | "command" | "close") { const seen: string[] = []; return { seen, value: {
  createClient() { return { async connect() { seen.push("connect"); if (fail === "connect") throw new Error("canary"); }, async close() { seen.push("close"); if (fail === "close") throw new Error("canary"); } }; },
  async openRuntime() { seen.push("open"); if (fail === "open") throw new Error("canary"); return { async run<T>(work: () => Promise<T>) { return work(); } }; },
  async runCommand(args: string[]) { seen.push("command"); assert.deepEqual(args, ["--dry-run"]); if (fail === "command") throw new Error("canary"); return { options: { apply: false }, summary }; },
} }; }
test("coach db archive Mongo selector is exact and always closes", async () => {
  const env = { MONGODB_SHADOW_NAMESPACE: "shadow_archive", MONGODB_SHADOW_DATABASE: "hub_om_shadow_synthetic", COACH_DB_DATABASE_URL: "synthetic" };
  const ok = dependencies(); assert.deepEqual(await runCoachDbArchiveCli(["--backend=mongodb-shadow", "--dry-run"], env, () => {}, ok.value), { options: { apply: false }, summary }); assert.deepEqual(ok.seen, ["connect", "open", "command", "close"]);
  for (const failure of ["connect", "open", "command", "close"] as const) { const item = dependencies(failure); await assert.rejects(() => runCoachDbArchiveCli(["--backend=mongodb-shadow", "--dry-run"], env, () => {}, item.value), /COACH_DB_ARCHIVE_FAILED/); assert.ok(item.seen.includes("close")); }
  await assert.rejects(() => runCoachDbArchiveCli(["--backend=bad"], env, () => {}), /COACH_DB_ARCHIVE_FAILED/);
});
