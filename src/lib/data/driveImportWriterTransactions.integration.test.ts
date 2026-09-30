import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { BSON, FindCursor, MongoServerError } from "mongodb";
import { MongoDriveImportWriterRepository, prepareMongoDriveImportWriter, DRIVE_IMPORT_WRITER_MODELS } from "./mongoDriveImportWriterRepository";
import { encodeMongoRuntimeDocument, MongoJsonNull, type MongoRuntimeDocument } from "./mongoRuntimeCodec";
import { type MongoRow } from "./mongoOperationStore";
import { ARGS, DRIVER_CANARY, ERROR_RESULT, INPUT, SCAN_SUMMARY, SOURCE_CANARY, ZERO,
  assertRows, expectedOperation, readerResult, readerRun, resultRow, runRow, scanPayload, time, uuid } from "./driveImportWriterTransactionLiterals.fixture";
import { EXACT_URI, OPT_IN, assertTrace, failure, newTrace, observe, openHarness, seedRow, type Fixture, type Trace } from "./driveImportWriterTransactionHarness.fixture";
import type { DriveImportSummary } from "./driveImportWriterRepository";

function serverError(code: number, label?: string) {
  const error = new MongoServerError({ code, errmsg: DRIVER_CANARY }); if (label) error.addErrorLabel(label); return error;
}
function deferred() {
  let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SYNTHETIC_BARRIER_TIMEOUT")), 15_000);
  })]); } finally { clearTimeout(timer); }
}
function observedRun(t: Trace, summary: DriveImportSummary | null = SCAN_SUMMARY, count = 1): MongoRow {
  assert.equal(t.runAttempts.length, 1); const run = t.runAttempts[0]; uuid(run._id);
  const startedAt = time(run.startedAt, t.from, t.to);
  const finishedAt = summary ? time(t.finishes.at(-1), t.from, t.to) : null;
  return runRow(run._id, startedAt, summary, summary ? (summary.errors ? "COMPLETED_WITH_ERRORS" : "COMPLETED") : "PENDING", finishedAt, count);
}
function observedResult(t: Trace, f: Fixture, index = 0, operationIndex = 0, override: MongoRow = {}): MongoRow {
  const row = t.resultAttempts[index]; assert.ok(row); uuid(row._id);
  return resultRow(row._id, time(row.createdAt, t.from, t.to), t.runAttempts[0]._id, f.operations[operationIndex], override);
}
async function assertReader(f: Fixture, run: MongoRow, rows: MongoRow[]) {
  assert.deepEqual(await f.history.readLatestDriveImportRun(), readerRun(run, rows));
  if (rows.length === 1) assert.deepEqual(await f.history.readLatestDriveImportResult(rows[0].operationId as string), readerResult(run, rows[0]));
}

