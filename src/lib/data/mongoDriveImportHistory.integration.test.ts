/**
 * Native Drive history 계약 검증. 실행은 부모 소유, exact opt-in / 합성 owned DB만 허용.
 * V3 특수 take/collation actual PG gate는 별도 관찰표로 확정한다. expected는 제품 presenter와 독립이다.
 * clock/driver fault와 실제 server pending timeout을 케이스 이름으로 구분한다.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { inspect, isDeepStrictEqual } from "node:util";
import { BSON, ClientSession, Collection, FindCursor, MongoServerError, type Document, type FindOptions } from "mongodb";
import { isEncrypted } from "../privacy/crypto";
import { MongoDriveImportHistoryRepository, prepareMongoDriveImportHistory, DRIVE_IMPORT_HISTORY_MODELS } from "./mongoDriveImportHistoryRepository";
import { MongoDbNull, MongoJsonNull, decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, type MongoRuntimeDocument } from "./mongoRuntimeCodec";
import { operationMongoIndexes, operationMongoValidator } from "./mongoOperationStore";
import { AT, LATER, OP, CANARY, ERROR_CANARY, RID, SID, DID, ROW_LIMIT, BYTE_LIMIT, HISTORY_MODELS,
  driveHistoryOptIn, driveHarness, runSeed, resultSeed, sessionSeed, singleLiteral, resultLiteral, runLiteral,
  id, historyFailure, rawDigest, wireLedger, assertReadWire, barrier, bounded, pollOwnedOperation, type DriveFixture } from "./driveHistoryFixtures";

function interceptFind(f: DriveFixture, change: (model: string, filter: Document, options: FindOptions) => [Document, FindOptions],
  created?: (cursor: FindCursor, model: string, options: FindOptions) => void) {
  const original = Collection.prototype.find;
  return mock.method(Collection.prototype, "find", function (this: Collection, ...args: Parameters<Collection["find"]>) {
    const prefix = f.options.namespace + "_";
    if (!this.collectionName.startsWith(prefix)) return original.apply(this, args);
    const model = this.collectionName.slice(prefix.length), [filter, options] = change(model, args[0] ?? {}, args[1] ?? {});
    const cursor = original.call(this, filter, options); created?.(cursor, model, options); return cursor;
  });
}
async function corrupt(f: DriveFixture, model: typeof HISTORY_MODELS[number], key: string, update: Document) {
  const result = await f.store.collection(model).updateOne({ _id: key }, update, { bypassDocumentValidation: true, timeoutMS: 5000 });
  assert.equal(result.matchedCount, 1);
}
function damageEnvelope(value: unknown, part: 4 | 5 = 4) {
  assert.equal(typeof value, "string"); const pieces = (value as string).split(":"); assert.equal(pieces.length, 6);
  pieces[part] = (pieces[part][0] === "A" ? "B" : "A") + pieces[part].slice(1); return pieces.join(":");
}
async function expectBothFailure(f: DriveFixture) {
  await f.readOnly(() => assert.rejects(f.repo.readLatestDriveImportRun(), historyFailure));
  await f.readOnly(() => assert.rejects(f.repo.readLatestDriveImportResult(OP), historyFailure));
}

test("Drive history literal comparator controls (no database)", () => {
  const expected = runLiteral();
  assert.deepEqual(Object.fromEntries(Object.entries(expected).reverse()), expected);
  for (const bad of [(() => { const row = { ...expected }; delete row.status; return row; })(), { ...expected, extra: true },
    { ...expected, finishedAt: null }, { ...expected, operationCount: 102 },
    { ...expected, results: [resultLiteral({ inputValue: "other", folderTitle: "mixed" })] }]) {
    assert.throws(() => assert.deepEqual(bad, expected));
  }
  const a = resultLiteral({ operationId: "a" }), b = resultLiteral({ operationId: "b" });
  assert.throws(() => assert.deepEqual([b, a], [a, b]));
  assert.throws(() => assert.deepEqual([a], [a, a]));
  assert.notEqual(rawDigest([{ _id: "x", value: "aaaa" }]), rawDigest([{ _id: "x", value: "bbbb" }]));
});

// 공통 command representation 검증을 전체 suite보다 먼저 단독 실행할 수 있는 actual native 경로.
test("Drive history native wire smoke", { skip: !driveHistoryOptIn, timeout: 90_000 }, async () => {
  await driveHarness(async h => {
    const f = await h.fixture(); await f.seedPair({}, { operationSessionId: SID }); await f.seed("OperationSession", sessionSeed());
    await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral()); });
    await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportResult(OP), singleLiteral()); });
  });
});

test("Drive history native: selection / parents / cipher / budget / snapshot", { skip: !driveHistoryOptIn, timeout: 900_000 }, async suite => {
  let externalFetches = 0;
  const fetchPatch = mock.method(globalThis, "fetch", async () => { externalFetches++; throw new Error("External source fetch forbidden"); });
  try { await driveHarness(async h => {
    await suite.test("V4 full own-key literal, stored counters and legacy JSON, readonly", async () => {
      assert.deepEqual(DRIVE_IMPORT_HISTORY_MODELS, HISTORY_MODELS);
      const f = await h.fixture(); const { runRaw, resultRaw } = await f.seedPair();
      const decodedRun = decodeMongoRuntimeDocument("DriveImportRun", runRaw);
      const decodedResult = decodeMongoRuntimeDocument("DriveImportResult", resultRaw);
      for (const [key, value] of Object.entries(runSeed())) assert.deepEqual(decodedRun[key], value);
      for (const [key, value] of Object.entries(resultSeed())) assert.deepEqual(decodedResult[key], value);
      await f.readOnly(async () => {
        assert.deepEqual(await f.repo.readLatestDriveImportResult(OP), singleLiteral());
      });
      await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral()); });
      for (const key of ["summary", "notes"]) assert.ok(!Object.hasOwn(runLiteral(), key));
      assert.ok(!Object.hasOwn(resultLiteral(), "folderId"));
      for (const marker of [CANARY + "-notes", CANARY + "-summary"]) assert.ok(!JSON.stringify(runRaw).includes(marker));
      for (const marker of [CANARY + "-input", CANARY + "-folder-id", CANARY + "-title", CANARY + "-stored-error", CANARY + "-key", CANARY + "-folder", CANARY + "-issue", "https://example.invalid/synthetic-folder"]) {
        assert.ok(!JSON.stringify(resultRaw).includes(marker));
      }
      assert.ok(isEncrypted(runRaw.notes)); assert.ok(isEncrypted(resultRaw.inputValue));
      assert.equal(resultRaw.companyName, "합성 회사", "현재 registry 밖 snapshot 이름은 암호화 주장 금지");
    });

    for (const json of [MongoDbNull, MongoJsonNull, { notAnArray: true }, "scalar", 0]) {
      await suite.test("V4 null/JSON nonarray maps empty without cleansing nested candidates: " + String(json), async () => {
        const f = await h.fixture();
        await f.seedPair({}, { inputValue: null, folderTitle: null, folderUrl: null, error: null, startDate: null,
          endDate: new Date("2099-03-04T00:00:00.000Z"), keyCandidates: json, folderCandidates: json, issues: json });
        const common = { inputValue: "", folderTitle: "", folderUrl: "", keyCandidates: [], folderCandidates: [], issues: [] };
        await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportResult(OP), singleLiteral(common)); });
        await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral([resultLiteral({ ...common, error: "", startDate: "", endDate: "2099-03-04" })])); });
      });
    }

    await suite.test("V3 empty/null, exact operationId, latest pending/error and newest empty run", async () => {
      const f = await h.fixture();
      await f.readOnly(async () => { assert.equal(await f.repo.readLatestDriveImportRun(), null); });
      await f.readOnly(async () => { assert.equal(await f.repo.readLatestDriveImportResult(OP), null); });
      await f.seedPair({ status: "COMPLETED", finishedAt: new Date(AT) });
      for (const variant of [OP.toUpperCase(), " " + OP, OP + " "]) {
        await f.readOnly(async () => { assert.equal(await f.repo.readLatestDriveImportResult(variant), null); });
      }
      await f.seed("DriveImportRun", runSeed({ id: id(4), startedAt: new Date(LATER), status: "FAILED" }));
      await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral([], { id: id(4), startedAt: LATER, status: "FAILED" })); });
      await f.seed("DriveImportResult", resultSeed({ id: id(5), runId: id(4), createdAt: new Date("2098-01-01T00:00:00.000Z"), inputValue: "newer-run" }));
      await f.readOnly(async () => {
        assert.deepEqual(await f.repo.readLatestDriveImportResult(OP), singleLiteral({ runId: id(4), runStartedAt: LATER, runStatus: "FAILED", createdAt: "2098-01-01T00:00:00.000Z", inputValue: "newer-run" }));
      });
      await f.seed("DriveImportResult", resultSeed({ id: id(6), runId: id(4), createdAt: new Date(AT), inputValue: "newer-result" }));
      await f.readOnly(async () => {
        assert.deepEqual(await f.repo.readLatestDriveImportResult(OP), singleLiteral({ runId: id(4), runStartedAt: LATER, runStatus: "FAILED", inputValue: "newer-result" }));
      });
    });

    for (const count of [0, 1, 249, 250, 251]) {
      await suite.test("V3 default250/count/explicit positive take literal: " + count, async () => {
        const f = await h.fixture(); await f.seed("DriveImportRun", runSeed());
        const raw = Array.from({ length: count }, (_, index) => encodeMongoRuntimeDocument("DriveImportResult", resultSeed({
          id: id(1000 + index), operationId: "row-" + index, candidateCount: 1000 - index })));
        if (raw.length) await f.store.collection("DriveImportResult").insertMany(raw, { timeoutMS: 5000 });
        for (const take of [undefined, 0, 1, 249, 250, 251]) {
          const expected = Array.from({ length: Math.min(count, take ?? 250) }, (_, index) => resultLiteral({ operationId: "row-" + index, candidateCount: 1000 - index }));
          await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(take), runLiteral(expected)); });
        }
      });
    }

    await suite.test("V3 249 higher + 3 boundary ties: full tuples/order/multiplicity", async () => {
      const f = await h.fixture(); await f.seed("DriveImportRun", runSeed());
      const high = Array.from({ length: 249 }, (_, i) => ({ seed: resultSeed({ id: id(1000 + i), operationId: "higher-" + i, candidateCount: 1000 - i }),
        expected: resultLiteral({ operationId: "higher-" + i, candidateCount: 1000 - i }) }));
      const tied = [0, 1, 2].map(i => ({ seed: resultSeed({ id: id(2000 + i), operationId: "tie-" + i, candidateCount: 1, inputValue: "tie-input-" + i }),
        expected: resultLiteral({ operationId: "tie-" + i, candidateCount: 1, inputValue: "tie-input-" + i }) }));
      await f.store.collection("DriveImportResult").insertMany([...tied, ...high].map(row => encodeMongoRuntimeDocument("DriveImportResult", row.seed)), { timeoutMS: 5000 });
      await f.readOnly(async () => {
        const actual = await f.repo.readLatestDriveImportRun(); assert.ok(actual); assert.equal(actual.results.length, 250);
        assert.deepEqual(actual.results.slice(0, 249), high.map(row => row.expected));
        assert.equal(tied.filter(row => isDeepStrictEqual(row.expected, actual.results[249])).length, 1);
        assert.deepEqual({ ...actual, results: [] }, runLiteral([]));
        assert.equal(new Set(actual.results.map(row => row.operationId)).size, 250);
      });
    });

    await suite.test("V3 tied run/single allow only coherent whole candidate DTO; identical result multiplicity preserved", async () => {
      const f = await h.fixture(); await f.seedPair();
      await f.seed("DriveImportRun", runSeed({ id: id(4), status: "FAILED" }));
      await f.seed("DriveImportResult", resultSeed({ id: id(5), runId: id(4), inputValue: "second", fileCount: 44 }));
      const candidates = [singleLiteral(), singleLiteral({ runId: id(4), runStatus: "FAILED", inputValue: "second", fileCount: 44 })];
      await f.readOnly(async () => { const value = await f.repo.readLatestDriveImportResult(OP); assert.ok(candidates.some(row => isDeepStrictEqual(row, value))); });
      const runs = [runLiteral(), runLiteral([resultLiteral({ inputValue: "second", fileCount: 44 })], { id: id(4), status: "FAILED" })];
      await f.readOnly(async () => { const value = await f.repo.readLatestDriveImportRun(); assert.ok(runs.some(row => isDeepStrictEqual(row, value))); });
      await f.store.collection("DriveImportRun").deleteOne({ _id: id(4) });
      await f.store.collection("DriveImportResult").deleteOne({ _id: id(5) });
      await f.seed("DriveImportResult", resultSeed({ id: id(6) }));
      await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral([resultLiteral(), resultLiteral()])); });
    });

    for (const deletedAt of [null, new Date(LATER)]) {
      await suite.test("V5 session identity-only: private corruption/current operation mismatch/deleted=" + Boolean(deletedAt), async () => {
        const f = await h.fixture(); await f.seedPair({}, { operationSessionId: SID });
        await f.seed("OperationSession", sessionSeed({ deletedAt, omName: CANARY + "-session-private" }));
        await corrupt(f, "OperationSession", SID, { $set: { omName: "invalid-private-envelope" } });
        const ledger = wireLedger(h.client, h.databaseName);
        try { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral()); }
        finally { ledger.stop(); }
        assertReadWire(ledger);
        const received = ledger.receipts.filter(r => r.collection.endsWith("_OperationSession")).flatMap(r => r.keys);
        assert.deepEqual(received, [["_id"]], "private payload를 수신하거나 projection을 full codec에 넣지 않는다");
        await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportResult(OP), singleLiteral()); });
      });
    }

    await suite.test("V5 considered-set: older orphan rejects single; unrelated rows and run0 stay outside scan", async () => {
      const f = await h.fixture(); await f.seedPair();
      await f.seed("DriveImportResult", resultSeed({ id: id(4), runId: id(999), createdAt: new Date("2098-01-01T00:00:00.000Z") }));
      await f.readOnly(() => assert.rejects(f.repo.readLatestDriveImportResult(OP), historyFailure));
      await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral()); });
      await corrupt(f, "DriveImportResult", id(4), { $set: { operationId: "unrelated", inputValue: "broken" } });
      await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportResult(OP), singleLiteral()); });
      await f.store.collection("DriveImportRun").deleteMany({});
      await f.readOnly(async () => { assert.equal(await f.repo.readLatestDriveImportRun(), null); });
    });

    for (const fault of ["session", "cipher"] as const) {
      for (const take of [0, 250, -1]) {
        await suite.test("V5 take-before-integrity forbidden (intentional PG difference) " + fault + "/" + take, async () => {
          const f = await h.fixture(); await f.seed("DriveImportRun", runSeed());
          const rows = Array.from({ length: 251 }, (_, i) => encodeMongoRuntimeDocument("DriveImportResult", resultSeed({
            id: id(1000 + i), candidateCount: 1000 - i, operationId: "row-" + i })));
          await f.store.collection("DriveImportResult").insertMany(rows, { timeoutMS: 5000 });
          // 양 끝 선택 방향에 의존하지 않고 음수 take의 미선택 중간 행도 검사한다.
          const target = take < 0 ? id(1125) : id(1250);
          await corrupt(f, "DriveImportResult", target, fault === "session" ? { $set: { operationSessionId: SID } } : { $set: { inputValue: "broken" } });
          await f.readOnly(() => assert.rejects(f.repo.readLatestDriveImportRun(take), historyFailure));
        });
      }
    }

    await suite.test("V5 Run selector projection: unselected private damage succeeds; selector damage fails", async () => {
      const f = await h.fixture(); await f.seedPair();
      await f.seed("DriveImportRun", runSeed({ id: id(4), startedAt: new Date("2098-01-01T00:00:00.000Z") }));
      await corrupt(f, "DriveImportRun", id(4), { $set: { notes: "broken" } });
      await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral()); });
      await corrupt(f, "DriveImportRun", id(4), { $set: { startedAt: "not-a-date" } });
      await f.readOnly(() => assert.rejects(f.repo.readLatestDriveImportRun(), historyFailure));
    });

    await suite.test("V5 cross-namespace same IDs return own full DTO; foreign-only parents fail", async () => {
      const a = await h.fixture(), b = await h.fixture();
      for (const [f, marker] of [[a, "namespace-a"], [b, "namespace-b"]] as const) {
        await f.seedPair({}, { operationSessionId: SID, inputValue: marker }); await f.seed("OperationSession", sessionSeed());
      }
      const results = await Promise.all([a.repo.readLatestDriveImportRun(), b.repo.readLatestDriveImportRun()]);
      assert.deepEqual(results, [runLiteral([resultLiteral({ inputValue: "namespace-a" })]), runLiteral([resultLiteral({ inputValue: "namespace-b" })])]);
      await a.store.collection("OperationSession").deleteOne({ _id: SID }); await expectBothFailure(a);
      await a.seed("OperationSession", sessionSeed()); await a.store.collection("DriveImportRun").deleteOne({ _id: RID });
      await a.readOnly(() => assert.rejects(a.repo.readLatestDriveImportResult(OP), historyFailure));
      await b.readOnly(async () => { assert.deepEqual(await b.repo.readLatestDriveImportResult(OP), singleLiteral({ inputValue: "namespace-b" })); });
    });

    for (const [model, field, key] of [["DriveImportRun", "notes", RID], ["DriveImportRun", "summary", RID], ["DriveImportResult", "folderId", DID],
      ["DriveImportResult", "inputValue", DID], ["DriveImportResult", "folderTitle", DID], ["DriveImportResult", "folderUrl", DID],
      ["DriveImportResult", "error", DID], ["DriveImportResult", "keyCandidates", DID], ["DriveImportResult", "folderCandidates", DID], ["DriveImportResult", "issues", DID]] as const) {
      await suite.test("V6 full authentication including nonreturned field " + model + "." + field, async () => {
        const f = await h.fixture(); await f.seedPair();
        const raw = await f.store.collection(model).findOne({ _id: key }); assert.ok(raw);
        const value = raw[field];
        const damaged = typeof value === "string" ? damageEnvelope(value) : { $json: { __pii: damageEnvelope((value as Document).$json.__pii) } };
        await corrupt(f, model, key, { $set: { [field]: damaged } }); await expectBothFailure(f);
      });
    }

    for (const fault of ["cipher", "missing-companion", "wrong-companion", "missing-key", "wrong-key", "wrong-index-key"] as const) {
      await suite.test("V6 independent key/cipher/companion failure: " + fault, async () => {
        const f = await h.fixture(); const { resultRaw } = await f.seedPair();
        try {
          if (fault === "cipher") await corrupt(f, "DriveImportResult", DID, { $set: { inputValue: damageEnvelope(resultRaw.inputValue, 5) } });
          if (fault === "missing-companion") await corrupt(f, "DriveImportResult", DID, { $unset: { inputValuePiiIndex: "" } });
          if (fault === "wrong-companion") await corrupt(f, "DriveImportResult", DID, { $set: { inputValuePiiIndex: "0".repeat(64) } });
          if (fault === "missing-key") { process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ other: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "other"; }
          if (fault === "wrong-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ drive: randomBytes(32).toString("base64") });
          if (fault === "wrong-index-key") process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
          await expectBothFailure(f);
        } finally { Object.assign(process.env, h.keys); }
      });
    }

    for (const model of HISTORY_MODELS) {
      await suite.test("V6 open policy/metadata mismatch is readonly: " + model, async () => {
        const f = await h.fixture();
        await f.store.db.command({ collMod: f.store.collection(model).collectionName, validationLevel: "moderate" }, { timeoutMS: 5000 });
        const before = await f.snapshot(), ledger = wireLedger(h.client, h.databaseName);
        try { await assert.rejects(MongoDriveImportHistoryRepository.open(f.options), historyFailure); }
        finally { ledger.stop(); }
        assert.deepEqual(ledger.commands.filter(c => ["collMod", "create", "createIndexes", "insert", "update", "delete"].includes(c.commandName)), []);
        assert.deepEqual(await f.snapshot(), before);
        const info = await f.store.db.listCollections({ name: f.store.collection(model).collectionName }, { nameOnly: false }).next();
        assert.ok(info && "options" in info); assert.ok(info.options); assert.equal(info.options.validationLevel, "moderate");
      });
    }

    await suite.test("V6 native validator rejection distinguished from bypass corruption-read", async () => {
      const f = await h.fixture(); const { resultRaw } = await f.seedPair();
      await assert.rejects(f.store.collection("DriveImportResult").insertOne({ ...resultRaw, _id: id(4), candidateCount: "wrong" }), error => {
        assert.ok(error instanceof MongoServerError); assert.equal(error.code, 121); return true;
      });
      await corrupt(f, "DriveImportResult", DID, { $set: { candidateCount: "wrong" } }); await expectBothFailure(f);
    });

    for (const server of [false, true]) {
      await suite.test("V6 injected driver error sanitized, no retry: server=" + server, async () => {
        const f = await h.fixture(); await f.seedPair(); let calls = 0;
        const captured: unknown[][] = [];
        const logPatches = (["error", "warn", "log", "info", "debug"] as const).map(method =>
          mock.method(console, method, (...args: unknown[]) => { captured.push(args); }));
        const message = ERROR_CANARY + " " + CANARY;
        const patch = interceptFind(f, () => { calls++; throw server ? new MongoServerError({ code: 91, message }) : new Error(message); });
        try { await assert.rejects(f.repo.readLatestDriveImportRun(), historyFailure); assert.equal(calls, 1); }
        finally { patch.mock.restore(); for (const logPatch of logPatches) logPatch.mock.restore(); }
        // Error 객체의 non-enumerable message/stack까지 포함한다. 저장된 result.error의 승인된 DTO 값과 별도다.
        const emitted = inspect(captured, { depth: null, showHidden: true });
        for (const secret of [ERROR_CANARY, CANARY]) assert.equal(emitted.includes(secret), false, "runtime private error must not be logged before sanitization");
      });
    }

    await suite.test("V3 frozen PG actual take: finite fractions truncate, negative tail keeps normal order", async () => {
      const f = await h.fixture(); await f.seed("DriveImportRun", runSeed());
      const rows = Array.from({ length: 253 }, (_, i) => encodeMongoRuntimeDocument("DriveImportResult", resultSeed({
        id: id(1000 + i), operationId: "rank-" + i, candidateCount: 1000 - i })));
      await f.store.collection("DriveImportResult").insertMany(rows, { timeoutMS: 5000 });
      // 부모의 pg-gate-extended actual 관찰에서 가져온 범위. 제품의 Math.trunc/slice를 expected 계산에 재사용하지 않는다.
      const cases: [number, number, number][] = [[1.5, 0, 1], [-1.5, 252, 253], [0.5, 0, 0], [-0.5, 0, 0], [-0, 0, 0],
        [-1, 252, 253], [-250, 3, 253], [-250.9, 3, 253], [2147483648, 0, 253], [Number.MAX_SAFE_INTEGER, 0, 253], [-Number.MAX_SAFE_INTEGER, 0, 253]];
      for (const [take, start, end] of cases) {
        assert.equal(typeof take, "number");
        const expected = Array.from({ length: end - start }, (_, i) => resultLiteral({ operationId: "rank-" + (start + i), candidateCount: 1000 - start - i }));
        await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(take), runLiteral(expected)); });
      }
      // JSON IPC를 사용하지 않는다. 실제 JS NaN/Infinity를 호출하며 잘못된 인자에서 DB 접촉 0.
      await corrupt(f, "DriveImportRun", RID, { $set: { notes: "broken" } });
      for (const take of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), 1e18, -1e18, Number.MAX_VALUE]) {
        assert.equal(typeof take, "number"); if (Number.isNaN(take)) assert.ok(Object.is(take, NaN));
        const ledger = wireLedger(h.client, h.databaseName);
        try { assert.equal(await f.repo.readLatestDriveImportRun(take), null); }
        finally { ledger.stop(); }
        assert.deepEqual(ledger.commands, [], "잘못된 인자가 손상 metadata/read로 진행하지 않는다");
      }
    });

    await suite.test("V3 actual PG C collation 34 rows: literal byte order on company/course, no comparator sharing", async () => {
      const f = await h.fixture(); await f.seed("DriveImportRun", runSeed());
      const names = ["A", "a", "Z", "z", "á", "a\u0301", "Ä", "ä", "가", "각", "나", "", " ", "a-", "a0", "a10", "a2"];
      // pg-gate-extended-observations.json collation-order.sqlOrder (C/SQL_ASCII, equalPairs=[]).
      const order = [11, 12, 0, 2, 1, 13, 14, 15, 16, 5, 3, 6, 4, 7, 8, 9, 10];
      const rows = names.flatMap((name, i) => [
        resultSeed({ id: id(1000 + i * 2), operationId: "company-" + i, candidateCount: 10, companyName: name, courseName: "same-course" }),
        resultSeed({ id: id(1001 + i * 2), operationId: "course-" + i, candidateCount: 9, companyName: "same-company", courseName: name })]);
      await f.store.collection("DriveImportResult").insertMany(rows.map(row => encodeMongoRuntimeDocument("DriveImportResult", row)), { timeoutMS: 5000 });
      const expected = [...order.map(i => resultLiteral({ operationId: "company-" + i, candidateCount: 10, companyName: names[i], courseName: "same-course" })),
        ...order.map(i => resultLiteral({ operationId: "course-" + i, candidateCount: 9, companyName: "same-company", courseName: names[i] }))];
      await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral(expected)); });
      // company 우선순위가 course의 유리한 값에 뒤집히면 안 된다.
      await f.store.collection("DriveImportResult").deleteMany({});
      await f.seed("DriveImportResult", resultSeed({ id: id(100), companyName: "A", courseName: "z" }));
      await f.seed("DriveImportResult", resultSeed({ id: id(101), companyName: "Z", courseName: "A" }));
      await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral([
        resultLiteral({ companyName: "A", courseName: "z" }), resultLiteral({ companyName: "Z", courseName: "A" })])); });
    });

    await suite.test("V3 negative tail tie-cut preserves low group membership/whole DTO and multiplicity", async () => {
      const f = await h.fixture(); await f.seed("DriveImportRun", runSeed());
      const rows = Array.from({ length: 6 }, (_, i) => resultSeed({ id: id(1000 + i), candidateCount: i < 2 ? 20 : 10, operationId: "tie-" + i, inputValue: "tie-" + i }));
      await f.store.collection("DriveImportResult").insertMany(rows.map(row => encodeMongoRuntimeDocument("DriveImportResult", row)), { timeoutMS: 5000 });
      const high = [0, 1].map(i => resultLiteral({ candidateCount: 20, operationId: "tie-" + i, inputValue: "tie-" + i }));
      const low = [2, 3, 4, 5].map(i => resultLiteral({ candidateCount: 10, operationId: "tie-" + i, inputValue: "tie-" + i }));
      for (const take of [-1, -3, -6]) await f.readOnly(async () => {
        const actual = await f.repo.readLatestDriveImportRun(take); assert.ok(actual);
        assert.deepEqual({ ...actual, results: [] }, runLiteral([])); assert.equal(actual.results.length, -take);
        assert.equal(new Set(actual.results.map(row => row.operationId)).size, -take);
        if (take === -6) {
          assert.ok(actual.results.slice(0, 2).every(row => high.some(candidate => isDeepStrictEqual(candidate, row))));
          assert.ok(actual.results.slice(2).every(row => low.some(candidate => isDeepStrictEqual(candidate, row))));
        } else assert.ok(actual.results.every(row => low.some(candidate => isDeepStrictEqual(candidate, row))));
      });
    });

    await suite.test("V6 retained keyring decrypts old rows while active key changes", async () => {
      const f = await h.fixture(); await f.seedPair();
      try {
        process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ ...JSON.parse(h.keys.PII_ENCRYPTION_KEYS), newer: randomBytes(32).toString("base64") });
        process.env.PII_ACTIVE_KEY_ID = "newer";
        await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral()); });
        await f.seed("DriveImportResult", resultSeed({ id: id(4), createdAt: new Date(LATER) }));
        await f.readOnly(async () => { assert.deepEqual(await f.repo.readLatestDriveImportResult(OP), singleLiteral({ createdAt: LATER })); });
      } finally { Object.assign(process.env, h.keys); }
    });

    for (const model of HISTORY_MODELS) {
      await suite.test("V6 prepare historical invalid document with current metadata: preflight/no repair/no missing creation " + model, async () => {
        const f = await h.fixture();
        const key = model === "DriveImportRun" ? RID : model === "DriveImportResult" ? DID : SID;
        await f.seed(model, model === "DriveImportRun" ? runSeed() : model === "DriveImportResult" ? resultSeed() : sessionSeed());
        const missing = HISTORY_MODELS.find(name => name !== model)!;
        await f.store.collection(missing).drop({ timeoutMS: 5000 });
        await corrupt(f, model, key, { $set: { invalidHistoricalField: "synthetic" } });
        const before = await f.snapshot(), ledger = wireLedger(h.client, h.databaseName);
        try { await assert.rejects(prepareMongoDriveImportHistory({ ...f.options, allowShadowWrites: true }), historyFailure); }
        finally { ledger.stop(); }
        assert.deepEqual(ledger.commands.filter(c => ["create", "createIndexes", "collMod", "update", "delete", "insert"].includes(c.commandName)), []);
        assert.deepEqual(await f.snapshot(), before);
        const info = await f.store.db.listCollections({ name: f.store.collection(model).collectionName }, { nameOnly: false }).next();
        assert.ok(info && "options" in info); assert.ok(info.options); assert.deepEqual(info.options.validator, operationMongoValidator(model));
      });
    }

    await suite.test("V6 open missing index refuses without repair; unprepared namespace stays empty", async () => {
      const f = await h.fixture();
      const index = operationMongoIndexes("DriveImportRun").find(index => index.name); assert.ok(index?.name);
      await f.store.collection("DriveImportRun").dropIndex(index.name);
      let ledger = wireLedger(h.client, h.databaseName);
      try { await assert.rejects(MongoDriveImportHistoryRepository.open(f.options), historyFailure); }
      finally { ledger.stop(); }
      assert.deepEqual(ledger.commands.filter(c => ["createIndexes", "collMod", "create"].includes(c.commandName)), []);
      const options = { ...f.options, namespace: "shadow_missing_" + randomBytes(8).toString("hex") };
      ledger = wireLedger(h.client, h.databaseName);
      try { await assert.rejects(MongoDriveImportHistoryRepository.open(options), historyFailure); }
      finally { ledger.stop(); }
      assert.deepEqual(ledger.commands.filter(c => ["createIndexes", "collMod", "create"].includes(c.commandName)), []);
      assert.deepEqual(await f.store.db.listCollections({ name: { $regex: "^" + options.namespace } }).toArray(), []);
    });

    await suite.test("V6 raw cumulative rows: 19998 results + selector + fullRun; parent pushes exact single over", async () => {
      const f = await h.fixture();
      const runRaw = await f.seed("DriveImportRun", runSeed({ summary: MongoDbNull, notes: null }));
      const lean = { inputValue: null, folderId: null, folderTitle: null, folderUrl: null, error: null,
        keyCandidates: MongoDbNull, folderCandidates: MongoDbNull, issues: MongoDbNull };
      const expectedResult = resultLiteral({ inputValue: "", folderTitle: "", folderUrl: "", error: "", keyCandidates: [], folderCandidates: [], issues: [] });
      const raws = Array.from({ length: 19_998 }, (_, i) => encodeMongoRuntimeDocument("DriveImportResult", resultSeed({ ...lean, id: id(1000 + i) })));
      for (let start = 0; start < raws.length; start += 500) await f.store.collection("DriveImportResult").insertMany(raws.slice(start, start + 500), { timeoutMS: 5000 });
      const projectionBytes = BSON.calculateObjectSize({ _id: RID, startedAt: new Date(AT) });
      let ledger = wireLedger(h.client, h.databaseName);
      try { assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral(Array.from({ length: 250 }, () => expectedResult))); }
      finally { ledger.stop(); }
      assertReadWire(ledger); assert.equal(ledger.rows, ROW_LIMIT);
      assert.equal(ledger.bytes, raws.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0) + BSON.calculateObjectSize(runRaw) + projectionBytes);
      const extra = encodeMongoRuntimeDocument("DriveImportResult", resultSeed({ ...lean, id: id(30_000) }));
      await f.store.collection("DriveImportResult").insertOne(extra); raws.push(extra);
      ledger = wireLedger(h.client, h.databaseName);
      try { await assert.rejects(f.repo.readLatestDriveImportRun(), historyFailure); }
      finally { ledger.stop(); }
      assertReadWire(ledger); assert.equal(ledger.rows, ROW_LIMIT + 1, "개별 scan은 quota 아래여도 재조회 포함 누적 초과");
      ledger = wireLedger(h.client, h.databaseName);
      try { assert.deepEqual(await f.repo.readLatestDriveImportResult(OP), singleLiteral({ inputValue: "", folderTitle: "", folderUrl: "", keyCandidates: [], folderCandidates: [], issues: [] })); }
      finally { ledger.stop(); }
      assertReadWire(ledger); assert.equal(ledger.rows, ROW_LIMIT);
      await f.seed("OperationSession", sessionSeed());
      await f.store.collection("DriveImportResult").updateOne({ _id: extra._id }, { $set: { operationSessionId: SID } });
      const before = await f.snapshot(); ledger = wireLedger(h.client, h.databaseName);
      try { await assert.rejects(f.repo.readLatestDriveImportResult(OP), historyFailure); }
      finally { ledger.stop(); }
      assertReadWire(ledger); assert.equal(ledger.rows, ROW_LIMIT + 1); assert.deepEqual(await f.snapshot(), before);
    });

    await suite.test("V6 exact raw BSON 32MiB / +1 byte includes selector+full re-fetch, each doc below16MiB", async () => {
      const f = await h.fixture(); const runRaw = await f.seed("DriveImportRun", runSeed({ summary: MongoDbNull, notes: null }));
      const rows = Array.from({ length: 8 }, (_, i) => encodeMongoRuntimeDocument("DriveImportResult", resultSeed({ id: id(1000 + i), companyName: "" })));
      const parentBytes = BSON.calculateObjectSize({ _id: RID, startedAt: new Date(AT) }) + BSON.calculateObjectSize(runRaw);
      const padding = BYTE_LIMIT - parentBytes - rows.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0);
      assert.ok(padding > 0);
      for (let i = 0; i < rows.length; i++) rows[i].companyName = "x".repeat(Math.floor(padding / rows.length) + (i < padding % rows.length ? 1 : 0));
      assert.equal(parentBytes + rows.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0), BYTE_LIMIT);
      assert.ok(rows.every(row => BSON.calculateObjectSize(row) < 16 * 1024 * 1024));
      await f.store.collection("DriveImportResult").insertMany(rows, { timeoutMS: 10_000 });
      let ledger = wireLedger(h.client, h.databaseName);
      try { assert.deepEqual(await f.repo.readLatestDriveImportRun(0), runLiteral([])); }
      finally { ledger.stop(); }
      assertReadWire(ledger); assert.equal(ledger.rows, 10); assert.equal(ledger.bytes, BYTE_LIMIT);
      await f.store.collection("DriveImportResult").updateOne({ _id: rows[0]._id }, { $set: { companyName: String(rows[0].companyName) + "x" } }, { timeoutMS: 5000 });
      ledger = wireLedger(h.client, h.databaseName);
      try { await assert.rejects(f.repo.readLatestDriveImportRun(0), historyFailure); }
      finally { ledger.stop(); }
      assertReadWire(ledger); assert.equal(ledger.bytes, BYTE_LIMIT + 1); assert.equal(ledger.rows, 10);
    });

    await suite.test("V6 parents are deduplicated/batched; actual projection receipts are independent", async () => {
      const f = await h.fixture(); await f.seed("DriveImportRun", runSeed());
      const sessions = Array.from({ length: 501 }, (_, i) => encodeMongoRuntimeDocument("OperationSession", sessionSeed({ id: id(1000 + i), operationId: "session-" + i })));
      const rows = Array.from({ length: 502 }, (_, i) => encodeMongoRuntimeDocument("DriveImportResult", resultSeed({ id: id(3000 + i), operationSessionId: id(1000 + i % 501) })));
      await f.store.collection("OperationSession").insertMany(sessions, { timeoutMS: 5000 });
      await f.store.collection("DriveImportResult").insertMany(rows, { timeoutMS: 5000 });
      const ledger = wireLedger(h.client, h.databaseName);
      try { assert.deepEqual(await f.repo.readLatestDriveImportRun(0), runLiteral([])); }
      finally { ledger.stop(); }
      assertReadWire(ledger); assert.equal(ledger.rows, 2 + 502 + 501);
      const finds = ledger.commands.filter(c => c.command.find === f.store.collection("OperationSession").collectionName);
      assert.ok(finds.length < 20, "N+1 부모 query 금지");
      const identities = ledger.receipts.filter(r => r.collection.endsWith("_OperationSession")).flatMap(r => r.keys);
      assert.equal(identities.length, 501); assert.ok(identities.every(keys => isDeepStrictEqual(keys, ["_id"])));
    });

    for (const elapsed of [59_999, 60_000, 60_001]) {
      await suite.test("V6 injected clock after decode/parents/sort before DTO return " + elapsed, async () => {
        let now = 0; const f = await h.fixture(() => now); await f.seedPair();
        const original = Array.prototype.sort, descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "sort"); let reached = 0;
        assert.ok(descriptor); assert.equal(descriptor.value, original);
        try {
          // Node mock.method는 Array.prototype 자체를 거부한다. 원래 descriptor와 호출을 직접 보존한다.
          Object.defineProperty(Array.prototype, "sort", { ...descriptor, value: function (this: unknown[], compare?: (a: unknown, b: unknown) => number) {
            const result: unknown[] = Reflect.apply(original, this, [compare]);
            const row = this[0];
            if (this.length === 1 && row && typeof row === "object" && "operationId" in row && row.operationId === OP
              && "runId" in row && row.runId === RID && "createdAt" in row && row.createdAt instanceof Date) { now = elapsed; reached++; }
            return result;
          } });
          if (elapsed < 60_000) assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral());
          else await assert.rejects(f.repo.readLatestDriveImportRun(), historyFailure);
          assert.equal(reached, 1);
        } finally {
          Object.defineProperty(Array.prototype, "sort", descriptor);
          assert.deepEqual(Object.getOwnPropertyDescriptor(Array.prototype, "sort"), descriptor);
        }
      });
      await suite.test("V6 injected clock after bounded cleanup, final-return boundary " + elapsed, async () => {
        let now = 0; const f = await h.fixture(() => now); await f.seedPair();
        const original = ClientSession.prototype.endSession; let ended = 0;
        const patch = mock.method(ClientSession.prototype, "endSession", async function (this: ClientSession, ...args: Parameters<ClientSession["endSession"]>) {
          assert.equal(args[0]?.timeoutMS, 5000); await original.apply(this, args); ended++; now = elapsed;
        });
        try {
          if (elapsed < 60_000) assert.deepEqual(await f.repo.readLatestDriveImportRun(), runLiteral());
          else await assert.rejects(f.repo.readLatestDriveImportRun(), historyFailure);
          assert.equal(ended, 1);
        } finally { patch.mock.restore(); }
      });
    }

    await suite.test("V6 injected clock: scan15s no reset between keyset pages, cleanup awaited", async () => {
      let now = 0; const f = await h.fixture(() => now); await f.seedPair();
      const cursors = new Set<FindCursor>();
      const findPatch = interceptFind(f, (model, filter, options) => {
        assert.ok(Number(options.timeoutMS) > 0 && Number(options.timeoutMS) <= 15_000); return [filter, options];
      }, cursor => cursors.add(cursor));
      const original = FindCursor.prototype.toArray;
      const patch = mock.method(FindCursor.prototype, "toArray", async function (this: FindCursor, ...args: Parameters<FindCursor["toArray"]>) {
        const rows = await original.apply(this, args); if (cursors.has(this) && rows.length) now = 15_000; return rows;
      });
      try { await assert.rejects(f.repo.readLatestDriveImportRun(), historyFailure); assert.ok([...cursors].every(cursor => cursor.closed)); }
      finally { patch.mock.restore(); findPatch.mock.restore(); }
    });

    await suite.test("V6 actual101 Result rows / two pages with injected8s+8s: next timeout7s, cumulative16s rejects", async () => {
      let now = 0; const f = await h.fixture(() => now); await f.seed("DriveImportRun", runSeed());
      const rows = Array.from({ length: 101 }, (_, i) => encodeMongoRuntimeDocument("DriveImportResult", resultSeed({ id: id(1000 + i) })));
      await f.store.collection("DriveImportResult").insertMany(rows, { timeoutMS: 5000 });
      const before = await f.snapshot();
      const cursors = new Set<FindCursor>(), pageSizes: number[] = [], timeouts: number[] = [];
      const findPatch = interceptFind(f, (model, filter, options) => {
        assert.equal(model, "DriveImportResult", "만료된 Result scan 뒤 parent query에 도달하면 안 된다");
        timeouts.push(Number(options.timeoutMS)); return [filter, options];
      }, cursor => cursors.add(cursor));
      const original = FindCursor.prototype.toArray;
      const pagePatch = mock.method(FindCursor.prototype, "toArray", async function (this: FindCursor, ...args: Parameters<FindCursor["toArray"]>) {
        const page = await original.apply(this, args);
        if (cursors.has(this)) { pageSizes.push(page.length); now += 8000; }
        return page;
      });
      const ledger = wireLedger(h.client, h.databaseName);
      try {
        await assert.rejects(f.repo.readLatestDriveImportResult(OP), historyFailure);
        assert.deepEqual(pageSizes, [100, 1]); assert.deepEqual(timeouts, [15_000, 7000]); assert.equal(now, 16_000);
        assert.equal(ledger.rows, 101); assert.ok([...cursors].every(cursor => cursor.closed));
      } finally { ledger.stop(); pagePatch.mock.restore(); findPatch.mock.restore(); }
      assertReadWire(ledger); assert.deepEqual(await f.snapshot(), before);
    });

    await suite.test("V6 injected clock: empty query spends time and min(call remaining, scan remaining) is forwarded", async () => {
      let calls = 0, armed = false; const f = await h.fixture(() => !armed || calls++ === 0 ? 0 : 58_500);
      const timeouts: number[] = [];
      const patch = interceptFind(f, (_model, filter, options) => { timeouts.push(Number(options.timeoutMS)); return [filter, options]; });
      try { armed = true; assert.equal(await f.repo.readLatestDriveImportRun(), null); assert.deepEqual(timeouts, [1500]); }
      finally { patch.mock.restore(); }
    });

    await suite.test("V6 injected cumulative clock: each scan12s but five scans exhaust one60s call", async () => {
      let now = 0; const f = await h.fixture(() => now); await f.seed("DriveImportRun", runSeed());
      const sessions = Array.from({ length: 501 }, (_, i) => encodeMongoRuntimeDocument("OperationSession", sessionSeed({ id: id(1000 + i), operationId: "clock-parent-" + i })));
      const results = sessions.map((row, i) => encodeMongoRuntimeDocument("DriveImportResult", resultSeed({ id: id(3000 + i), operationSessionId: row._id })));
      await f.store.collection("OperationSession").insertMany(sessions, { timeoutMS: 5000 });
      await f.store.collection("DriveImportResult").insertMany(results, { timeoutMS: 5000 });
      const cursors = new Set<FindCursor>(), empty = new Set<FindCursor>(); let scans = 0;
      const findPatch = interceptFind(f, (_model, filter, options) => {
        assert.ok(Number(options.timeoutMS) > 0 && Number(options.timeoutMS) <= Math.min(15_000, 60_000 - now));
        return [filter, options];
      }, cursor => cursors.add(cursor));
      const originalArray = FindCursor.prototype.toArray, originalClose = FindCursor.prototype.close;
      const arrayPatch = mock.method(FindCursor.prototype, "toArray", async function (this: FindCursor, ...args: Parameters<FindCursor["toArray"]>) {
        const rows = await originalArray.apply(this, args); if (cursors.has(this) && rows.length === 0) empty.add(this); return rows;
      });
      const closePatch = mock.method(FindCursor.prototype, "close", async function (this: FindCursor, ...args: Parameters<FindCursor["close"]>) {
        await originalClose.apply(this, args);
        if (args[0]?.timeoutMS === 5000 && empty.delete(this)) { now += 12_000; scans++; }
      });
      try { await assert.rejects(f.repo.readLatestDriveImportRun(0), historyFailure); assert.equal(scans, 5); assert.equal(now, 60_000); }
      finally { closePatch.mock.restore(); arrayPatch.mock.restore(); findPatch.mock.restore(); }
    });

    for (const method of ["readLatestDriveImportRun", "readLatestDriveImportResult"] as const) {
      await suite.test("V5 native snapshot first-read barrier → controller commit → old whole DTO → fresh new DTO: " + method, async () => {
        const f = await h.fixture(); const { runRaw, resultRaw } = await f.seedPair();
        const entered = barrier(), release = barrier(), cursors = new Set<FindCursor>(); let held = false;
        const findPatch = interceptFind(f, (_model, filter, options) => [filter, options], cursor => cursors.add(cursor));
        const original = FindCursor.prototype.toArray;
        const patch = mock.method(FindCursor.prototype, "toArray", async function (this: FindCursor, ...args: Parameters<FindCursor["toArray"]>) {
          const rows = await original.apply(this, args);
          if (cursors.has(this) && !held && rows.length) { held = true; entered.resolve(); await bounded(release.promise); }
          return rows;
        });
        const readerWire = wireLedger(h.client, h.databaseName), controllerWire = wireLedger(h.observer, h.databaseName);
        const read = () => method === "readLatestDriveImportRun" ? f.repo.readLatestDriveImportRun() : f.repo.readLatestDriveImportResult(OP);
        const pending = read(); const settled = pending.then(value => ({ value }), error => ({ error }));
        const session = h.observer.startSession();
        try {
          await bounded(Promise.race([entered.promise, settled.then(() => { throw new Error("snapshot barrier 전에 read 종료"); })]));
          session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
          const db = h.observer.db(h.databaseName);
          const changedRun = encodeMongoRuntimeDocument("DriveImportRun", runSeed({ startedAt: new Date(LATER), status: "FAILED" }));
          const changedResult = encodeMongoRuntimeDocument("DriveImportResult", resultSeed({ inputValue: "after-controller", fileCount: 99 }));
          assert.equal((await db.collection<MongoRuntimeDocument>(f.store.collection("DriveImportRun").collectionName).replaceOne({ _id: runRaw._id }, changedRun, { session, timeoutMS: 5000 })).modifiedCount, 1);
          assert.equal((await db.collection<MongoRuntimeDocument>(f.store.collection("DriveImportResult").collectionName).replaceOne({ _id: resultRaw._id }, changedResult, { session, timeoutMS: 5000 })).modifiedCount, 1);
          await session.commitTransaction({ timeoutMS: 5000 }); release.resolve();
          assert.deepEqual(await bounded<Awaited<ReturnType<typeof read>>>(pending), method === "readLatestDriveImportRun" ? runLiteral() : singleLiteral());
        } finally {
          release.resolve(); await settled; patch.mock.restore(); findPatch.mock.restore(); readerWire.stop(); controllerWire.stop();
          await session.endSession({ timeoutMS: 5000 });
        }
        assertReadWire(readerWire);
        const writes = controllerWire.commands.filter(c => ["insert", "update", "delete", "findAndModify"].includes(c.commandName));
        assert.deepEqual(writes.map(c => [c.commandName, c.command.update]), [
          ["update", f.store.collection("DriveImportRun").collectionName], ["update", f.store.collection("DriveImportResult").collectionName]]);
        assert.deepEqual(writes.map(c => c.command.updates[0].q), [{ _id: RID }, { _id: DID }]);
        assert.deepEqual(await read(), method === "readLatestDriveImportRun" ? runLiteral([resultLiteral({ inputValue: "after-controller", fileCount: 99 })], { startedAt: LATER, status: "FAILED" })
          : singleLiteral({ inputValue: "after-controller", fileCount: 99, runStartedAt: LATER, runStatus: "FAILED" }));
      });
    }

    await suite.test("V6 ACTUAL product pending find: server active observed before CSOT, bounded cleanup/server0", async () => {
      let ticks = 0, armed = false;
      const f = await h.fixture(() => !armed || ticks++ === 0 ? 0 : 58_500); await f.seedPair();
      const comment = "drive-pending-" + randomUUID(), cursors = new Set<FindCursor>(), sessions = new Set<ClientSession>();
      const timeoutErrors: unknown[] = []; let injected = false;
      const findPatch = interceptFind(f, (_model, filter, options) => {
        assert.ok(options.session); sessions.add(options.session);
        if (!injected) {
          injected = true; assert.equal(options.timeoutMS, 1500);
          return [{ ...filter, $where: "function(){sleep(5000);return true;}" }, { ...options, comment }];
        }
        return [filter, options];
      }, cursor => cursors.add(cursor));
      const originalArray = FindCursor.prototype.toArray, originalClose = FindCursor.prototype.close, originalEnd = ClientSession.prototype.endSession;
      const closeTimeouts: number[] = [], endTimeouts: number[] = [];
      const arrayPatch = mock.method(FindCursor.prototype, "toArray", async function (this: FindCursor, ...args: Parameters<FindCursor["toArray"]>) {
        try { return await originalArray.apply(this, args); }
        catch (error) { if (cursors.has(this)) timeoutErrors.push(error); throw error; }
      });
      const closePatch = mock.method(FindCursor.prototype, "close", async function (this: FindCursor, ...args: Parameters<FindCursor["close"]>) {
        if (cursors.has(this) && args[0]?.timeoutMS !== undefined) closeTimeouts.push(args[0].timeoutMS);
        return originalClose.apply(this, args);
      });
      const endPatch = mock.method(ClientSession.prototype, "endSession", async function (this: ClientSession, ...args: Parameters<ClientSession["endSession"]>) {
        if (sessions.has(this)) endTimeouts.push(Number(args[0]?.timeoutMS)); return originalEnd.apply(this, args);
      });
      const automaticPatch = mock.method(ClientSession.prototype, "withTransaction", async () => { throw new Error("automatic retry forbidden"); });
      const ledger = wireLedger(h.client, h.databaseName), begin = performance.now();
      armed = true; const pending = f.repo.readLatestDriveImportRun(); const settled = pending.then(() => undefined, error => error);
      try {
        await pollOwnedOperation(h.observer, comment, true, 1000);
        const error = await bounded(settled, 8000); historyFailure(error);
        assert.equal(timeoutErrors.length, 1);
        const underlying = timeoutErrors[0];
        assert.ok(underlying instanceof Error && (underlying.name === "MongoOperationTimeoutError" || underlying instanceof MongoServerError && underlying.code === 50));
        assert.ok(performance.now() - begin < 10_000);
        assert.ok([...cursors].every(cursor => cursor.closed)); assert.ok([...sessions].every(session => session.hasEnded));
        assert.ok(closeTimeouts.includes(5000)); assert.deepEqual(endTimeouts, [5000]);
        await pollOwnedOperation(h.observer, comment, false, 3000);
        assert.equal(ledger.commands.filter(c => c.commandName === "find").length, 1, "제품 재시도 0");
      } finally {
        await settled; ledger.stop(); automaticPatch.mock.restore(); endPatch.mock.restore(); closePatch.mock.restore(); arrayPatch.mock.restore(); findPatch.mock.restore();
        for (const cursor of cursors) await cursor.close({ timeoutMS: 5000 });
        for (const session of sessions) if (!session.hasEnded) await session.endSession({ timeoutMS: 5000 });
      }
      assertReadWire(ledger);
    });

    for (const fault of ["cursor-close", "session-end"] as const) {
      await suite.test("V6 injected cleanup ACK fault AFTER actual local close/end (not server abort failure): " + fault, async () => {
        const f = await h.fixture(); await f.seedPair();
        const cursors = new Set<FindCursor>(), sessions = new Set<ClientSession>(); let injected = 0;
        const findPatch = interceptFind(f, (_model, filter, options) => { if (options.session) sessions.add(options.session); return [filter, options]; }, cursor => cursors.add(cursor));
        const originalClose = FindCursor.prototype.close, originalEnd = ClientSession.prototype.endSession;
        const closePatch = mock.method(FindCursor.prototype, "close", async function (this: FindCursor, ...args: Parameters<FindCursor["close"]>) {
          await originalClose.apply(this, args);
          if (fault === "cursor-close" && cursors.has(this) && args[0]?.timeoutMS === 5000 && injected++ === 0) throw new Error(ERROR_CANARY);
        });
        const endPatch = mock.method(ClientSession.prototype, "endSession", async function (this: ClientSession, ...args: Parameters<ClientSession["endSession"]>) {
          await originalEnd.apply(this, args);
          if (fault === "session-end" && sessions.has(this) && injected++ === 0) throw new Error(ERROR_CANARY);
        });
        try {
          await assert.rejects(f.repo.readLatestDriveImportRun(), historyFailure); assert.ok(injected >= 1);
          assert.ok([...cursors].every(cursor => cursor.closed)); assert.ok([...sessions].every(session => session.hasEnded));
        } finally { endPatch.mock.restore(); closePatch.mock.restore(); findPatch.mock.restore(); }
      });
    }
  }); } finally { fetchPatch.mock.restore(); assert.equal(externalFetches, 0); }
});
