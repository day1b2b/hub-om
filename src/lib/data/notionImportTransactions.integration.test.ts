/** V5 actual POST/native transactions. No DB/test execution during authorship.
 * Parent: env -i PATH=... HOME=... NODE_ENV=test MONGODB_NOTION_IMPORT_TEST_URI=
 * 'mongodb://127.0.0.1:27852/?replicaSet=notionimport20260930' node
 * --experimental-test-module-mocks --experimental-strip-types
 * --experimental-loader ./scripts/ts-loader.mjs --test --test-concurrency=1 <this file>
 * No .env loading, external source, PG/Calendar resource reuse. Duplicate races belong to the parity lane.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoServerError } from "mongodb";
import { ERROR_CANARY, GENERIC_ERROR, PARSED, READER_RESULT, successBody, uuid,
  assertReader, assertRun, assertSourceRow } from "./notionImportTransactionLiterals.fixture";
import { EXACT_URI, OPT_IN, assertAudit, assertOnce, assertWholeRun, bounded, captureLogs, deferred,
  installHandler, newTrace, openHarness, type Fixture, type Trace } from "./notionImportTransactionHarness.fixture";
import { decodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

function fault(code: number, label?: string) {
  const error = new MongoServerError({ code, message: ERROR_CANARY });
  if (label) error.addErrorLabel(label);
  return error;
}
async function responseBody(response: Response, t: Trace) {
  assert.equal(response.status, 200);
  const body: unknown = await response.json();
  const runId = t.runIds.at(-1); uuid(runId);
  assert.deepEqual(body, successBody(runId)); return runId;
}
async function failureBody(response: Response, message = GENERIC_ERROR) {
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: message });
}
async function counts(f: Fixture, runs: number, rows: number, audits: number) {
  assert.equal((await f.raw("DataImportRun")).length, runs);
  assert.equal((await f.raw("OperationSourceRecord")).length, rows);
  assert.equal((await f.raw("ActivityRequest")).length, audits);
}
async function normal(f: Fixture, t: Trace, response: Response) {
  const id = await responseBody(response, t);
  assertOnce(t); await assertWholeRun(f, t, id); await assertAudit(f, response, t); return id;
}

const uri = process.env[OPT_IN];
test("Notion V5 actual POST + native transaction schedules (exact owned replica opt-in)", {
  skip: uri === undefined ? `${OPT_IN} is required; parent owns native execution` : false,
  timeout: 900_000
}, async suite => {
  assert.equal(uri, EXACT_URI, "wrong opt-in must fail, never skip/fall back");
  const runtime = await installHandler();
  let harness: Awaited<ReturnType<typeof openHarness>> | undefined;
  try {
    harness = await openHarness(uri!, runtime.readDatabase);
    const ready = harness;
    async function scenario(name: string, work: (f: Fixture) => Promise<void>) {
      await suite.test(name, { timeout: 90_000 }, async () => {
        const f = await ready.fixture();
        try { await work(f); }
        finally {
          await f.assertBusinessUnchanged(); await f.assertNoMutationAudit(); await f.assertNoToken();
          runtime.assertNoFallback();
        }
      });
    }

    await scenario("actual POST/reader/parser + TWO synthetic HTTP pages + native rosters/store/audit: whole run", async f => {
      const t = newTrace("normal");
      const { value: response, entries } = await captureLogs(() => f.invoke(runtime.POST, t));
      await normal(f, t, response); await counts(f, 1, 2, 1); assert.deepEqual(entries, []);
      assert.deepEqual([t.callbacks, t.commits, t.committed, t.aborted], [1, 1, 1, 0]);
      assert.deepEqual(t.events, ["handler-enter", "auth", "auth", "source", "reader", "fetch:1", "fetch:2", "parser", "reader-return", "store", "roster", "instructors",
        "callback:1", "insert-ack:DataImportRun", "insert-ack:OperationSourceRecord", "insert-ack:OperationSourceRecord",
        "commit-call", "commit-ack", "audit-enter", "audit-ack", "handler-settled"]);
    });

    for (const lane of ["second-page-http", "second-page-json", "second-page-mapper", "parser-post-delegate-fault", "roster", "instructor"] as const) {
      await scenario(`${lane} failure before transaction: staging unchanged; actual independent 400 audit`, async f => {
        const before = await f.snapshot(["DataImportRun", "OperationSourceRecord"]);
        const t = newTrace(lane);
        if (lane === "second-page-http" || lane === "second-page-json" || lane === "second-page-mapper") t.fetchLane = lane;
        if (lane === "parser-post-delegate-fault") t.parserFault = new Error(ERROR_CANARY);
        if (lane === "roster") t.rosterFault = fault(91); // Inject after native roster read.
        if (lane === "instructor") t.instructorFault = fault(91); // Inject after native notes read.
        const { value: response, entries } = await captureLogs(() => f.invoke(runtime.POST, t));
        await failureBody(response);
        assert.deepEqual(await f.snapshot(["DataImportRun", "OperationSourceRecord"]), before);
        await counts(f, 0, 0, 1); await assertAudit(f, response, t); assert.deepEqual(entries, []);
        assert.deepEqual([t.handler, t.auth, t.source, t.audit, t.auditInserts, t.transactions, t.callbacks, t.commits], [1, 2, 1, 1, 1, 0, 0, 0]);
        assert.deepEqual([t.reader, t.fetches], [1, 2]);
        assert.deepEqual([t.parser, t.store, t.roster, t.instructors], lane.startsWith("second-page") ? [0, 0, 0, 0]
          : lane === "parser-post-delegate-fault" ? [1, 0, 0, 0] : lane === "roster" ? [1, 1, 1, 0] : [1, 1, 1, 1]);
        if (lane === "parser-post-delegate-fault") assert.deepEqual(t.parsed, PARSED, "actual parser completed before explicit post-delegate fault");
        if (lane === "roster" || lane === "instructor") assert.deepEqual(t.readResult, READER_RESULT);
      });
    }

    await scenario("confirmed native abort AFTER real run + first source insert ACK: complete before/after equality", async f => {
      const before = await f.snapshot(["DataImportRun", "OperationSourceRecord"]);
      const t = newTrace("confirmed-abort"); let injected = 0;
      t.afterInsert = async (model, id, session) => {
        if (model !== "OperationSourceRecord") return;
        // Read our actual inserted document in the SAME native transaction before throwing.
        assert.ok(await f.store.collection(model).findOne({ _id: id }, { session }));
        assert.equal(t.runIds.length, 1); injected++;
        throw new Error(ERROR_CANARY);
      };
      const { value: response, entries } = await captureLogs(() => f.invoke(runtime.POST, t));
      await failureBody(response); assertOnce(t); await assertAudit(f, response, t);
      assert.equal(injected, 1); assert.deepEqual([t.callbacks, t.commits, t.aborted, t.rowIds.length], [1, 0, 1, 1]);
      assert.deepEqual(await f.snapshot(["DataImportRun", "OperationSourceRecord"]), before);
      // EndSession alone is not rollback proof: independent raw read equality above is required.
      await counts(f, 0, 0, 1); assert.deepEqual(entries, []);
    });

    await scenario("actual withTransaction callback retry: native first attempt abort; source/parser/rosters/store/audit remain once", async f => {
      const t = newTrace("callback-retry"); let injected = 0;
      t.afterInsert = async (model, id, session) => {
        if (model !== "OperationSourceRecord" || injected) return;
        assert.ok(await f.store.collection(model).findOne({ _id: id }, { session }));
        injected++; throw fault(112, "TransientTransactionError");
      };
      const { value: response, entries } = await captureLogs(() => f.invoke(runtime.POST, t));
      const runId = await normal(f, t, response);
      assert.equal(injected, 1); assert.deepEqual([t.callbacks, t.commits, t.committed, t.aborted], [2, 1, 1, 1]);
      assert.deepEqual(t.runIds, [runId, runId], "run identity is allocated outside the retried callback");
      assert.equal(t.rowIds.length, 3); assert.equal(new Set(t.rowIds).size, 3);
      assert.equal(await f.read.collection("OperationSourceRecord").findOne({ _id: t.rowIds[0] }, { timeoutMS: 5000 }), null);
      assert.deepEqual((await f.raw("OperationSourceRecord")).map(row => row._id).sort(), t.rowIds.slice(1).sort());
      await counts(f, 1, 2, 1); assert.deepEqual(entries, []);
    });

    await scenario("notion sourceType candidate authentication: damaged native prior-run companion rejects without staging repair", async f => {
      const seed = newTrace("candidate-seed"); const seedResponse = await f.invoke(runtime.POST, seed);
      const id = await normal(f, seed, seedResponse);
      // Syntactically valid companion but wrong HMAC: filtered equality alone would miss this run.
      const changed = await f.store.collection("DataImportRun").updateOne({ _id: id }, { $set: { sourceNamePiiIndex: "0".repeat(64) } });
      assert.equal(changed.modifiedCount, 1);
      const before = await f.snapshot(["DataImportRun", "OperationSourceRecord"]);
      const t = newTrace("candidate-authentication");
      const { value: response, entries } = await captureLogs(() => f.invoke(runtime.POST, t));
      await failureBody(response); assertOnce(t); await assertAudit(f, response, t);
      assert.deepEqual([t.callbacks, t.commits, t.aborted, t.runIds.length, t.rowIds.length], [1, 0, 1, 0, 0]);
      assert.deepEqual(await f.snapshot(["DataImportRun", "OperationSourceRecord"]), before);
      await counts(f, 1, 2, 2); assert.deepEqual(entries, []);
    });

    for (const lane of ["recovered-200", "terminal-400"] as const) {
      await scenario(`native successful commit THEN injected ACK fault: ${lane}; committed full state is mandatory`, async f => {
        const t = newTrace(lane); let observedBeforeFault = 0;
        t.commitFault = async (_session, delegate) => {
          await delegate(); // The native server has acknowledged commit, not just staged writes.
          if (t.commits !== 1) return;
          const runId = t.runIds[0]; uuid(runId);
          await counts(f, 1, 2, 0); await assertWholeRun(f, t, runId);
          observedBeforeFault++; t.events.push("independent-full-state-before-ack-fault");
          throw fault(lane === "recovered-200" ? 91 : 50, "UnknownTransactionCommitResult");
        };
        const { value: response, entries } = await captureLogs(() => f.invoke(runtime.POST, t));
        if (lane === "recovered-200") await normal(f, t, response);
        else { await failureBody(response); assertOnce(t); await assertAudit(f, response, t); await assertWholeRun(f, t, t.runIds[0]); }
        assert.equal(observedBeforeFault, 1); assert.equal(t.callbacks, 1); assert.equal(t.runIds.length, 1); assert.equal(t.rowIds.length, 2);
        assert.equal(t.commits, lane === "recovered-200" ? 2 : 1);
        assert.equal(t.committed, t.commits); assert.equal(t.aborted, 0);
        await counts(f, 1, 2, 1); assert.deepEqual(entries, []);
      });
    }

    await scenario("unresolved commit classification: labelled PRE-DISPATCH injection, no native commit-success claim", async f => {
      const t = newTrace("unknown-before-dispatch"); let observedPending = 0;
      t.commitFault = async session => {
        assert.equal(session.inTransaction(), true); assert.equal(t.rowIds.length, 2);
        assert.equal((await f.store.collection("OperationSourceRecord").find({}, { session }).toArray()).length, 2);
        // Independent observer cannot see the uncommitted complete transaction.
        await counts(f, 0, 0, 0); observedPending++;
        throw fault(50, "UnknownTransactionCommitResult");
      };
      const { value: response, entries } = await captureLogs(() => f.invoke(runtime.POST, t));
      await failureBody(response); assertOnce(t); await assertAudit(f, response, t);
      assert.equal(observedPending, 1); assert.deepEqual([t.callbacks, t.commits, t.committed], [1, 1, 0]);
      // This controlled pre-dispatch schedule resolves to absent after real endSession cleanup.
      // It does NOT reproduce a lost server reply or prove all unknown outcomes are rollbacks.
      const runs = await f.raw("DataImportRun"), rows = await f.raw("OperationSourceRecord");
      assert.ok((runs.length === 0 && rows.length === 0) || (runs.length === 1 && rows.length === 2), "partial staging forbidden for unknown outcome");
      assert.deepEqual([runs.length, rows.length], [0, 0], "fixture-specific pre-dispatch schedule must not commit");
      assert.equal(t.aborted, 1); await counts(f, 0, 0, 1); assert.deepEqual(entries, []);
    });

    await scenario("actual withActivity finally awaits independent native request audit before POST settles", async f => {
      const t = newTrace("audit-await"), entered = deferred(), release = deferred(); let settled = false;
      t.beforeAudit = async () => { entered.resolve(); await bounded(release.promise); };
      const pending = f.invoke(runtime.POST, t); void pending.then(() => { settled = true; }, () => { settled = true; });
      try {
        await bounded(entered.promise); assert.equal(t.committed, 1);
        await counts(f, 1, 2, 0); await assertWholeRun(f, t, t.runIds[0]);
        await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false);
        release.resolve(); const response = await bounded(pending);
        await normal(f, t, response); await counts(f, 1, 2, 1); assert.equal(settled, true);
      } finally { release.resolve(); await Promise.allSettled([pending]); }
    });

    await scenario("driver fault at native audit insert: actual audit repository + wrapper swallow once; HTTP200 and committed staging survive", async f => {
      const t = newTrace("audit-insert-fault"); t.auditInsertFault = fault(91);
      const { value: response, entries } = await captureLogs(() => f.invoke(runtime.POST, t));
      const id = await responseBody(response, t); assertOnce(t); await assertWholeRun(f, t, id);
      assert.equal(t.auditInserts, 1); assert.equal(t.committed, 1);
      assert.deepEqual(entries, [{ level: "error", values: ["[activity] API request log write failed"] }]);
      await counts(f, 1, 2, 0); uuid(response.headers.get("X-Request-Id"));
    });

    await scenario("literal oracle negative controls reject missing/extra/changed fields, duplicate counts, null/empty and array order", async f => {
      const t = newTrace("oracle-controls"); const response = await f.invoke(runtime.POST, t);
      const id = await normal(f, t, response); await counts(f, 1, 2, 1);
      const run = decodeMongoRuntimeDocument("DataImportRun", (await f.raw("DataImportRun"))[0]);
      const rows = (await f.raw("OperationSourceRecord")).map(row => decodeMongoRuntimeDocument("OperationSourceRecord", row));
      const first = rows.find(row => row.sourceRowNumber === 2)!;
      for (const change of [
        (row: Record<string, unknown>) => { delete row.sourceType; },
        (row: Record<string, unknown>) => { row.unexpected = true; },
        (row: Record<string, unknown>) => { row.rowCount = 1; },
        (row: Record<string, unknown>) => { row.notes = ""; },
        (row: Record<string, unknown>) => { row.validationLogs = [{ rowNumber: 2, errors: ["wrong"] }]; }
      ]) {
        const changed = structuredClone(run); change(changed);
        assert.throws(() => assertRun(changed, id, t.from, t.to));
      }
      assert.throws(() => assertSourceRow({ ...first, rowSnapshot: {} }, id, t.from, t.to, 0));
      assert.throws(() => assertSourceRow({ ...first, operationSessionId: id }, id, t.from, t.to, 0));
      assert.ok(t.readResult);
      for (const alter of [
        (result: typeof t.readResult) => { result!.parsed.rows.reverse(); },
        (result: typeof t.readResult) => { result!.parsed.rows.push(structuredClone(result!.parsed.rows[0])); },
        (result: typeof t.readResult) => { result!.parsed.rows.pop(); },
        (result: typeof t.readResult) => { result!.rowCount = 1; },
        (result: typeof t.readResult) => { result!.parsed.rows[0].unmappedFields = { ignoredSyntheticProperty: "unexpected retention" }; }
      ]) {
        const changed = structuredClone(t.readResult); alter(changed);
        assert.throws(() => assertReader(changed));
      }
      assertReader(t.readResult);
      // JSON object key order is not a semantic difference.
      assertRun(Object.fromEntries(Object.entries(run).reverse()), id, t.from, t.to);
    });
  } finally {
    try { await harness?.close(); }
    finally { runtime.restore(); }
  }
});
