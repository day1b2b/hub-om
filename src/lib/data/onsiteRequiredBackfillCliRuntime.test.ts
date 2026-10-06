import assert from "node:assert/strict";
import test from "node:test";
import { runOnsiteRequiredBackfillCli } from "./onsiteRequiredBackfillCliRuntime";

function dependencies(options: { openError?: Error; commandError?: Error; closeError?: Error } = {}) {
  let opens = 0, commands = 0, closes = 0; let receivedArgs: string[] = [];
  return {
    value: {
      createClient: () => ({ connect: async () => {}, close: async () => { closes++; if (options.closeError) throw options.closeError; } }),
      openRuntime: async () => { opens++; if (options.openError) throw options.openError; return { run: async <T>(callback: () => Promise<T>) => callback() }; },
      runCommand: async (args: string[]) => { commands++; receivedArgs = args; if (options.commandError) throw options.commandError; return { apply: args.includes("--apply"), targetCount: 2, updatedCount: args.includes("--apply") ? 2 : 0 }; },
    },
    counts: () => ({ opens, commands, closes }), args: () => receivedArgs,
  };
}
const env = { MONGODB_SHADOW_DATABASE: "hub_om_shadow_onsite_cli", MONGODB_SHADOW_NAMESPACE: "shadow_onsite_cli" };

test("onsite backfill CLI requires one explicit Mongo selector and strips only that selector", async () => {
  let loaded = 0;
  for (const args of [["--backend=postgres"], ["--backend=mongodb-shadow", "--backend=mongodb-shadow"]]) {
    await assert.rejects(runOnsiteRequiredBackfillCli(args, env, () => { loaded++; }), /^Error: ONSITE_REQUIRED_BACKFILL_FAILED$/);
  }
  const fixture = dependencies();
  assert.deepEqual(await runOnsiteRequiredBackfillCli(["--apply", "ignored", "--backend=mongodb-shadow"], env, () => { loaded++; }, fixture.value), { apply: true, targetCount: 2, updatedCount: 2 });
  assert.deepEqual(fixture.args(), ["--apply", "ignored"]); assert.deepEqual(fixture.counts(), { opens: 1, commands: 1, closes: 1 }); assert.equal(loaded, 0);
});

test("onsite backfill CLI closes once and redacts open, command, and close failures", async () => {
  for (const option of [{ openError: new Error("open canary") }, { commandError: new Error("command canary") }, { closeError: new Error("close canary") }]) {
    const fixture = dependencies(option);
    await assert.rejects(runOnsiteRequiredBackfillCli(["--backend=mongodb-shadow"], env, () => {}, fixture.value), error => error instanceof Error && error.message === "ONSITE_REQUIRED_BACKFILL_FAILED" && !error.message.includes("canary"));
    const counts = fixture.counts(); assert.equal(counts.opens, 1); assert.equal(counts.commands, option.openError ? 0 : 1); assert.equal(counts.closes, 1);
  }
});
