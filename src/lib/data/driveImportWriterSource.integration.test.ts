/** V3 actual default scanner -> orchestration -> native writer -> existing reader.
 * Parent executes only. No real env files, source endpoints or borrowed databases.
 * Fresh process per case separates frozen/current module caches and Google config.
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { URI, ROOT, CASES, CANARY, TOKEN, type Scenario } from "./driveImportWriterSourceHttp.fixture.ts";

const uri = process.env.MONGODB_DRIVE_IMPORT_WRITER_SOURCE_TEST_URI;
test("V3 Drive writer actual scanner HTTP/native history", { skip: !uri, timeout: 600_000 }, async suite => {
  assert.equal(uri, URI);
  let interrupted = false;
  for (const scenario of CASES) {
    await suite.test(scenario, { timeout: 50_000 }, async () => {
      await child(scenario, () => { interrupted = true; });
    });
    // A failed subtest does not reject suite.test(). Stop in the outer loop explicitly.
    if (interrupted) throw new Error("SOURCE_SUITE_STOPPED: cleanup NOT_CONFIRMED; parent resource audit required");
  }
});

async function child(scenario: Scenario, stopSuite: () => void): Promise<void> {
  mkdirSync(ROOT, { recursive: true });
  const cwd = mkdtempSync(`${ROOT}/source-cwd-`);
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
  const worker = fork(new URL("./driveImportWriterSourceChild.fixture.ts", import.meta.url), [scenario], {
    cwd, env: { ...env, NODE_ENV: "test", TZ: "UTC", LC_ALL: "C", MONGODB_DRIVE_IMPORT_WRITER_SOURCE_TEST_URI: URI },
    execArgv: ["--experimental-strip-types", "--experimental-test-module-mocks", "--experimental-loader", fileURLToPath(new URL("../../../scripts/ts-loader.mjs", import.meta.url))],
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  const reports: unknown[] = [], stdout: Buffer[] = [], stderr: Buffer[] = [];
  worker.on("message", message => reports.push(message));
  worker.stdout?.on("data", data => stdout.push(Buffer.from(data))); worker.stderr?.on("data", data => stderr.push(Buffer.from(data)));
  let interrupted = false;
  const interrupt = () => { interrupted = true; stopSuite(); };
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      let kill: ReturnType<typeof setTimeout> | undefined;
      let processError = false;
      const timer = setTimeout(() => { interrupt(); worker.kill("SIGTERM"); kill = setTimeout(() => { worker.kill("SIGKILL"); }, 3000); }, 40_000);
      worker.once("error", () => { processError = true; interrupt(); });
      worker.once("exit", (exit, signal) => { if (signal || exit === null) interrupt(); });
      // close follows exit/error and waits for stdout/stderr pipes to finish.
      worker.once("close", (exit, signal) => { clearTimeout(timer); clearTimeout(kill);
        if (signal) interrupt();
        if (interrupted || processError) reject(new Error("SOURCE_WORKER_INTERRUPTED: owned DB cleanup NOT_CONFIRMED; parent resource audit required")); else resolve(exit); });
    });
    assert.equal(stdout.length, 0, "SOURCE_UNFILTERED_STDOUT");
    const stderrText = Buffer.concat(stderr).toString();
    for (const marker of [CANARY, TOKEN, "PRIVATE KEY", "FixtureOrg", "https://example.invalid"])
      assert.ok(!stderrText.includes(marker), "SOURCE_UNFILTERED_STDERR_MARKER");
    // Never interpolate an arbitrary IPC payload into assertion diagnostics.
    const report = reports[0];
    const value = report && typeof report === "object" ? report as Record<string, unknown> : undefined;
    const stages = ["bootstrap", "imports", "connect", "prepare", "seed", "load", "frozen-source", "current-source", "workflow",
      "stored-ledger", "reader", "privacy", "negative-controls", "final-invariants", "cleanup", "close"];
    const stage = typeof value?.stage === "string" && stages.includes(value.stage) ? value.stage : "unavailable";
    assert.ok(code === 0, `SOURCE_WORKER_FAILED:${stage}`);
    assert.ok(reports.length === 1 && value?.ok === true && value.scenario === scenario && value.cleaned === true
      && Object.keys(value).sort().join(",") === "cleaned,ok,scenario", "SOURCE_REPORT_INVALID");
  } finally {
    // An interrupted child's owned database is retained for explicit parent investigation.
    if (!interrupted) rmSync(cwd, { recursive: true });
  }
}
