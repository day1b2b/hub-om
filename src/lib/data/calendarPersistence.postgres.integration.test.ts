/**
 * Calendar P1/P2/P3/P6/P7/P8 + O1–O4. Coordinator executes, never this author.
 * Frozen PG / current PG / Mongo are separate processes, with no shared Prisma,
 * activity ALS, module cache, or expected-value builder. Exact literal audit
 * assertions run inside each worker; approved tuples are then compared whole.
 * The final child is frozen PG ONLY: native lock loss and real OS pause evidence.
 * Fault/native/OS/synthetic effect labels are preserved in its evidence list.
 * Mongo L6/L11 lease/commit interleavings are owned by the separate native suite.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fork } from "node:child_process";
import { test } from "node:test";
import { verifyClosure } from "../../../.claude/plans/mongodb-calendar-boundary/original/frozen-loader.fixture.ts";

const pgOptIn = process.env.PG_CALENDAR_TEST_DATABASE_URL;
const mongoOptIn = process.env.MONGODB_CALENDAR_TEST_URI;
const fixtureRoot = new URL("../../../.claude/plans/mongodb-calendar-boundary/original/", import.meta.url);
interface Result { kind: "result"; ledger?: unknown; evidence?: string[] }
async function child(file: string, args: string[], timeout: number, onTimeout: (error: Error) => void): Promise<Result> {
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "PG_CALENDAR_TEST_DATABASE_URL", "MONGODB_CALENDAR_TEST_URI"].flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));
  // Pass explicit module/type flags, not the parent's --test or reporter flags.
  const processChild = fork(new URL(file, fixtureRoot), args, {
    env: { ...env, LC_ALL: "C", NODE_ENV: "test" },
    execArgv: ["--experimental-strip-types", "--experimental-test-module-mocks", "--experimental-loader", new URL("../../../scripts/ts-loader.mjs", import.meta.url).pathname],
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  let stdout = "", stderr = "", result: Result | undefined, failure: string | undefined;
  processChild.stdout?.on("data", chunk => { stdout += String(chunk); });
  processChild.stderr?.on("data", chunk => { stderr += String(chunk); });
  processChild.on("message", message => {
    const value = message as { kind?: string; message?: string };
    if (value.kind === "result") { assert.equal(result, undefined); result = message as Result; }
    if (value.kind === "failure") failure = value.message;
  });
  return new Promise<Result>((resolve, reject) => {
    let timedOut: Error | undefined, childError: Error | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = new Error(`${file}(${args.join(",")}) pid=${processChild.pid} exceeded ${timeout}ms; no PASS. Owned-resource audit REQUIRED (descendants, PG sessions/schema/locks, Mongo databases); cleanup is NOT confirmed.`);
      onTimeout(timedOut);
      processChild.kill("SIGTERM");
      escalation = setTimeout(() => { processChild.kill("SIGKILL"); }, 5_000);
    }, timeout);
    processChild.on("error", error => {
      childError = error;
      // A failed spawn has no process to await; kill errors must still await exit.
      if (processChild.pid === undefined && !timedOut) { clearTimeout(timer); reject(error); }
    });
    processChild.once("exit", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      if (timedOut) reject(new Error(`${timedOut.message}\nObserved child exit=${code}/${signal}. This does not prove resource cleanup.\n${childError?.message ?? ""}\n${failure ?? ""}\n${stdout}\n${stderr}`));
      else if (code !== 0 || signal || childError || failure || !result) reject(new Error(`${file}(${args.join(",")}) exit=${code}/${signal}\n${childError?.message ?? ""}\n${failure ?? ""}\n${stdout}\n${stderr}`));
      else resolve(result);
    });
  });
}

test("Calendar frozen PG/current PG/Mongo persistence and frozen PG lock baseline", {
  // Cover all child budgets (650s) plus four termination grace periods (20s).
  skip: pgOptIn === undefined && mongoOptIn === undefined, concurrency: false, timeout: 700_000
}, async suite => {
  assert.equal(pgOptIn, "postgresql://synthetic@127.0.0.1:56749/calendar_boundary_parity");
  assert.equal(mongoOptIn, "mongodb://127.0.0.1:27849/?replicaSet=calendarboundary20260930");
  const manifest = verifyClosure();
  assert.equal(manifest.files.filter(entry => entry.role === "runtime").length, 12);
  for (const origin of ["package-lock.json", "package.json", "prisma/schema.prisma", "scripts/ts-loader.mjs"]) {
    const entry = manifest.files.find(row => row.originPath === origin);
    assert.ok(entry, `${origin}: missing frozen dependency`);
    assert.equal(createHash("sha256").update(readFileSync(new URL(`../../../${origin}`, import.meta.url))).digest("hex"), entry.sha256, `${origin}: baseline runtime/schema drift`);
  }
  let timeoutFailure: Error | undefined;
  const worker = (file: string, args: string[], timeout: number) => child(file, args, timeout, error => { timeoutFailure = error; });
  let original: unknown;
  for (const backend of ["original", "current", "mongo"] as const) {
    await suite.test(`${backend}: eight functions, timestamps, literal audit fields and rollback`, async () => {
      const result = await worker("persistence-worker.fixture.ts", [backend], 150_000);
      assert.ok(Array.isArray(result.ledger)); assert.ok(result.ledger.length > 10);
      if (backend === "original") original = result.ledger;
      else assert.deepEqual(result.ledger, original, `${backend}: complete approved tuple must match frozen PG`);
    });
    // suite.test records failures without rejecting: explicitly stop worker scheduling.
    if (timeoutFailure) throw timeoutFailure;
  }
  await suite.test("frozen PG: session loss preserves effects; real event-loop pause differs from lease expiry", async () => {
    const result = await worker("lock-worker.fixture.ts", [], 200_000);
    assert.ok(result.evidence?.some(value => value.startsWith("BL08/09")));
    assert.ok(result.evidence?.some(value => value.startsWith("BL10")));
    assert.ok(result.evidence?.some(value => value.startsWith("BL11")));
    for (const item of result.evidence!) suite.diagnostic(item);
  });
  if (timeoutFailure) throw timeoutFailure;
  suite.diagnostic("No original/current/Mongo source cache sharing. Mapping audit literals derive from frozen SQL trigger. PG SIGSTOP is real >60s; synthetic effect is not Google. Mongo L6/L11 are not claimed here.");
});
