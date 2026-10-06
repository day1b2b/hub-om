import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectPostgresRuntimeContract,
  POSTGRES_RUNTIME_ORDER_PROBE,
  type PostgresRuntimeClient,
} from "./postgresRuntimeContract";

function byteOrder(): string[] {
  return [...POSTGRES_RUNTIME_ORDER_PROBE].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

function client(overrides: {
  timezone?: string;
  encoding?: string;
  order?: string[];
  provider?: string;
  collate?: string;
  ctype?: string;
  recordedVersion?: string | null;
  actualVersion?: string | null;
  failAt?: string;
  end?: "fail" | "hang";
  destroy?: "fail" | "hang";
  asynchronousErrorAt?: string;
  asynchronousErrorOnDestroy?: boolean;
} = {}) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  let ended = 0, destroyed = 0;
  let errorListener: ((error: unknown) => void) | undefined;
  const fake: PostgresRuntimeClient = {
    async connect() { calls.push({ text: "CONNECT" }); },
    async query<Row extends Record<string, unknown>>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (overrides.asynchronousErrorAt && text.includes(overrides.asynchronousErrorAt)) {
        errorListener?.(new Error("asynchronous secret driver detail"));
      }
      if (overrides.failAt && text.includes(overrides.failAt)) throw new Error("secret driver detail");
      if (text.includes("FROM pg_database")) return { rows: [{
        session_timezone: overrides.timezone ?? "UTC",
        encoding: overrides.encoding ?? "UTF8",
        collate: overrides.collate ?? "C",
        ctype: overrides.ctype ?? "C",
        provider: overrides.provider ?? "c",
        recorded_collation_version: overrides.recordedVersion ?? null,
        actual_collation_version: overrides.actualVersion ?? null,
      } as unknown as Row] };
      if (text.includes("FROM unnest")) return { rows: (overrides.order ?? byteOrder()).map(value => ({ value }) as unknown as Row) };
      return { rows: [] };
    },
    async end() {
      ended++; calls.push({ text: "END" });
      if (overrides.end === "fail") throw new Error("end secret");
      if (overrides.end === "hang") await new Promise<never>(() => {});
    },
    destroy() {
      destroyed++; calls.push({ text: "DESTROY" });
      if (overrides.destroy === "fail") throw new Error("destroy secret");
      if (overrides.destroy === "hang") return new Promise<never>(() => {});
      if (overrides.asynchronousErrorOnDestroy) queueMicrotask(() => errorListener?.(new Error("late destroy secret")));
    },
    on(event, listener) { if (event === "error") errorListener = listener; },
    off(event, listener) { if (event === "error" && errorListener === listener) errorListener = undefined; },
  };
  return {
    fake,
    calls,
    ended: () => ended,
    destroyed: () => destroyed,
    hasErrorListener: () => errorListener !== undefined,
    emitError: () => errorListener?.(new Error("post-timeout secret")),
  };
}

test("runtime contract accepts UTC, UTF8, current collation version and byte ordering", async () => {
  const fixture = client();
  const report = await inspectPostgresRuntimeContract(fixture.fake);
  assert.equal(report.status, "compatible");
  assert.deepEqual(report.checks, {
    utcSession: true,
    utf8Encoding: true,
    byteProbeOrdering: true,
    verifiedByteCollation: true,
    collationVersionCurrent: true,
  });
  assert.equal(fixture.calls[1].text, "BEGIN TRANSACTION READ ONLY");
  assert.equal(fixture.calls.at(-2)?.text, "ROLLBACK");
  assert.equal(fixture.ended(), 1);
  assert.equal(fixture.destroyed(), 0);
});

test("runtime contract reports unsupported operating semantics without exposing probe values", async () => {
  const fixture = client({ timezone: "Asia/Seoul", encoding: "LATIN1", order: [...byteOrder()].reverse() });
  const report = await inspectPostgresRuntimeContract(fixture.fake);
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.checks, {
    utcSession: false,
    utf8Encoding: false,
    byteProbeOrdering: false,
    verifiedByteCollation: false,
    collationVersionCurrent: true,
  });
  assert.equal("order" in report, false);
});

test("matching probe is still blocked for an unverified locale or stale collation version", async () => {
  const locale = await inspectPostgresRuntimeContract(client({ provider: "i", collate: "und-x-icu", ctype: "und-x-icu" }).fake);
  assert.equal(locale.status, "blocked");
  assert.equal(locale.checks.byteProbeOrdering, true);
  assert.equal(locale.checks.verifiedByteCollation, false);
  const stale = await inspectPostgresRuntimeContract(client({ recordedVersion: "1", actualVersion: "2" }).fake);
  assert.equal(stale.status, "blocked");
  assert.equal(stale.checks.collationVersionCurrent, false);
});

test("asynchronous driver errors, end rejection and bounded end timeout all fail generically", async () => {
  for (const { fixture, expectedDestroy } of [
    { fixture: client({ asynchronousErrorAt: "FROM pg_database" }), expectedDestroy: 0 },
    { fixture: client({ end: "fail" }), expectedDestroy: 1 },
    { fixture: client({ end: "hang", asynchronousErrorOnDestroy: true }), expectedDestroy: 1 },
  ]) {
    await assert.rejects(inspectPostgresRuntimeContract(fixture.fake, { cleanupTimeoutMs: 5 }), error => {
      assert.equal((error as Error).message, "POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED");
      assert.doesNotMatch(String(error), /secret/);
      return true;
    });
    assert.equal(fixture.ended(), 1);
    assert.equal(fixture.destroyed(), expectedDestroy);
  }
});

test("unconfirmed forced close retains the generic error listener for late events", async () => {
  const fixture = client({ end: "hang", destroy: "hang" });
  await assert.rejects(inspectPostgresRuntimeContract(fixture.fake, { cleanupTimeoutMs: 5 }),
    /POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED/);
  assert.equal(fixture.destroyed(), 1);
  assert.equal(fixture.hasErrorListener(), true);
  assert.doesNotThrow(() => fixture.emitError());
});

test("runtime contract rolls back and closes while replacing driver errors", async () => {
  const fixture = client({ failAt: "FROM pg_database" });
  await assert.rejects(inspectPostgresRuntimeContract(fixture.fake), error => {
    assert.equal((error as Error).message, "POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED");
    assert.doesNotMatch(String(error), /secret driver detail/);
    return true;
  });
  assert.ok(fixture.calls.some(call => call.text === "ROLLBACK"));
  assert.equal(fixture.ended(), 1);
});
