import assert from "node:assert/strict";
import test from "node:test";
import { runInstructorNoteImportCli } from "./instructorNoteImportCliRuntime";
const env = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_notes", MONGODB_SHADOW_NAMESPACE: "shadow_notes" };
function fixture(fail?: "connect" | "open" | "command" | "close") {
  const counts = { connect: 0, open: 0, command: 0, close: 0 };
  return { counts, dependencies: {
    createClient() { return { async connect() { counts.connect++; if (fail === "connect") throw new Error("canary"); }, async close() { counts.close++; if (fail === "close") throw new Error("canary"); } }; },
    async openRuntime() { counts.open++; if (fail === "open") throw new Error("canary"); return { run: <T>(callback: () => Promise<T>) => callback() }; },
    async runCommand(args: string[]) { counts.command++; if (fail === "command") throw new Error("canary"); assert.ok(!args.some(arg => arg.startsWith("--backend="))); return { options: { apply: false }, result: { total: 1, inserted: 1, updated: 0 } }; },
  } };
}
test("instructor note Mongo selector is exact and always closes", async () => {
  const f = fixture(); let loaded = 0; await runInstructorNoteImportCli(["--backend=mongodb-shadow"], env, () => { loaded++; }, f.dependencies);
  assert.deepEqual(f.counts, { connect: 1, open: 1, command: 1, close: 1 }); assert.equal(loaded, 0);
  for (const args of [["--backend=postgres"], ["--backend=mongodb-shadow", "--backend=mongodb-shadow"]]) await assert.rejects(runInstructorNoteImportCli(args, env, () => {}, f.dependencies), /INSTRUCTOR_NOTE_IMPORT_FAILED/);
  for (const failure of ["connect", "open", "command", "close"] as const) { const broken = fixture(failure); await assert.rejects(runInstructorNoteImportCli(["--backend=mongodb-shadow"], env, () => {}, broken.dependencies), error => error instanceof Error && error.message === "INSTRUCTOR_NOTE_IMPORT_FAILED" && !error.message.includes("canary")); assert.equal(broken.counts.close, 1); }
});
