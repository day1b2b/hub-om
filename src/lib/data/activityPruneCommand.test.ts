/** Real command/context/factory/default PG guard plus actual script subprocess.
 * All repository IO is synthetic. No native deletions, rollback, server clock,
 * driver retry, forced-timeout cleanup or full CLI deployment claim is made.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { mock, test } from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { ActivityPruneBatch, ActivityPruneRepository } from "./activityPruneRepository";

const FAILED = "ACTIVITY_PRUNE_FAILED", PRIVATE = "synthetic-prune-private@example.invalid";
const RAW = "mongodb://synthetic:private-key@127.0.0.1:1/private-prune";
const root = new URL("../../../", import.meta.url);
type Summary = { deletedRequests: number; deletedChanges: number };
const same = (actual: unknown, expected: unknown, code: string) => assert.ok(isDeepStrictEqual(actual, expected), code);
function fixed(error: unknown): boolean {
  assert.ok(error instanceof Error, "PRUNE_ERROR_CLASS");
  same({ message: error.message, cause: error.cause, keys: Object.keys(error) }, { message: FAILED, cause: undefined, keys: [] }, "PRUNE_UNSAFE_ERROR");
  return true;
}
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
const envNames = ["NODE_ENV", "DATABASE_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];

test("activity prune command: actual scope, drain, output and close with synthetic ports", { timeout: 30_000 }, async suite => {
  const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const globals = globalThis as typeof globalThis & { prisma?: unknown }, previous = globals.prisma;
  const logs: unknown[][] = [], unexpected: string[] = [], pg: unknown[] = [];
  let loaded = 0, pgCloses = 0;
  const forbidden = (kind: string): never => { unexpected.push(kind); throw new Error(PRIVATE, { cause: RAW }); };
  const load = () => { loaded++; };
  const clean = () => { same(logs, [], "PRUNE_OUTPUT_LEAK"); same(unexpected, [], "PRUNE_FORBIDDEN_IO"); };
  const captures = (["log", "info", "warn", "error", "debug"] as const).map(name => mock.method(console, name, (...args: unknown[]) => { logs.push(args); }));
  const fetchTrap = mock.method(globalThis, "fetch", async () => forbidden("fetch"));
  const adapter = mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { forbidden("pg-construction"); } } } });
  Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/prune_forbidden",
    PII_ENCRYPTION_KEYS: JSON.stringify({ prune: Buffer.alloc(32, 51).toString("base64") }), PII_ACTIVE_KEY_ID: "prune",
    PII_INDEX_KEY: Buffer.alloc(32, 85).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  globals.prisma = new Proxy({}, { get(_target, key) {
    if (key === "$transaction") return async (callback: unknown, options: unknown) => { pg.push({ callback, options }); return { requests: 0, changes: 0 }; };
    if (key === "$disconnect") return async () => { pgCloses++; };
    return forbidden("unexpected-prisma-member");
  } });
  function port(batches: ActivityPruneBatch[]) {
    const events: unknown[] = []; let index = 0;
    const repository: ActivityPruneRepository = {
      async pruneBatch() { events.push("batch"); if (!batches[index]) return forbidden("extra-batch"); return batches[index++]; },
      async close() { events.push("close"); }
    };
    return { repository, events };
  }
  try {
    const { runActivityPruneCommand } = await import("./activityPruneCommand");
    const { getActivityPruneRepository } = await import("./activityPruneFactory");
    const { pruneActivityBatch } = await import("../activity/retention");
    await suite.test("import is lazy and default PG selection ignores Mongo env; real PG batch callback and timeout delegate once", async () => {
      same(pg, [], "PRUNE_IMPORT_IO"); assert.equal(loaded, 0); assert.equal(pgCloses, 0); clean();
      for (const uri of [undefined, "mongodb://127.0.0.1:1/synthetic", "malformed-synthetic-uri"]) {
        if (uri === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = uri;
        const before = pg.length, closeBefore: number = pgCloses, loadBefore: number = loaded;
        const repository = getActivityPruneRepository(); assert.equal(pg.length, before);
        await repository.close(); assert.equal(pgCloses, closeBefore, "UNINITIALIZED_REPOSITORY_MUST_NOT_CLOSE_CLIENT");
        same(await runActivityPruneCommand(load), { deletedRequests: 0, deletedChanges: 0 }, "PRUNE_DEFAULT_SUMMARY");
        assert.equal(loaded, loadBefore + 1); assert.equal(pgCloses, closeBefore + 1);
        same(pg.slice(before), [{ callback: pruneActivityBatch, options: { timeout: 10000 } }], "PRUNE_PG_BATCH_CONTRACT"); clean();
      }
    });
    await suite.test("either exact1000 continues; totals include successful batches once and summary precedes exactly one close", async () => {
      const owned = port([{ requests: 1000, changes: 1 }, { requests: 0, changes: 1000 }, { requests: 4, changes: 2 }]);
      const before = loaded, pgBefore = pg.length, closeBefore = pgCloses;
      const result = await runWithDataRepositories({ activityPrune: owned.repository }, () => runActivityPruneCommand(load, summary => owned.events.push({ summary })));
      same(result, { deletedRequests: 1004, deletedChanges: 1003 }, "PRUNE_TOTAL");
      same(owned.events, ["batch", "batch", "batch", { summary: { deletedRequests: 1004, deletedChanges: 1003 } }, "close"], "PRUNE_DRAIN_ORDER");
      assert.equal(loaded, before); assert.equal(pg.length, pgBefore); assert.equal(pgCloses, closeBefore); clean();
    });
    await suite.test("empty and below1000 stop after one batch; optional writer is genuinely optional", async () => {
      for (const counts of [{ requests: 0, changes: 0 }, { requests: 999, changes: 999 }, { requests: 1, changes: 0 }]) {
        const owned = port([counts]);
        same(await runWithDataRepositories({ activityPrune: owned.repository }, () => runActivityPruneCommand(load)),
          { deletedRequests: counts.requests, deletedChanges: counts.changes }, "PRUNE_SMALL_SUMMARY");
        same(owned.events, ["batch", "close"], "PRUNE_SMALL_CALLS");
      }
      clean();
    });
    await suite.test("later batch failure emits no summary and closes once; preceding synthetic successes are not retried", async () => {
      let batches = 0, closed = 0; const output: Summary[] = [];
      const repository: ActivityPruneRepository = { async pruneBatch() { if (++batches === 1) return { requests: 1000, changes: 8 }; throw new Error(PRIVATE, { cause: RAW }); }, async close() { closed++; } };
      await runWithDataRepositories({ activityPrune: repository }, async () => { await assert.rejects(runActivityPruneCommand(load, value => output.push(value)), fixed); });
      assert.equal(batches, 2); assert.equal(closed, 1); same(output, [], "PRUNE_PARTIAL_SUCCESS_OUTPUT"); clean();
    });
    await suite.test("Error/nonError/cause failures across environments are fixed, including simultaneous close failure", async () => {
      let touched = 0;
      const hostile = { get message() { touched++; return PRIVATE; }, get cause() { touched++; return RAW; }, toString() { touched++; return PRIVATE; } };
      for (const env of ["test", "development", "production"]) for (const value of [new Error(PRIVATE, { cause: RAW }), PRIVATE, null, undefined, hostile]) {
        Object.assign(process.env, { NODE_ENV: env }); let closed = 0, writes = 0;
        await runWithDataRepositories({ activityPrune: { async pruneBatch() { throw value; }, async close() { closed++; throw new Error(RAW); } } }, async () => {
          await assert.rejects(runActivityPruneCommand(load, () => { writes++; }), fixed);
        });
        assert.equal(closed, 1); assert.equal(writes, 0); clean();
      }
      assert.equal(touched, 0);
    });
    await suite.test("close failure rejects after already emitted success; throwing summary writer still closes", async () => {
      for (const failWriter of [false, true]) {
        const events: unknown[] = [];
        await runWithDataRepositories({ activityPrune: { async pruneBatch() { events.push("batch"); return { requests: 3, changes: 4 }; },
          async close() { events.push("close"); if (!failWriter) throw new Error(RAW); } } }, async () => {
          await assert.rejects(runActivityPruneCommand(load, summary => { events.push(summary); if (failWriter) throw PRIVATE; }), fixed);
        });
        same(events, ["batch", { deletedRequests: 3, deletedChanges: 4 }, "close"], "PRUNE_CALLBACK_CLOSE_ORDER"); clean();
      }
    });
    await suite.test("command awaits pending close before resolving", { timeout: 5000 }, async () => {
      const entered = gate(), release = gate(); let resolved = false;
      const pending = runWithDataRepositories({ activityPrune: { async pruneBatch() { return { requests: 0, changes: 0 }; },
        async close() { entered.release(); await release.promise; } } }, () => runActivityPruneCommand(load));
      void pending.then(() => { resolved = true; }, () => {});
      await entered.promise; await Promise.resolve(); assert.equal(resolved, false); release.release(); await pending; assert.equal(resolved, true); clean();
    });
    await suite.test("missing scope rejects before environment/default DB; nested scope does not inherit and outer restores", async () => {
      const before = { loaded, pg: pg.length, pgCloses }, outer = port([{ requests: 0, changes: 0 }]);
      await runWithDataRepositories({ activityPrune: outer.repository }, async () => {
        for (const scope of [{}, { databaseHealth: { async check() {} } }]) await runWithDataRepositories(scope, async () => {
          assert.throws(() => getActivityPruneRepository(), { message: "DATA_REPOSITORY_NOT_CONFIGURED: activityPrune" });
          await assert.rejects(runActivityPruneCommand(load), fixed);
        });
        assert.equal(getActivityPruneRepository(), outer.repository); await runActivityPruneCommand(load);
      });
      same(outer.events, ["batch", "close"], "PRUNE_OUTER_RESTORED"); same({ loaded, pg: pg.length, pgCloses }, before, "PRUNE_SCOPE_FALLBACK"); clean();
    });
    await suite.test("concurrent A/B scopes preserve repository identity, totals and cleanup through a two-party barrier", { timeout: 5000 }, async () => {
      const barrier = gate(); let entered = 0; const owners: boolean[] = [], closes: string[] = [], outputs: unknown[] = [];
      const a: ActivityPruneRepository = { async pruneBatch() { if (++entered === 2) barrier.release(); await barrier.promise; owners.push(getActivityPruneRepository() === a); return { requests: 1, changes: 2 }; }, async close() { closes.push("a"); } };
      const b: ActivityPruneRepository = { async pruneBatch() { if (++entered === 2) barrier.release(); await barrier.promise; owners.push(getActivityPruneRepository() === b); return { requests: 3, changes: 4 }; }, async close() { closes.push("b"); } };
      const before = { loaded, pg: pg.length, pgCloses };
      const results = await Promise.all([
        runWithDataRepositories({ activityPrune: a }, () => runActivityPruneCommand(load, s => outputs.push(["a", s]))),
        runWithDataRepositories({ activityPrune: b }, () => runActivityPruneCommand(load, s => outputs.push(["b", s])))
      ]);
      same(results, [{ deletedRequests: 1, deletedChanges: 2 }, { deletedRequests: 3, deletedChanges: 4 }], "PRUNE_SCOPE_RESULTS");
      same(owners, [true, true], "PRUNE_SCOPE_IDENTITY"); same(closes.sort(), ["a", "b"], "PRUNE_SCOPE_CLOSES");
      same(outputs.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))), [["a", results[0]], ["b", results[1]]], "PRUNE_SCOPE_OUTPUTS");
      same({ loaded, pg: pg.length, pgCloses }, before, "PRUNE_CONCURRENT_FALLBACK"); clean();
    });
    await suite.test("environment/initialization failure is fixed and does not close an uninitialized PG client", async () => {
      const before = { pg: pg.length, pgCloses };
      await assert.rejects(runActivityPruneCommand(() => { throw new Error(PRIVATE); }), fixed);
      delete process.env.PII_INDEX_KEY;
      await assert.rejects(runActivityPruneCommand(load), fixed);
      same({ pg: pg.length, pgCloses }, before, "PRUNE_INIT_EFFECT"); clean();
    });
    await suite.test("same observers catch duplicate totals, raw logs and a swallowed forbidden IO call", async () => {
      assert.throws(() => same({ deletedRequests: 2008, deletedChanges: 2006 }, { deletedRequests: 1004, deletedChanges: 1003 }, "PRUNE_TOTAL"), { name: "AssertionError" });
      await runWithDataRepositories({ activityPrune: { async pruneBatch() { try { await fetch("https://example.invalid/forbidden"); } catch { /* Negative control. */ } return { requests: 0, changes: 0 }; }, async close() {} } }, () => runActivityPruneCommand(load));
      assert.throws(clean, { name: "AssertionError", message: "PRUNE_FORBIDDEN_IO" }); same(unexpected, ["fetch"], "PRUNE_CONTROL_EVENT"); unexpected.length = 0;
      console.error({ cause: { raw: PRIVATE } }); assert.throws(clean, { name: "AssertionError", message: "PRUNE_OUTPUT_LEAK" }); logs.length = 0; clean();
    });
  } finally {
    adapter.restore(); fetchTrap.mock.restore(); captures.forEach(capture => capture.mock.restore());
    if (previous === undefined) delete globals.prisma; else globals.prisma = previous;
    for (const name of envNames) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  }
});

