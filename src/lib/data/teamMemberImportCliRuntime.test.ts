import assert from "node:assert/strict";
import test from "node:test";
import { runTeamMemberImportCli } from "./teamMemberImportCliRuntime";
const env = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_members", MONGODB_SHADOW_NAMESPACE: "shadow_members" };
function fixture(fail?: "connect" | "open" | "command" | "close") {
  const counts = { connect: 0, open: 0, command: 0, close: 0 };
  return { counts, dependencies: {
    createClient() { return { async connect() { counts.connect++; if (fail === "connect") throw new Error("private canary"); }, async close() { counts.close++; if (fail === "close") throw new Error("private canary"); } }; },
    async openRuntime() { counts.open++; if (fail === "open") throw new Error("private canary"); return { run: <T>(callback: () => Promise<T>) => callback() }; },
    async runCommand(args: string[]) { counts.command++; if (fail === "command") throw new Error("private canary"); assert.ok(!args.some(arg => arg.startsWith("--backend="))); return { options: { apply: false }, result: { total: 1, inserted: 1, updated: 0, deactivated: 0 } }; }
  } };
}
test("team-member Mongo selector is exact, private and always closes", async () => {
  const f = fixture(); await runTeamMemberImportCli(["--backend=mongodb-shadow"], env, () => { throw new Error("must not load PG"); }, f.dependencies); assert.deepEqual(f.counts, { connect: 1, open: 1, command: 1, close: 1 });
  for (const args of [["--backend=postgres"], ["--backend=mongodb-shadow", "--backend=mongodb-shadow"]]) await assert.rejects(runTeamMemberImportCli(args, env, () => {}, f.dependencies), /TEAM_MEMBER_IMPORT_FAILED/);
  for (const failure of ["connect", "open", "command", "close"] as const) { const broken = fixture(failure); await assert.rejects(runTeamMemberImportCli(["--backend=mongodb-shadow"], env, () => {}, broken.dependencies), error => error instanceof Error && error.message === "TEAM_MEMBER_IMPORT_FAILED" && !error.message.includes("canary")); assert.equal(broken.counts.close, 1); }
});
