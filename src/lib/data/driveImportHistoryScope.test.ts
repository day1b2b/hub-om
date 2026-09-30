import assert from "node:assert/strict";
import { test } from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { getDriveImportHistoryRepository, readLatestDriveImportResult, readLatestDriveImportRun } from "../driveImports/driveImportResults";

test("Drive history: missing scope rejects both public promises; synchronous preflight stays available", async () => {
  await runWithDataRepositories({}, async () => {
    assert.throws(() => getDriveImportHistoryRepository(), { message: "DATA_REPOSITORY_NOT_CONFIGURED: driveImportHistory" });
    let one!: ReturnType<typeof readLatestDriveImportResult>, many!: ReturnType<typeof readLatestDriveImportRun>;
    assert.doesNotThrow(() => { one = readLatestDriveImportResult("synthetic"); many = readLatestDriveImportRun(NaN); });
    assert.ok(one instanceof Promise); assert.ok(many instanceof Promise);
    await Promise.all([assert.rejects(one, { message: "DATA_REPOSITORY_NOT_CONFIGURED: driveImportHistory" }),
      assert.rejects(many, { message: "DATA_REPOSITORY_NOT_CONFIGURED: driveImportHistory" })]);
  });
});

test("Drive history: explicit repository errors stay rejected, with no default retry", async () => {
  let calls = 0;
  const failure = new Error("DRIVE_IMPORT_HISTORY_READ_FAILED");
  const repository = {
    async readLatestDriveImportResult() { calls++; throw failure; },
    async readLatestDriveImportRun() { calls++; throw failure; }
  };
  await runWithDataRepositories({ driveImportHistory: repository }, async () => {
    assert.equal(getDriveImportHistoryRepository(), repository);
    await assert.rejects(readLatestDriveImportResult("synthetic"), error => error === failure);
    await assert.rejects(readLatestDriveImportRun(), error => error === failure);
  });
  assert.equal(calls, 2);
});

test("Drive history: actual native scopes remain isolated across awaits with/without default PG env", {
  skip: !process.env.MONGODB_DRIVE_HISTORY_TEST_URI, timeout: 60_000
}, async () => {
  const { mock } = await import("node:test");
  const { default: pg } = await import("pg");
  const { driveHarness, OP, runLiteral, resultLiteral, singleLiteral } = await import("./driveHistoryFixtures");
  const saved = process.env.DATABASE_URL;
  let pgCalls = 0, fetchCalls = 0;
  const pgTrap = mock.method(pg.Pool.prototype, "connect", () => { pgCalls++; throw new Error("DRIVE_SCOPE_PG_FORBIDDEN"); });
  const fetchTrap = mock.method(globalThis, "fetch", async () => { fetchCalls++; throw new Error("DRIVE_SCOPE_SOURCE_FORBIDDEN"); });
  try {
    await driveHarness(async h => {
      const a = await h.fixture(), b = await h.fixture();
      await a.seedPair({}, { inputValue: "synthetic-scope-a" });
      await b.seedPair({}, { inputValue: "synthetic-scope-b" });
      const beforeA = await a.snapshot(), beforeB = await b.snapshot();
      for (const hasDefault of [false, true]) {
        if (hasDefault) process.env.DATABASE_URL = "postgresql://synthetic@127.0.0.1:1/drive_scope_forbidden";
        else delete process.env.DATABASE_URL;
        const reads = [a, b].map((f, index) => runWithDataRepositories({ driveImportHistory: f.repo }, async () => {
          await new Promise<void>(resolve => setImmediate(resolve));
          assert.equal(getDriveImportHistoryRepository(), f.repo);
          const marker = index === 0 ? "synthetic-scope-a" : "synthetic-scope-b";
          assert.deepEqual(await readLatestDriveImportRun(), runLiteral([resultLiteral({ inputValue: marker })]));
          await Promise.resolve();
          assert.deepEqual(await readLatestDriveImportResult(OP), singleLiteral({ inputValue: marker }));
        }));
        await Promise.all(reads);
      }
      assert.deepEqual(await a.snapshot(), beforeA); assert.deepEqual(await b.snapshot(), beforeB);
    });
    assert.equal(pgCalls, 0); assert.equal(fetchCalls, 0);
  } finally {
    pgTrap.mock.restore(); fetchTrap.mock.restore();
    if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
  }
});
