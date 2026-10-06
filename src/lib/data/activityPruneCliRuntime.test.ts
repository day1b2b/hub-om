import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runActivityPruneCli } from "./activityPruneCliRuntime";

test("activity prune CLI keeps PostgreSQL default and requires an exact explicit Mongo selector", () => {
  const source = readFileSync(new URL("./activityPruneCliRuntime.ts", import.meta.url), "utf8");
  const entry = readFileSync(new URL("../../../scripts/prune-activity.ts", import.meta.url), "utf8");
  assert.match(source, /args\.length === 1 && args\[0\] === "--backend=mongodb-shadow"/);
  assert.match(source, /startsWith\("--backend="\)/);
  assert.match(source, /Preserve the legacy command's ignored arguments/);
  assert.match(source, /MONGODB_SHADOW_NAMESPACE/);
  assert.match(source, /openMongoOperationalRuntime/);
  assert.match(source, /client\.close/);
  assert.doesNotMatch(source, /prepareMongoOperationalRuntime/);
  assert.match(entry, /process\.argv\.slice\(2\)/);
});

test("activity prune CLI rejects malformed backend selectors before loading default environment", async () => {
  let loaded = 0;
  await assert.rejects(runActivityPruneCli(["--backend=postgres"], {}, () => { loaded++; }), /^Error: ACTIVITY_PRUNE_FAILED$/);
  await assert.rejects(runActivityPruneCli(["--backend=mongodb-shadow", "extra"], {}, () => { loaded++; }), /^Error: ACTIVITY_PRUNE_FAILED$/);
  assert.equal(loaded, 0);
});

function dependencies(options: { openError?: Error; pruneError?: Error; closeError?: Error } = {}) {
  let closes = 0, opens = 0, commands = 0;
  return {
    value: {
      createClient: () => ({
        connect: async () => {},
        close: async () => { closes++; if (options.closeError) throw options.closeError; },
      }),
      openRuntime: async () => {
        opens++;
        if (options.openError) throw options.openError;
        return { run: async <T>(callback: () => Promise<T>) => callback() };
      },
      runCommand: async () => {
        commands++;
        if (options.pruneError) throw options.pruneError;
        return { deletedRequests: 1, deletedChanges: 2 };
      },
    },
    closeCount: () => closes,
    openCount: () => opens,
    commandCount: () => commands,
  };
}

test("activity prune CLI turns an owned-client close failure into the generic failure", async () => {
  const fixture = dependencies({ closeError: new Error("close canary secret") });
  await assert.rejects(
    runActivityPruneCli(["--backend=mongodb-shadow"], { MONGODB_SHADOW_DATABASE: "hub_om_shadow_close", MONGODB_SHADOW_NAMESPACE: "shadow_close" }, () => {}, () => {}, fixture.value),
    error => error instanceof Error && error.message === "ACTIVITY_PRUNE_FAILED" && !error.message.includes("canary"),
  );
  assert.equal(fixture.openCount(), 1);
  assert.equal(fixture.commandCount(), 1);
  assert.equal(fixture.closeCount(), 1);
});

test("activity prune CLI closes exactly once and hides open and prune errors", async () => {
  for (const option of [
    { openError: new Error("open canary secret") },
    { pruneError: new Error("prune canary secret") },
  ]) {
    const fixture = dependencies(option);
    await assert.rejects(
      runActivityPruneCli(["--backend=mongodb-shadow"], { MONGODB_SHADOW_DATABASE: "hub_om_shadow_failure", MONGODB_SHADOW_NAMESPACE: "shadow_failure" }, () => {}, () => {}, fixture.value),
      error => error instanceof Error && error.message === "ACTIVITY_PRUNE_FAILED" && !error.message.includes("canary"),
    );
    assert.equal(fixture.openCount(), 1);
    assert.equal(fixture.commandCount(), option.openError ? 0 : 1);
    assert.equal(fixture.closeCount(), 1);
  }
});