test("Drive writer native transactions: exact owned opt-in, full state and real reader", {
  skip: !process.env[OPT_IN], timeout: 300_000
}, async root => {
  assert.equal(process.env[OPT_IN], EXACT_URI, `${OPT_IN} must be the exact owned synthetic endpoint; no skips`);
  const harness = await openHarness(EXACT_URI);
  try {
    async function scenario(name: string, work: (f: Fixture, t: Trace) => Promise<void>, operationIds?: string[]) {
      await root.test(name, async sub => {
        const f = await harness.fixture(operationIds), t = newTrace();
        sub.after(async () => { assertTrace(t); await f.assertUnchanged(); });
        await work(f, t);
      });
    }

    await root.test("negative controls: same complete comparator rejects extra/missing/replaced/duplicate/orphan/FK/field/count mutations", () => {
      const id = randomUUID(), runId = randomUUID(), date = new Date("2032-01-01T00:00:00.000Z");
      const run = runRow(runId, date), row = resultRow(id, date, runId, expectedOperation(randomUUID()));
      assertRows([run], [run]); assertRows([row], [row]);
      for (const bad of [[run, { ...run, id: randomUUID() }], [], [{ ...run, id: randomUUID() }], [run, run], [{ ...run, operationCount: 9 }]]) {
        assert.throws(() => assertRows(bad, [run]));
      }
      const missing = { ...row }; delete missing.inputKind;
      for (const bad of [[row, { ...row, id: randomUUID() }], [], [{ ...row, id: randomUUID() }], [row, row],
        [{ ...row, runId: randomUUID() }], [{ ...row, operationSessionId: randomUUID() }], [missing],
        [{ ...row, unapprovedField: true }], [{ ...row, inputValue: null }], [{ ...row, candidateCount: 2 }]]) {
        assert.throws(() => assertRows(bad, [row]));
      }
      const t = newTrace(); observe(t, () => assert.equal(1, 2)); assert.throws(() => assertTrace(t));
      for (const canary of [DRIVER_CANARY, SOURCE_CANARY]) {
        const logged = newTrace(); logged.logs.push(canary); assert.throws(() => assertTrace(logged));
      }
    });

    await scenario("normal source-contract workflow: literal counters, encrypted raw, whole reader DTO, borrowed close", async (f, t) => {
      const result = await f.invoke(t);
      assert.deepEqual(result, { runId: t.runAttempts[0]._id, status: "completed", summary: SCAN_SUMMARY });
      assert.deepEqual([t.source, t.search, t.transactions, t.callbacks, t.commits, t.ended], [1, 0, 1, 1, 1, 1]);
      assert.deepEqual(t.sourceInputs, [INPUT.value]);
      const run = observedRun(t), row = observedResult(t, f);
      await f.assertStored([run], [row]); await assertReader(f, run, [row]);
      const scans = t.commands.filter(event => event.commandName === "find" && event.command.limit === 100);
      assert.ok(scans.length >= 3);
      for (const scan of scans) {
        assert.equal(scan.command.batchSize, 101); // installed driver adds one when limit===batchSize
        assert.equal(scan.command.singleBatch, true); assert.equal(scan.command.autocommit, false);
        assert.deepEqual(scan.command.sort instanceof Map ? [...scan.command.sort] : Object.entries(scan.command.sort), [["_id", 1]]);
        assert.ok(scan.command.maxTimeMS > 0 && scan.command.maxTimeMS <= 15_000);
      }
      assert.equal(t.commands.filter(event => event.commandName === "getMore").length, 0);
      const rawRun = (await f.raw("DriveImportRun"))[0], rawResult = (await f.raw("DriveImportResult"))[0];
      assert.equal(rawRun.status, "COMPLETED"); assert.match(rawRun.notes, /^pii:v1:/); assert.match(rawRun.notesPiiIndex, /^[a-f0-9]{64}$/);
      for (const field of ["inputValue", "folderId", "folderTitle", "folderUrl"]) assert.match(rawResult[field], /^pii:v1:/);
      assert.match(rawRun.summary.$json.__pii, /^pii:v1:/);
      for (const field of ["keyCandidates", "folderCandidates", "issues"]) assert.match(rawResult[field].$json.__pii, /^pii:v1:/);
      await f.repository.close(); assert.equal((await harness.client.db("admin").command({ ping: 1 }, { timeoutMS: 5000 })).ok, 1);
    });

    await scenario("create pending: explicit zeros, SQL-null summary and notes; finish changes only permitted fields", async (f, t) => {
      const id = await f.traced(t, () => f.repository.createRun(ARGS, 1));
      let run = observedRun(t, null); assert.equal(run.id, id); await f.assertStored([run], []); await assertReader(f, run, []);
      const before = (await f.raw("DriveImportRun"))[0]; assert.equal(before.summary, null); assert.equal(before.finishedAt, null);
      await f.traced(t, () => f.repository.finishRun(id, SCAN_SUMMARY, "completed"));
      run = runRow(id, before.startedAt, SCAN_SUMMARY, "COMPLETED", t.finishes[0]);
      const after = (await f.raw("DriveImportRun"))[0];
      const changed = new Set(["status", "finishedAt", "summary", "scannedRefCount", "scanFoundFolderCount", "scanIssueCount", "folderSearchCount",
        "folderSearchWithCandidatesCount", "avgSatisfactionCandidateCount", "instructorSatisfactionCandidateCount", "instructorCandidateCount", "suspiciousCandidateCount", "errorCount"]);
      for (const key of Object.keys(before)) if (!changed.has(key)) assert.deepEqual(after[key], before[key], key);
      const updates = t.commands.filter(event => event.commandName === "update"); assert.equal(updates.length, 1);
      assert.deepEqual(Object.keys(updates[0].command.updates[0].u), ["$set"]);
      assert.deepEqual(new Set(Object.keys(updates[0].command.updates[0].u.$set)), changed);
      assert.equal(updates[0].command.updates[0].upsert, false);
      await f.assertStored([run], []); await assertReader(f, run, []);
    });

    for (const mode of ["before-run", "after-run", "before-result", "after-result-abort", "before-finish", "after-finish"] as const) {
      await scenario(`native fault ${mode}: exact partial-state contract`, async (f, t) => {
        let injections = 0;
        if (mode === "before-run" || mode === "before-result") t.beforeInsert = async model => {
          if (!injections && model === (mode === "before-run" ? "DriveImportRun" : "DriveImportResult")) { injections++; throw serverError(2); }
        };
        if (mode === "after-run" || mode === "after-result-abort") t.afterInsert = async (model, row, session) => {
          if (injections || model !== (mode === "after-run" ? "DriveImportRun" : "DriveImportResult")) return;
          injections++;
          if (mode === "after-run") observe(t, () => assert.equal(model, "DriveImportRun"));
          const visible = await f.read.collection(model).findOne({ _id: row._id }, { timeoutMS: 5000 });
          observe(t, () => assert.equal(!!visible, mode === "after-run"));
          if (session) {
            const own = await f.store.collection(model).findOne({ _id: row._id }, { session });
            observe(t, () => assert.ok(own, "real inserted row visible inside transaction"));
          }
          throw serverError(2);
        };
        if (mode === "before-finish") t.beforeUpdate = async () => { injections++; throw serverError(2); };
        if (mode === "after-finish") t.afterUpdate = async () => {
          injections++; const run = await f.read.collection("DriveImportRun").findOne({ _id: t.runAttempts[0]._id }, { timeoutMS: 5000 });
          observe(t, () => assert.equal(run?.status, "COMPLETED")); throw serverError(2);
        };
        const caught = mode === "before-result" || mode === "after-result-abort";
        if (caught) {
          const result = await f.invoke(t); assert.deepEqual(result.summary, { ...SCAN_SUMMARY, errors: 1 });
        } else await failure(f.invoke(t));
        assert.equal(injections, 1);
        if (mode === "before-run") { assert.equal(t.source, 0); await f.assertStored([], []); return; }
        if (mode === "after-run") { assert.equal(t.source, 0); const run = observedRun(t, null); await f.assertStored([run], []); await assertReader(f, run, []); return; }
        assert.equal(t.source, 1);
        const run = observedRun(t, mode === "before-finish" ? null : caught ? { ...SCAN_SUMMARY, errors: 1 } : SCAN_SUMMARY);
        const row = observedResult(t, f, caught ? 1 : 0, 0, caught ? ERROR_RESULT : {});
        if (mode === "after-result-abort") { assert.ok(t.aborted >= 1); assert.notEqual(t.resultAttempts[0]._id, row.id); }
        await f.assertStored([run], [row]); await assertReader(f, run, [row]);
      });
    }

    await scenario("native callback retry after real insert: same ID/ciphertext, source and aggregation once", async (f, t) => {
      let injections = 0;
      t.afterInsert = async (model, row, session) => {
        if (model !== "DriveImportResult" || injections) return; injections++;
        const own = await f.store.collection(model).findOne({ _id: row._id }, { session });
        const outside = await f.read.collection(model).findOne({ _id: row._id }, { timeoutMS: 5000 });
        observe(t, () => { assert.ok(own); assert.equal(outside, null); });
        throw serverError(112, "TransientTransactionError");
      };
      assert.deepEqual((await f.invoke(t)).summary, SCAN_SUMMARY);
      assert.equal(injections, 1); assert.deepEqual([t.source, t.transactions, t.callbacks, t.commits, t.aborted, t.ended], [1, 1, 2, 1, 1, 1]);
      assert.equal(t.resultAttempts.length, 2); assert.deepEqual(t.resultAttempts[0], t.resultAttempts[1]);
      const run = observedRun(t), row = observedResult(t, f); await f.assertStored([run], [row]); await assertReader(f, run, [row]);
    });

    for (const mode of ["recovered", "terminal-after-real-commit", "explicit-unresolved-before-dispatch"] as const) {
      await scenario(`commit acknowledgement: ${mode}`, async (f, t) => {
        let injections = 0;
        t.commitFault = async (_session, commit) => {
          if (injections) return commit(); injections++;
          if (mode !== "explicit-unresolved-before-dispatch") await commit();
          const row = await f.read.collection("DriveImportResult").findOne({ _id: t.resultAttempts[0]._id }, { timeoutMS: 5000 });
          observe(t, () => assert.equal(!!row, mode !== "explicit-unresolved-before-dispatch"));
          // code 50 is an explicit terminal labelled fault, not a simulated lost network ACK.
          throw serverError(mode === "recovered" ? 91 : 50, "UnknownTransactionCommitResult");
        };
        const summary = mode === "recovered" ? SCAN_SUMMARY : { ...SCAN_SUMMARY, errors: 1 };
        assert.deepEqual((await f.invoke(t)).summary, summary); assert.equal(injections, 1); assert.equal(t.source, 1);
        const run = observedRun(t, summary);
        const rows = mode === "recovered" ? [observedResult(t, f)]
          : mode === "terminal-after-real-commit" ? [observedResult(t, f), observedResult(t, f, 1, 0, ERROR_RESULT)]
          : [observedResult(t, f, 1, 0, ERROR_RESULT)];
        assert.deepEqual([t.transactions, t.callbacks, t.resultAttempts.length], mode === "recovered" ? [1, 1, 1] : [2, 2, 2]);
        assert.equal(t.commits, 2); assert.equal(t.committed, mode === "explicit-unresolved-before-dispatch" ? 1 : 2);
        if (mode === "terminal-after-real-commit") assert.notEqual(rows[0].id, rows[1].id);
        await f.assertStored([run], rows); await assertReader(f, run, rows);
      });
    }

    await scenario("second result and catch write fail: first committed row remains, pending persisted zeros", async (f, t) => {
      let injections = 0;
      t.beforeInsert = async model => { if (model === "DriveImportResult" && t.resultAttempts.length >= 2) { injections++; throw serverError(2); } };
      await failure(f.invoke(t)); assert.equal(injections, 2); assert.equal(t.source, 2); assert.equal(t.finishes.length, 0);
      const run = observedRun(t, null, 2), row = observedResult(t, f);
      await f.assertStored([run], [row]); await assertReader(f, run, [row]);
    }, ["SYNTHETIC-A", "SYNTHETIC-B"]);

    await scenario("concurrent workers plus native callback retry keep stable per-result identity", async (f, t) => {
      const bothInserted = deferred(); let inserts = 0, injections = 0, retriedId = "";
      t.afterInsert = async (model, row) => {
        if (model !== "DriveImportResult") return;
        const n = ++inserts; if (n === 2) bothInserted.resolve();
        if (n === 1) { retriedId = row._id; await bounded(bothInserted.promise); injections++; throw serverError(112, "TransientTransactionError"); }
      };
      const result = await f.invoke(t, { ...ARGS, concurrency: 2 });
      const summary = { ...SCAN_SUMMARY, avgSatisfactionCandidates: 2, instructorCandidates: 2, scanFoundFolder: 2,
        scanIssues: 2, scannedRefs: 2, suspiciousCandidateCount: 4,
        suspicious: { badInstructorFragments: 0, clockInstructorCandidates: 2, zeroSatisfactionCandidates: 2 } };
      assert.deepEqual(result.summary, summary); assert.equal(injections, 1);
      assert.deepEqual([t.source, t.transactions, t.callbacks, t.resultAttempts.length, t.ended], [2, 2, 3, 3, 2]);
      const retried = t.resultAttempts.filter(row => row._id === retriedId);
      assert.equal(retried.length, 2); assert.deepEqual(retried[0], retried[1]);
      const rows = f.operations.map((operation, index) => {
        const attempt = t.resultAttempts.findIndex(row => row.operationSessionId === operation.id); assert.ok(attempt >= 0);
        return observedResult(t, f, attempt, index);
      });
      const run = observedRun(t, summary, 2); await f.assertStored([run], rows);
    }, ["SYNTHETIC-A", "SYNTHETIC-B"]);

    await scenario("Promise.all rejection does not cancel another worker; explicitly drain its commit", async (f, t) => {
      const release = deferred(), entered = deferred(), drained = deferred();
      t.scanFault = async () => { if (t.source === 1) { await bounded(entered.promise); throw new Error(SOURCE_CANARY); }
        entered.resolve(); await bounded(release.promise); return scanPayload(); };
      t.beforeInsert = async (model, row) => { if (model === "DriveImportResult" && row.operationId === "SYNTHETIC-A") throw serverError(2); };
      t.afterEnd = async () => { if (t.committed > 0) drained.resolve(); };
      try { await failure(f.invoke(t, { ...ARGS, concurrency: 2 })); }
      finally { release.resolve(); await bounded(drained.promise); t.to = Date.now(); }
      assert.equal(t.source, 2); assert.equal(t.finishes.length, 0);
      const index = t.resultAttempts.findIndex(row => row.operationId === "SYNTHETIC-B"); assert.ok(index >= 0);
      const run = observedRun(t, null, 2), row = observedResult(t, f, index, 1);
      await f.assertStored([run], [row]); await assertReader(f, run, [row]);
    }, ["SYNTHETIC-A", "SYNTHETIC-B"]);

    await root.test("native A/B namespaces: overlapping sources, A partial/catch failure, B success, both recover with new runs", async sub => {
      const bindingA = { inputValue: "https://drive.example.invalid/synthetic-scope-A", folderTitle: "Synthetic source A folder" };
      const bindingB = { inputValue: "https://drive.example.invalid/synthetic-scope-B", folderTitle: "Synthetic source B folder" };
      const a = await harness.fixture(["SYNTHETIC-A-1", "SYNTHETIC-A-2"], bindingA);
      const b = await harness.fixture(["SYNTHETIC-B-1"], bindingB);
      assert.notEqual(a.options.namespace, b.options.namespace);
      assert.equal(a.options.databaseName, b.options.databaseName); // same owned replica/DB, distinct real storage namespaces
      const ta = newTrace(), tb = newTrace(), ra = newTrace(), rb = newTrace();
      sub.after(async () => { for (const trace of [ta, tb, ra, rb]) assertTrace(trace); await a.assertUnchanged(); await b.assertUnchanged(); });
      const overrides = (binding: typeof bindingA) => ({ inputValue: binding.inputValue, folderTitle: binding.folderTitle, folderUrl: binding.inputValue });
      const twoScans: DriveImportSummary = {
        avgSatisfactionCandidates: 2, errors: 0, folderSearches: 0, folderSearchWithCandidates: 0,
        instructorCandidates: 2, instructorSatisfactionCandidates: 0, scanFoundFolder: 2,
        scanIssues: 2, scannedRefs: 2, suspiciousCandidateCount: 4,
        suspicious: { badInstructorFragments: 0, clockInstructorCandidates: 2, zeroSatisfactionCandidates: 2 }
      };
      function overlap() {
        const entered = new Set<string>(), both = deferred(), release = deferred(); let active = 0, maximum = 0;
        return { both, release, entered, maximum: () => maximum,
          async enter(lane: string) {
            assert.ok(!entered.has(lane)); entered.add(lane); active++; maximum = Math.max(maximum, active);
            if (entered.size === 2) both.resolve();
            try { await bounded(release.promise); } finally { active--; }
          },
          assertDrained() { assert.equal(active, 0); assert.equal(maximum, 2); assert.deepEqual([...entered].sort(), ["A", "B"]); }
        };
      }
      const first = overlap(); let catchFailures = 0;
      ta.scanFault = async payload => {
        if (ta.source === 1) return payload;
        await first.enter("A"); throw new Error(SOURCE_CANARY);
      };
      tb.scanFault = async payload => { await first.enter("B"); return payload; };
      ta.beforeInsert = async (model, row) => {
        if (model === "DriveImportResult" && row.operationId === "SYNTHETIC-A-2") {
          observe(ta, () => assert.equal(row.resultKind, "error")); catchFailures++; throw serverError(2);
        }
      };
      // Attach handlers immediately so the expected A rejection cannot become unhandled.
      const firstSettled = Promise.allSettled([a.invoke(ta), b.invoke(tb)]);
      try {
        await bounded(first.both.promise); assert.equal(first.maximum(), 2);
        // At the overlap barrier A's earlier append has committed, B has not appended yet.
        await a.assertStored([runRow(ta.runAttempts[0]._id, ta.runAttempts[0].startedAt, null, "PENDING", null, 2)],
          [resultRow(ta.resultAttempts[0]._id, ta.resultAttempts[0].createdAt, ta.runAttempts[0]._id, a.operations[0], overrides(bindingA))]);
        await b.assertStored([runRow(tb.runAttempts[0]._id, tb.runAttempts[0].startedAt)], []);
      } finally { first.release.resolve(); await bounded(firstSettled); }
      const [failedA, completedB] = await firstSettled;
      assert.equal(failedA.status, "rejected");
      if (failedA.status === "rejected") await failure(Promise.reject(failedA.reason));
      assert.equal(completedB.status, "fulfilled");
      if (completedB.status === "fulfilled") assert.deepEqual(completedB.value, { runId: tb.runAttempts[0]._id, status: "completed", summary: SCAN_SUMMARY });
      first.assertDrained(); assert.equal(catchFailures, 1);
      assert.deepEqual([ta.source, ta.resultAttempts.length, ta.finishes.length, tb.source, tb.resultAttempts.length], [2, 2, 0, 1, 1]);
      const oldA = observedRun(ta, null, 2), oldARow = observedResult(ta, a, 0, 0, overrides(bindingA));
      const oldB = observedRun(tb), oldBRow = observedResult(tb, b, 0, 0, overrides(bindingB));
      await a.assertStored([oldA], [oldARow]); await b.assertStored([oldB], [oldBRow]);
      await assertReader(a, oldA, [oldARow]); await assertReader(b, oldB, [oldBRow]);

      const recovery = overlap();
      ra.scanFault = async payload => {
        if (ra.source === 1) { await recovery.enter("A"); return payload; }
        // The extra excluded candidate makes reader order explicit without inventing an ID tie-breaker.
        return { ...payload, candidates: [...payload.candidates, { ...payload.candidates[2], id: "synthetic-A-recovery-extra" }] };
      };
      rb.scanFault = async payload => { await recovery.enter("B"); return payload; };
      const recovered = Promise.allSettled([a.invoke(ra), b.invoke(rb)]);
      try { await bounded(recovery.both.promise); assert.equal(recovery.maximum(), 2); }
      finally { recovery.release.resolve(); await bounded(recovered); }
      const [recoveredA, recoveredB] = await recovered;
      assert.equal(recoveredA.status, "fulfilled"); assert.equal(recoveredB.status, "fulfilled");
      if (recoveredA.status === "fulfilled") assert.deepEqual(recoveredA.value, { runId: ra.runAttempts[0]._id, status: "completed", summary: twoScans });
      if (recoveredB.status === "fulfilled") assert.deepEqual(recoveredB.value, { runId: rb.runAttempts[0]._id, status: "completed", summary: SCAN_SUMMARY });
      recovery.assertDrained();
      const newA = observedRun(ra, twoScans, 2), newB = observedRun(rb);
      const newARows = [observedResult(ra, a, 0, 0, overrides(bindingA)), observedResult(ra, a, 1, 1, { ...overrides(bindingA), candidateCount: 4 })];
      const newBRow = observedResult(rb, b, 0, 0, overrides(bindingB));
      const independentRunIds = [oldA.id, oldB.id, newA.id, newB.id];
      assert.equal(new Set(independentRunIds).size, 4);
      // Compare ALL historical and recovery rows per namespace; never derive the expected ID set from a final query.
      await a.assertStored([oldA, newA], [oldARow, ...newARows]);
      await b.assertStored([oldB, newB], [oldBRow, newBRow]);
      await assertReader(a, newA, [newARows[1], newARows[0]]); await assertReader(b, newB, [newBRow]);
      for (const [fixture, binding, traces, counts] of [[a, bindingA, [ta, ra], [2, 2]], [b, bindingB, [tb, rb], [1, 1]]] as const) {
        for (const [index, trace] of traces.entries()) {
          assert.equal(trace.source, counts[index]); assert.equal(trace.search, 0);
          assert.deepEqual(trace.sourceInputs, Array(counts[index]).fill(binding.inputValue));
          assert.deepEqual(trace.sourceBindings, Array(counts[index]).fill(fixture.options.namespace));
          for (const event of trace.commands) {
            if (["find", "insert", "update", "delete", "findAndModify"].includes(event.commandName)) {
              assert.ok(String(event.command[event.commandName]).startsWith(`${fixture.options.namespace}_`), "native command crossed source/writer namespace");
            }
          }
        }
      }
    });

    for (const thrown of [new Error(SOURCE_CANARY), "synthetic-non-error-source"]) {
      await scenario(`source failure stores original encrypted text (${typeof thrown})`, async (f, t) => {
        t.scanFault = async () => { throw thrown; };
        const summary = { ...ZERO, scannedRefs: 1, errors: 1 };
        assert.deepEqual((await f.invoke(t)).summary, summary);
        const run = observedRun(t, summary), row = observedResult(t, f, 0, 0, { ...ERROR_RESULT, error: thrown instanceof Error ? thrown.message : thrown });
        await f.assertStored([run], [row]); await assertReader(f, run, [row]);
        assert.match((await f.raw("DriveImportResult"))[0].error, /^pii:v1:/);
      });
    }

    await scenario("zero workers preserve operationCount but write no results", async (f, t) => {
      assert.deepEqual((await f.invoke(t, { ...ARGS, concurrency: 0 })).summary, ZERO);
      assert.equal(t.source, 0); assert.equal(t.transactions, 0);
      const run = observedRun(t, ZERO); await f.assertStored([run], []); await assertReader(f, run, []);
    });

    await scenario("FK absent run/session fail; soft-deleted session still exists and preserves loaded snapshot", async (f, t) => {
      const operation = f.operations[0];
      await failure(f.traced(t, () => f.repository.appendResult(randomUUID(), operation, INPUT, { resultKind: "error" })));
      const runId = await f.traced(t, () => f.repository.createRun(ARGS, 1));
      await failure(f.traced(t, () => f.repository.appendResult(runId, { ...operation, id: randomUUID() }, INPUT, { resultKind: "error" })));
      assert.equal(t.resultAttempts.length, 0); await f.assertStored([runRow(runId, t.runAttempts[0].startedAt)], []);
      await f.store.collection("OperationSession").updateOne({ _id: operation.id }, { $set: { deletedAt: new Date(), operationId: "SYNTHETIC-CHANGED-AFTER-LOAD" } });
      await f.rebaselineBusiness();
      await f.traced(t, () => f.repository.appendResult(runId, operation, INPUT, { resultKind: "error" }));
      const run = runRow(runId, t.runAttempts[0].startedAt), row = observedResult(t, f, 0, 0, { ...ERROR_RESULT, error: null });
      await f.assertStored([run], [row]); await assertReader(f, run, [row]);
    });

    await scenario("load snapshot: all parents and sessions retain first read state during concurrent edits", async (f, t) => {
      let changes = 0; const original = FindCursor.prototype.toArray;
      const hook = mock.method(FindCursor.prototype, "toArray", async function(this: FindCursor) {
        const batch = await original.call(this);
        if (!changes && this.namespace.collection === f.store.collection("OperationSession").collectionName && batch.length) {
          changes++;
          await f.read.collection("Course").updateOne({ _id: f.courseId }, { $set: { name: "Synthetic concurrent course" } });
          await f.read.collection("Company").updateOne({ _id: f.companyId }, { $set: { name: "Synthetic concurrent company" } });
          await f.read.collection("OperationSession").updateOne({ _id: f.operations[0].id }, { $set: { deletedAt: new Date() } });
        }
        return batch;
      });
      try { assert.deepEqual(await f.traced(t, () => f.repository.loadOperations(0)), f.operations); }
      finally { hook.mock.restore(); await f.rebaselineBusiness(); }
      assert.equal(changes, 1);
      const finds = t.commands.filter(event => event.commandName === "find");
      assert.ok(finds.length >= 3); assert.equal(finds[0].command.readConcern.level, "snapshot");
      for (const find of finds) { assert.deepEqual(find.command.lsid, finds[0].command.lsid); assert.equal(find.command.autocommit, false); }
      assert.equal(t.commands.filter(event => event.commandName === "getMore").length, 0);
      await f.assertStored([], []);
    });

    await scenario("load inner join before limit; date and C-byte ordering; no orphan consumes take", async (f, t) => {
      const orphanCourse = randomUUID();
      await f.put("Course", { id: orphanCourse, companyId: randomUUID(), processSeq: 2, courseId: "SYNTHETIC-ORPHAN", name: "Synthetic orphan" });
      for (const [index, courseRecordId] of [orphanCourse, randomUUID()].entries()) await f.put("OperationSession", {
        id: randomUUID(), courseRecordId, operationId: `SYNTHETIC-ORPHAN-${index}`, startDate: new Date("2031-01-01T00:00:00.000Z")
      });
      await f.rebaselineBusiness();
      const expected = [f.operations[1], f.operations[0], f.operations[2]];
      assert.deepEqual(await f.traced(t, () => f.repository.loadOperations(0)), expected);
      assert.deepEqual(await f.traced(t, () => f.repository.loadOperations(1)), expected.slice(0, 1));
      const saved = process.env.TZ;
      try {
        process.env.TZ = "Asia/Seoul";
        assert.deepEqual(await f.traced(t, () => f.repository.loadOperations(1)), [{ ...expected[0], startDate: "2031-12-31", endDate: "2031-12-31" }]);
      } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
      await f.assertStored([], []);
    }, ["SYNTHETIC-a", "SYNTHETIC-Z", "SYNTHETIC-가"]);

    await scenario("SQL bigint upper bound is rejected before native IO or source/create", async (f, t) => {
      await failure(f.invoke(t, { ...ARGS, limit: 2 ** 63 }));
      assert.equal(t.commands.length, 0); assert.equal(t.source, 0); assert.equal(t.runAttempts.length, 0); await f.assertStored([], []);
    });

    await scenario("JSON roundtrip: omissions, array undefined/nonfinite, null via toJSON, nullable result dates", async (f, t) => {
      const id = await f.traced(t, () => f.repository.createRun(ARGS, 1));
      const operation = { ...f.operations[0], startDate: "", endDate: "" };
      await f.traced(t, () => f.repository.appendResult(id, operation, INPUT, { resultKind: "error",
        keyCandidates: [{ omit: undefined, finite: 1, nan: NaN, infinity: Infinity }, undefined],
        folderCandidates: { toJSON: () => null }, issues: null }));
      const row = resultRow(t.resultAttempts[0]._id, t.resultAttempts[0].createdAt, id, operation, { ...ERROR_RESULT,
        error: null, keyCandidates: [{ finite: 1, nan: null, infinity: null }, null], folderCandidates: MongoJsonNull });
      await f.assertStored([runRow(id, t.runAttempts[0].startedAt)], [row]);
    });

    await scenario("BigInt/cyclic serialization rejects before append IO; missing finish succeeds but still serializes", async (f, t) => {
      const cycle: unknown[] = []; cycle.push(cycle);
      for (const keyCandidates of [[BigInt(1)], cycle]) {
        await failure(f.traced(t, () => f.repository.appendResult(randomUUID(), f.operations[0], INPUT, { resultKind: "error", keyCandidates })));
      }
      assert.equal(t.commands.length, 0); assert.equal(t.transactions, 0);
      await f.traced(t, () => f.repository.finishRun(randomUUID(), ZERO, "completed"));
      const before = t.commands.length;
      await failure(f.traced(t, () => f.repository.finishRun(randomUUID(), { ...ZERO, extra: BigInt(1) } as DriveImportSummary, "completed")));
      assert.equal(t.commands.length, before); assert.equal(t.finishes.length, 0); await f.assertStored([], []);
    });

    await scenario("damaged run notes: intentional stricter authentication than PG updateMany, no partial finish", async (f, t) => {
      const id = await f.traced(t, () => f.repository.createRun(ARGS, 1));
      await f.store.collection("DriveImportRun").updateOne({ _id: id }, { $set: { notesPiiIndex: "0".repeat(64) } });
      const before = await f.raw("DriveImportRun");
      await failure(f.traced(t, () => f.repository.finishRun(id, SCAN_SUMMARY, "completed")));
      assert.deepEqual(await f.raw("DriveImportRun"), before); assert.equal(t.finishes.length, 0);
    });

    for (const keyMode of ["malformed", "wrong-valid-encryption", "wrong-valid-index"] as const) {
      await scenario(`privacy failure ${keyMode}: fixed error, source0 and business/run/result unchanged`, async (f, t) => {
        const key = keyMode === "wrong-valid-index" ? "PII_INDEX_KEY" : "PII_ENCRYPTION_KEYS", saved = process.env[key];
        try {
          process.env[key] = keyMode === "malformed" ? "{" : keyMode === "wrong-valid-index" ? randomBytes(32).toString("base64")
            : JSON.stringify({ drivewriterfixture: randomBytes(32).toString("base64") });
          if (keyMode === "malformed") await failure(MongoDriveImportWriterRepository.open(f.options));
          else await failure(f.invoke(t));
        } finally { if (saved === undefined) delete process.env[key]; else process.env[key] = saved; }
        assert.equal(t.source, 0); assert.equal(t.runAttempts.length, 0); await f.assertStored([], []);
      });
    }

    for (const model of DRIVE_IMPORT_WRITER_MODELS) for (const bad of ["metadata", "historical-document"] as const) {
      await scenario(`prepare prechecks all existing: ${model} ${bad} plus missing model => no DDL/repair`, async (f, t) => {
        const missing = model === "DriveImportResult" ? "Company" : "DriveImportResult";
        await f.store.collection(missing).drop({ timeoutMS: 5000 });
        if (bad === "metadata") await f.store.db.command({ collMod: f.store.collection(model).collectionName, validationAction: "warn" }, { timeoutMS: 5000 });
        else await f.store.collection(model).insertOne({ _id: randomUUID(), syntheticInvalid: true } as MongoRuntimeDocument,
          { bypassDocumentValidation: true, timeoutMS: 5000 });
        await f.rebaselineBusiness();
        const snapshot = async () => ({
          metadata: await f.store.db.listCollections({ name: { $regex: `^${f.options.namespace}_` } }, { timeoutMS: 5000 }).toArray(),
          rows: await f.raw(model)
        });
        const before = await snapshot();
        await failure(f.traced(t, () => prepareMongoDriveImportWriter(f.options)));
        assert.deepEqual(await snapshot(), before);
        assert.equal(await f.store.db.listCollections({ name: f.store.collection(missing).collectionName }, { timeoutMS: 5000 }).hasNext(), false);
        assert.equal(t.commands.filter(event => ["create", "createIndexes", "collMod", "insert", "update"].includes(event.commandName)).length, 0);
      }, []);
    }

    await scenario("unknown unique same-key/different-collation constraint rejected, no readiness repairs", async (f, t) => {
      await f.store.collection("Company").createIndex({ normalizedName: 1 }, {
        name: "synthetic_unknown_unique", unique: true, collation: { locale: "en", strength: 2 }, timeoutMS: 5000
      });
      await failure(f.traced(t, () => prepareMongoDriveImportWriter(f.options)));
      await failure(f.traced(t, () => MongoDriveImportWriterRepository.open(f.options)));
      assert.equal(t.commands.filter(event => ["create", "createIndexes", "collMod", "dropIndexes"].includes(event.commandName)).length, 0);
    }, []);

    await scenario("ready existing prepare/open are read-only; missing open never prepares", async (f, t) => {
      await f.traced(t, () => prepareMongoDriveImportWriter(f.options));
      await f.traced(t, () => MongoDriveImportWriterRepository.open(f.options));
      await failure(f.traced(t, () => MongoDriveImportWriterRepository.open({ ...f.options, namespace: `${f.options.namespace}_missing` })));
      assert.equal(t.commands.filter(event => ["create", "createIndexes", "collMod", "insert", "update"].includes(event.commandName)).length, 0);
      await f.assertStored([], []);
    });

    for (const dimension of ["rows", "raw-BSON-bytes"] as const) {
      await scenario(`native scan ${dimension} overflow fails before source or create; no silent limit truncation`, async (f, t) => {
        if (dimension === "rows") {
          // 20k wide session documents hit the byte cap first. The public load budget
          // includes referenced Course/Company rows, so use 6,667 valid joined triples:
          // 20,001 cumulative rows, with every full document/validator field preserved.
          const companyBase = encodeMongoRuntimeDocument("Company", seedRow("Company", {
            id: randomUUID(), name: "Synthetic budget company", normalizedName: "synthetic budget company"
          }));
          const courseBase = encodeMongoRuntimeDocument("Course", seedRow("Course", {
            id: randomUUID(), companyId: randomUUID(), processSeq: 2, courseId: "SYNTHETIC-BUDGET", name: "Synthetic budget course"
          }));
          const sessionBase = encodeMongoRuntimeDocument("OperationSession", seedRow("OperationSession", {
            id: randomUUID(), courseRecordId: randomUUID(), operationId: "SYNTHETIC-BUDGET"
          }));
          const rows: Record<"Company" | "Course" | "OperationSession", MongoRuntimeDocument[]> = {
            Company: [], Course: [], OperationSession: []
          };
          for (let index = 0; index < 6_666; index++) {
            const companyId = randomUUID(), courseId = randomUUID();
            rows.Company.push({ ...companyBase, _id: companyId, normalizedName: `synthetic budget ${index}` });
            rows.Course.push({ ...courseBase, _id: courseId, companyId, processSeq: index + 2, courseId: `SYNTHETIC-BUDGET-${index}` });
            rows.OperationSession.push({ ...sessionBase, _id: randomUUID(), courseRecordId: courseId, operationId: `SYNTHETIC-BUDGET-${index}` });
          }
          let plannedRows = 0, plannedBytes = 0;
          for (const model of ["Company", "Course", "OperationSession"] as const) {
            const existing = (await f.raw(model)).filter(row => model !== "OperationSession" || row.deletedAt === null);
            for (const row of [...existing, ...rows[model]]) { plannedRows++; plannedBytes += BSON.calculateObjectSize(row); }
          }
          assert.equal(plannedRows, 20_001);
          assert.ok(plannedBytes < 32 * 1024 * 1024, `row fixture must fit the byte budget: ${plannedBytes}`);
          for (const model of ["Company", "Course", "OperationSession"] as const) {
            for (let offset = 0; offset < rows[model].length; offset += 500) {
              await f.store.collection(model).insertMany(rows[model].slice(offset, offset + 500), { timeoutMS: 15_000 });
            }
          }
        } else {
          const base = encodeMongoRuntimeDocument("OperationSession", seedRow("OperationSession", {
            id: randomUUID(), courseRecordId: f.courseId, operationId: "SYNTHETIC-BUDGET-BASE",
            omName: "Synthetic OM", ldName: "Synthetic LD", driveLink: INPUT.value,
            specialNotes: "x".repeat(2 * 1024 * 1024)
          }));
          const batch = Array.from({ length: 14 }, (_, index) => ({
            ...base, _id: randomUUID(), operationId: `SYNTHETIC-BUDGET-${index}`
          }));
          await f.store.collection("OperationSession").insertMany(batch, { timeoutMS: 15_000 });
        }
        await f.rebaselineBusiness();
        await failure(f.invoke(t, { ...ARGS, limit: 1 }));
        const received = t.received.filter(batch => ["Company", "Course", "OperationSession"].some(model =>
          batch.namespace === `${f.options.databaseName}.${f.options.namespace}_${model}`));
        const receivedRows = received.reduce((sum, batch) => sum + batch.rows, 0);
        const receivedBytes = received.reduce((sum, batch) => sum + batch.bytes, 0);
        const evidence = `received rows=${receivedRows}, BSON bytes=${receivedBytes}; must observe the intended overflow, not an earlier timeout`;
        if (dimension === "rows") {
          assert.equal(receivedRows, 20_001, evidence);
          assert.ok(receivedBytes < 32 * 1024 * 1024, evidence);
          for (const model of ["Company", "Course", "OperationSession"]) {
            assert.equal(received.filter(batch => batch.namespace.endsWith(`_${model}`)).reduce((sum, batch) => sum + batch.rows, 0), 6_667, model);
          }
        } else {
          assert.ok(receivedBytes > 32 * 1024 * 1024, evidence);
          assert.ok(receivedRows < 20_000, evidence);
        }
        assert.equal(t.source, 0); assert.equal(t.runAttempts.length, 0); await f.assertStored([], []);
      });
    }
  } finally { await harness.close(); }
});
