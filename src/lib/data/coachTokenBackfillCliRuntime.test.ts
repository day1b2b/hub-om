import assert from "node:assert/strict";
import test from "node:test";
import { runCoachTokenBackfillCli, type CoachTokenBackfillCliDependencies } from "./coachTokenBackfillCliRuntime";

const summary = { archivedTokens: 1, missingTokens: 1, changedTokens: 1, updatedTokens: 0 };
function fixture(failure?: "connect" | "open" | "command" | "close") {
  const seen: string[] = [];
  const dependencies: CoachTokenBackfillCliDependencies = {
    createClient() { return { async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private canary"); }, async close() { seen.push("close"); if (failure === "close") throw new Error("private canary"); } }; },
    async openRuntime(input) { seen.push(`open:${input.databaseName}:${input.namespace}`); if (failure === "open") throw new Error("private canary"); return { async run<T>(work: () => Promise<T>) { return work(); } }; },
    async runCommand(args, load) { seen.push(`command:${args.join(",")}`); assert.throws(load); if (failure === "command") throw new Error("private canary"); return { options: { apply: args.includes("--apply") }, summary }; },
  };
  return { seen, dependencies };
}

test("coach token backfill CLI keeps PostgreSQL default", async () => {
  const f = fixture(); let loaded = 0;
  const result = await runCoachTokenBackfillCli(["--dry-run"], {}, () => { loaded++; }, { ...f.dependencies, async runCommand(args, load) { load(); assert.deepEqual(args, ["--dry-run"]); return { options: { apply: false }, summary }; } });
  assert.equal(loaded, 1); assert.deepEqual(result.summary, summary); assert.deepEqual(f.seen, []);
});

test("coach token backfill CLI accepts one exact Mongo selector and closes", async () => {
  const env = { MONGODB_SHADOW_DATABASE: "hub_om_shadow_tokens", MONGODB_SHADOW_NAMESPACE: "shadow_tokens" };
  const f = fixture();
  const result = await runCoachTokenBackfillCli(["--apply", "--backup-confirmed", "--maintenance-confirmed", "--backend=mongodb-shadow"], env, () => { throw new Error("PG env must not load"); }, f.dependencies);
  assert.equal(result.options.apply, true);
  assert.deepEqual(f.seen, ["connect", "open:hub_om_shadow_tokens:shadow_tokens", "command:--apply,--backup-confirmed,--maintenance-confirmed", "close"]);
  for (const args of [["--backend=postgres"], ["--backend=mongodb-shadow", "--backend=mongodb-shadow"]]) await assert.rejects(runCoachTokenBackfillCli(args, env, () => {}, f.dependencies), /^Error: COACH_TOKEN_BACKFILL_FAILED$/);
});

test("coach token backfill CLI redacts failures and closes its client", async () => {
  const env = { MONGODB_SHADOW_DATABASE: "hub_om_shadow_tokens", MONGODB_SHADOW_NAMESPACE: "shadow_tokens" };
  for (const failure of ["connect", "open", "command", "close"] as const) {
    const f = fixture(failure);
    await assert.rejects(runCoachTokenBackfillCli(["--dry-run", "--backend=mongodb-shadow"], env, () => {}, f.dependencies), error => error instanceof Error && error.message === "COACH_TOKEN_BACKFILL_FAILED" && !error.message.includes("canary"));
    assert.equal(f.seen.at(-1), "close");
  }
  const missing = fixture();
  await assert.rejects(runCoachTokenBackfillCli(["--backend=mongodb-shadow"], {}, () => {}, missing.dependencies), /^Error: COACH_TOKEN_BACKFILL_FAILED$/);
  assert.deepEqual(missing.seen, []);
});