type Mode = "success" | "empty" | "partial-error" | "nonerror" | "close-error" | "missing-key" | "import";
type Event = { event: string; value: unknown };
const values = (events: Event[], name: string) => events.filter(event => event.event === name).map(event => event.value);
// Literal allowlist from installed dotenv 17.4.2/lib/main.js TIPS. Do not derive
// this oracle from child output or accept arbitrary text following a valid tip.
const DOTENV_TIPS = [
  "◈ encrypted .env [www.dotenvx.com]",
  "◈ secrets for agents [www.dotenvx.com]",
  "⌁ auth for agents [www.vestauth.com]",
  "⌘ custom filepath { path: '/custom/path/.env' }",
  "⌘ enable debugging { debug: true }",
  "⌘ override existing { override: true }",
  "⌘ suppress logs { quiet: true }",
  "⌘ multiple files { path: ['.env.local', '.env'] }"
] as const;
function parseCliStdout(out: string, mode: Mode): unknown[] {
  if (mode === "import") { same(out, "", "PRUNE_IMPORT_STDOUT"); return []; }
  const hasSummary = ["success", "empty", "close-error"].includes(mode);
  assert.ok(out.endsWith("\n"), "PRUNE_STDOUT_TERMINATOR");
  // Keep empty lines: extra blank output must not disappear via filter(Boolean).
  const lines = out.split(/\r?\n/); lines.pop();
  // Keep the observer's fixed diagnostic: assert.equal appends a numeric diff
  // in this Node version, which would break the exact-message negative control.
  same(lines.length, hasSummary ? 3 : 2, "PRUNE_STDOUT_LINE_COUNT");
  // Synthetic local file has 9 new keys (6 without PII keys); base adds only one.
  const notices = [
    `◇ injected env (${mode === "missing-key" ? 6 : 9}) from .env.local // tip: `,
    "◇ injected env (1) from .env // tip: "
  ];
  for (const [index, prefix] of notices.entries()) {
    assert.ok(DOTENV_TIPS.some(tip => lines[index] === prefix + tip), "PRUNE_DOTENV_NOTICE");
  }
  if (!hasSummary) return [];
  try { return [JSON.parse(lines[2])]; }
  catch { assert.fail("PRUNE_SUMMARY_JSON_INVALID"); }
}
let interruptedRun = false;
function bootstrapCode(stderr: string) {
  return ["PRUNE_PRELOAD_MODE_INVALID", "PRUNE_PRELOAD_CWD_MISSING", "PRUNE_PRELOAD_CWD_MISMATCH", "PRUNE_PRELOAD_CWD_NOT_OWNED",
    "ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX", "ERR_UNKNOWN_FILE_EXTENSION", "SyntaxError", "TypeError", "ReferenceError"]
    .find(code => stderr.includes(code)) ?? "UNCLASSIFIED";
}
async function cli(mode: Mode, args: string[] = [], signal?: AbortSignal) {
  assert.equal(interruptedRun, false, "PRUNE_PREVIOUS_CHILD_INTERRUPTED");
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "hub-om-prune-cli-"))); let spawned = false, closed = false;
  try {
    writeFileSync(join(cwd, ".env.local"), ["PRUNE_ORDER=local", "PRUNE_INHERITED=local", "PRUNE_EMPTY=",
      'PRUNE_DOUBLE="synthetic-first\\nsynthetic-second"', "PRUNE_SINGLE='synthetic-third\\nsynthetic-fourth'",
      'PRUNE_MULTILINE="synthetic-line-one\nsynthetic-line-two"', "DATABASE_URL=postgresql://synthetic@127.0.0.1:1/prune_forbidden",
      ...(mode === "missing-key" ? [] : [`PII_ENCRYPTION_KEYS='${JSON.stringify({ prune: Buffer.alloc(32, 51).toString("base64") })}'`,
        "PII_ACTIVE_KEY_ID=prune", `PII_INDEX_KEY=${Buffer.alloc(32, 85).toString("base64")}`])].join("\n"));
    writeFileSync(join(cwd, ".env"), "PRUNE_ORDER=base\nPRUNE_INHERITED=base\nPRUNE_BASE_ONLY=synthetic-base\nPRUNE_EMPTY=base\n");
    const script = new URL("scripts/prune-activity.ts", root);
    const invocation = mode === "import" ? ["--input-type=module", "--eval", `await import(${JSON.stringify(script.href)});`] : [fileURLToPath(script), ...args];
    const child = spawn(process.execPath, ["--experimental-strip-types", "--experimental-loader", fileURLToPath(new URL("scripts/ts-loader.mjs", root)),
      "--import", new URL("activity-prune-cli-tests/preload.fixture.ts", import.meta.url).href, ...invocation], {
      cwd, env: { NODE_ENV: "test", TZ: "UTC", NODE_NO_WARNINGS: "1", PRUNE_CLI_MODE: mode, PRUNE_CLI_CWD: cwd, PRUNE_INHERITED: "inherited" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    spawned = true; const stdout: Buffer[] = [], stderr: Buffer[] = []; let interrupted = false, spawnFailed = false;
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk))); child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    child.once("error", () => { spawnFailed = true; });
    let kill: ReturnType<typeof setTimeout> | undefined;
    const abort = () => { if (closed || interrupted) return; interrupted = true; interruptedRun = true; child.kill("SIGTERM"); kill = setTimeout(() => child.kill("SIGKILL"), 1000); };
    const timer = setTimeout(abort, 15000); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once("close", (code, exitSignal) => {
      closed = true; clearTimeout(timer); clearTimeout(kill); signal?.removeEventListener("abort", abort); resolve({ code, signal: exitSignal });
    }));
    if (exit.signal) interruptedRun = true;
    assert.equal(spawnFailed, false, "PRUNE_CHILD_SPAWN_FAILED"); assert.equal(interrupted, false, "PRUNE_CHILD_FORCED_TERMINATION"); assert.equal(exit.signal, null);
    const out = Buffer.concat(stdout).toString(), err = Buffer.concat(stderr).toString();
    const path = join(cwd, "observer.jsonl");
    if (!existsSync(path)) throw new Error(`PRUNE_OBSERVER_MISSING:${bootstrapCode(err)}`);
    const events = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line) as Event);
    same(values(events, "forbidden"), [], "PRUNE_CHILD_FORBIDDEN_IO");
    for (const marker of [PRIVATE, RAW, "private-key", "postgresql://", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY"]) assert.ok(!out.includes(marker) && !err.includes(marker), "PRUNE_CHILD_PRIVATE_OUTPUT");
    assert.equal(events[0].event, "preload-ready"); assert.equal(events.at(-1)?.event, "exit"); same(values(events, "exit"), [exit.code], "PRUNE_EXIT_LEDGER");
    const summaries = parseCliStdout(out, mode);
    return { ...exit, out, err, events, summaries };
  } finally { if (!spawned || closed) rmSync(cwd, { recursive: true }); }
}

test("activity prune actual script entry with synthetic cached Prisma IO", { timeout: 120_000 }, async suite => {
  await suite.test("same stdout parser accepts only literal dotenv tips and exactly two ordered notices; suffix/extra-log controls reject", () => {
    const summary = { deletedRequests: 1004, deletedChanges: 1003 };
    const json = JSON.stringify(summary);
    const local = `◇ injected env (9) from .env.local // tip: ${DOTENV_TIPS[0]}`;
    const base = `◇ injected env (1) from .env // tip: ${DOTENV_TIPS[1]}`;
    for (const tip of DOTENV_TIPS) {
      same(parseCliStdout(`◇ injected env (9) from .env.local // tip: ${tip}\n◇ injected env (1) from .env // tip: ${tip}\n${json}\n`, "success"),
        [summary], "PRUNE_ALLOWED_TIP_CONTROL");
    }
    // Neither raw canary matching nor a separate permissive parser guards these:
    // mutate the actual child's parser input with a previously unseen suffix.
    for (const line of [`${local} arbitrary-suffix`, "◇ injected env (9) from .env.local // tip: arbitrary-tip"]) {
      assert.throws(() => parseCliStdout(`${line}\n${base}\n${json}\n`, "success"), { name: "AssertionError", message: "PRUNE_DOTENV_NOTICE" });
    }
    for (const out of [
      `${local}\n${base}\n${base}\n${json}\n`,
      `${local}\n${base}\n${json}\n${local}\n`,
      `${local}\n${base}\n${json}\n\n`,
      `${local}\n${json}\n`
    ]) assert.throws(() => parseCliStdout(out, "success"), { name: "AssertionError", message: "PRUNE_STDOUT_LINE_COUNT" });
    assert.throws(() => parseCliStdout(`${base}\n${local}\n${json}\n`, "success"), { name: "AssertionError", message: "PRUNE_DOTENV_NOTICE" });
    assert.throws(() => parseCliStdout(`${local}\n${base}\n${base}\n`, "partial-error"), { name: "AssertionError", message: "PRUNE_STDOUT_LINE_COUNT" });
    assert.throws(() => parseCliStdout(`${local}\n`, "import"), { name: "AssertionError", message: "PRUNE_IMPORT_STDOUT" });
  });
  const modes: Mode[] = ["success", "empty", "partial-error", "nonerror", "close-error", "missing-key", "import"];
  for (const mode of modes) {
    if (interruptedRun) break;
    await suite.test(mode, async sub => {
      const result = await cli(mode, ["--unknown", "--retention-days", "0", "--limit", "0"], sub.signal);
      const successful = mode === "success" || mode === "empty" || mode === "import";
      assert.equal(result.code, successful ? 0 : 1); assert.equal(result.err, successful ? "" : `${FAILED}\n`);
      same(values(result.events, "env-read"), mode === "import" ? [] : [".env.local", ".env"], "PRUNE_ENV_ORDER");
      const summary = mode === "empty" ? { deletedRequests: 0, deletedChanges: 0 } : { deletedRequests: 1004, deletedChanges: 1003 };
      same(result.summaries, ["success", "empty", "close-error"].includes(mode) ? [summary] : [], "PRUNE_CLI_SUMMARY");
      same(values(result.events, "close"), ["missing-key", "import"].includes(mode) ? [] : [null], "PRUNE_CLI_CLOSE_COUNT");
      same(values(result.events, "stderr"), successful ? [] : [[FAILED]], "PRUNE_CLI_FIXED_STDERR");
      const transactions = values(result.events, "transaction") as Array<{ batch: number; options: unknown; env: unknown }>;
      const count = ["success", "close-error"].includes(mode) ? 3 : mode === "partial-error" ? 2 : ["empty", "nonerror"].includes(mode) ? 1 : 0;
      assert.equal(transactions.length, count);
      for (const [index, transaction] of transactions.entries()) same(transaction, { batch: index, options: { timeout: 10000 }, env: {
        PRUNE_ORDER: "local", PRUNE_INHERITED: "inherited", PRUNE_BASE_ONLY: "synthetic-base", PRUNE_DOUBLE: "synthetic-first\nsynthetic-second",
        PRUNE_SINGLE: "synthetic-third\\nsynthetic-fourth", PRUNE_MULTILINE: "synthetic-line-one\nsynthetic-line-two", PRUNE_EMPTY: ""
      } }, "PRUNE_ENV_OR_TRANSACTION_CONTRACT");
      const deletions = values(result.events, "delete") as Array<{ batch: number; index: number; parts: string[]; raw: string[]; values: unknown[] }>;
      assert.equal(deletions.length, mode === "nonerror" ? 1 : count * 2);
      for (const deletion of deletions) {
        const expected = deletion.index === 0
          ? "DELETE FROM activity_requests WHERE id IN (SELECT id FROM activity_requests WHERE occurred_at < now() - interval '30 days' ORDER BY occurred_at LIMIT 1000)"
          : "DELETE FROM activity_changes WHERE id IN (SELECT id FROM activity_changes WHERE occurred_at < now() - interval '365 days' ORDER BY occurred_at LIMIT 1000)";
        same(deletion.parts, [expected], "PRUNE_DELETE_SQL"); same(deletion.raw, deletion.parts, "PRUNE_DELETE_TAGGED_SQL"); same(deletion.values, [], "PRUNE_DELETE_VALUES");
      }
      same(values(result.events, "transaction-return"), ["success", "close-error"].includes(mode)
        ? [{ requests: 1000, changes: 1 }, { requests: 0, changes: 1000 }, { requests: 4, changes: 2 }]
        : mode === "empty" ? [{ requests: 0, changes: 0 }] : mode === "partial-error" ? [{ requests: 1000, changes: 1 }] : [], "PRUNE_BATCH_RETURN_LEDGER");
      if (result.summaries.length) {
        const outputIndex = result.events.findIndex(event => event.event === "stdout" && isDeepStrictEqual(event.value, [JSON.stringify(summary)]));
        assert.ok(outputIndex >= 0); assert.ok(outputIndex < result.events.findIndex(event => event.event === "close"), "PRUNE_SUMMARY_MUST_PRECEDE_CLOSE");
      }
      if (mode === "import") { assert.equal(result.out, ""); same(result.events.map(event => event.event), ["preload-ready", "exit"], "PRUNE_IMPORT_SIDE_EFFECT"); }
    });
  }
});
