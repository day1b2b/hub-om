import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { BSON, ClientSession, Collection, Db, MongoClient, MongoServerError, type CommandStartedEvent } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { StoreImportInput } from "./importStagingWriter";
import { IMPORT_MODELS, MongoImportRepository, prepareMongoImportStore } from "./mongoImportRepository";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { completeMongoRow, MONGO_SCAN_BYTES, MONGO_SCAN_ROWS, MongoOperationError, MongoOperationStore, operationMongoIndexes, type MongoRow } from "./mongoOperationStore";
import { isEncrypted } from "../privacy/crypto";

// No application URI fallback or env-file loading. All documents and keys are synthetic.
const uri = process.env.MONGODB_IMPORT_STAGING_TEST_URI;
const marker = "synthetic-private-import@example.invalid";
const om = "가상임시운영자", ld = "가상임시기획자", instructor = "가상임시강사";
const request = new AsyncLocalStorage<string>();
const safeError = (code: string) => (error: unknown) => {
  assert.ok(error instanceof MongoOperationError);
  assert.equal(error.code, code);
  assert.equal(error.message, `Mongo operation failed: ${code}`);
  assert.equal(error.cause, undefined);
  for (const secret of [marker, om, ld, instructor]) assert.ok(!String(error.stack).includes(secret));
  return true;
};
function input(count = 2): StoreImportInput {
  return {
    sourceName: `${marker}-source`, sourceType: "SYNTHETIC_IMPORT", sourceTeam: "TEAM_1",
    sourceWorkbook: `${marker}-workbook`, sourceSheet: `${marker}-sheet`, fileName: `${marker}.xlsx`, importedBy: marker,
    parsed: { headerRowNumber: 1, rows: Array.from({ length: count }, (_, i) => ({
      rowNumber: i + 2, sourceFingerprint: `synthetic-fingerprint-${i}`,
      mappedFields: { om, ld, instructors: instructor, companyName: "가상 기업", courseName: "가상 과정", startDate: "2099-12-01", endDate: "2099-12-01" },
      rowSnapshot: { private: `${marker}-${i}` }, unmappedFields: { private: marker }, validationErrors: []
    })) }
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function within<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Synthetic import barrier timed out")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
function damagedEnvelope(value: string): string {
  const parts = value.split(":");
  assert.equal(parts.length, 6);
  parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
  return parts.join(":");
}

test("import staging: native Mongo storage with explicitly labelled fault injection", { skip: !uri, timeout: 300_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, "");
  assert.ok(url.pathname === "" || url.pathname === "/");
  assert.equal(url.hash, "");
  // Disallow URI options that could introduce another endpoint, credential or file.
  for (const [name, value] of url.searchParams) {
    assert.ok(name === "replicaSet" || name === "directConnection", "Unsupported synthetic URI option");
    if (name === "directConnection") assert.equal(value, "true");
  }
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const databaseName = `hub_om_shadow_import_${randomBytes(12).toString("hex")}`;
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "fixture";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  let ownsDatabase = false;
  const options = () => ({ client, databaseName, namespace: `shadow_import_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const });

  async function fixture(seedRosters = true) {
    const settings = options();
    await prepareMongoImportStore(settings);
    await prepareMongoReadStore(settings, TEAM_READ_MODELS);
    await prepareMongoReadStore(settings, INSTRUCTOR_NOTE_MODELS);
    const models = [...new Set([...IMPORT_MODELS, ...TEAM_READ_MODELS, ...INSTRUCTOR_NOTE_MODELS])];
    const store = new MongoOperationStore(settings, models);
    const seed = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, values);
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row));
      return row;
    };
    if (seedRosters) {
      for (const [role, name] of [["OM", om], ["LD", ld]]) {
        await seed("TeamUser", { role, name, team: "1팀", email: `${role.toLowerCase()}@example.invalid`, slackId: `synthetic-${role}` });
      }
      await seed("InstructorNote", { instructorName: instructor, recruitAvoid: false });
    }
    const repo = await MongoImportRepository.open(settings);
    const teamMembers = await MongoTeamMemberRepository.open(settings);
    const instructorNote = await MongoInstructorNoteRepository.open(settings);
    const write = (value = input()) => runWithDataRepositories({ imports: repo, teamMembers, instructorNote }, () => repo.storeParsedImport(value));
    const snapshot = async () => {
      const data = [];
      for (const model of models) data.push({ model, rows: await store.collection(model).find({}).sort({ _id: 1 }).toArray() });
      return data;
    };
    const metadata = async () => {
      const collections = (await store.db.listCollections({}, { nameOnly: false }).toArray())
        .filter(item => item.name.startsWith(`${settings.namespace}_`)).sort((a, b) => a.name.localeCompare(b.name));
      const result = [];
      for (const item of collections) result.push({ name: item.name, options: item.options,
        indexes: (await store.db.collection(item.name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name))) });
      return result;
    };
    // Hash exact BSON, including random ciphertext and UUIDs; no logical normalization.
    const digest = async () => {
      const hash = createHash("sha256");
      for (const model of models) {
        hash.update(model);
        for await (const row of store.collection(model).find({}).sort({ _id: 1 })) hash.update(BSON.serialize(row));
      }
      return hash.digest("hex");
    };
    return { settings, store, repo, seed, write, snapshot, metadata, digest };
  }

  try {
    await client.connect();
    const db = client.db(databaseName);
    assert.equal((await db.listCollections().toArray()).length, 0, "Never claim an existing database");
    ownsDatabase = true;
    const hello = await db.command({ hello: 1 });
    const nativeTransactions = (typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number";
    if (!nativeTransactions) {
      await suite.test("native standalone rejects open without creating collections", async () => {
        await assert.rejects(MongoImportRepository.open(options()), safeError("TRANSACTIONS_REQUIRED"));
        assert.deepEqual(await db.listCollections().toArray(), []);
      });
      await suite.test("replica-set storage scenarios require a native transaction-capable server", { skip: "URI points to standalone; no transaction coverage claimed" }, () => {});
      return;
    }

    await suite.test("native encrypted run/rows restore authorized values; list/count/detail issue no DDL or writes", async () => {
      const f = await fixture(), value = input(201);
      const result = await f.write(value);
      assert.equal(result.storedCount, 201); assert.equal(result.errorCount, 0);
      const raw = await f.snapshot(), rawText = JSON.stringify(raw);
      for (const secret of [marker, om, ld, instructor]) assert.ok(!rawText.includes(secret));
      const run = await f.store.collection("DataImportRun").findOne({ _id: result.id }); assert.ok(run);
      assert.ok(isEncrypted(run.sourceName)); assert.ok(isEncrypted(run.importedBy));
      assert.match(run.sourceNamePiiIndex, /^[a-f0-9]{64}$/);
      const row = await f.store.collection("OperationSourceRecord").findOne({ importRunId: result.id }); assert.ok(row);
      assert.ok(isEncrypted(row.rowSnapshot.$json.__pii)); assert.ok(isEncrypted(row.mappedFields.$json.__pii));
      assert.equal(decodeMongoRuntimeDocument("DataImportRun", run).sourceName, value.sourceName);
      const before = await f.metadata(), commands: string[] = [];
      const listener = (event: CommandStartedEvent) => { if (event.databaseName === databaseName) commands.push(event.commandName); };
      client.on("commandStarted", listener);
      try {
        await MongoImportRepository.open(f.settings);
        const list = await f.repo.listImportRuns(), detail = await f.repo.getImportRunById(result.id);
        assert.equal(list.length, 1); assert.equal(list[0].sourceRecordCount, 201);
        assert.equal(list[0].importedBy, marker); assert.equal(list[0].fileName, value.fileName);
        assert.ok(detail); assert.equal(detail.records.length, 200); assert.equal(detail.sourceRecordCount, 201);
        assert.equal(detail.records[0].rowSnapshotPreview[0].value, `${marker}-0`);
        assert.equal(detail.records[0].mappedFields.find(field => field.key === "om")?.value, om);
        assert.equal(await f.repo.getImportRunById(randomUUID()), null);
      } finally { client.off("commandStarted", listener); }
      assert.ok(commands.includes("aggregate"), "list executes native countDocuments");
      assert.ok(commands.includes("find"));
      assert.ok(commands.every(name => ["hello", "listCollections", "listIndexes", "find", "aggregate", "getMore", "killCursors", "commitTransaction", "abortTransaction"].includes(name)), commands.join(","));
      assert.deepEqual(await f.metadata(), before); assert.deepEqual(await f.snapshot(), raw);
    });

    for (const failure of ["row-codec", "native-row-validator", "native-unique-HMAC", "injected-after-row-insert"] as const) {
      await suite.test(`fixed abort after real run insertion: ${failure}${failure === "native-unique-HMAC" ? " (native server error)" : " (fault injection)"}`, async () => {
        const f = await fixture(), before = await f.snapshot(), value = input();
        if (failure === "row-codec") value.sourceSheet = null as unknown as string;
        if (failure === "native-unique-HMAC") value.parsed.rows[1].rowNumber = value.parsed.rows[0].rowNumber;
        const insert = Collection.prototype.insertOne;
        let runs = 0, rows = 0, nativeCode: number | undefined;
        const attemptedSheets: string[] = [];
        const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const run = this.collectionName === f.store.collection("DataImportRun").collectionName;
          const row = this.collectionName === f.store.collection("OperationSourceRecord").collectionName;
          if (row) {
            assert.ok(args[1]?.session?.inTransaction());
            attemptedSheets.push(args[0].sourceSheetPiiIndex);
            if (failure === "native-row-validator" && rows === 1) args[0] = { ...args[0], sourceSheet: null };
          }
          try {
            const result = await insert.apply(this, args);
            if (run) runs++;
            if (row) {
              rows++;
              if (failure === "injected-after-row-insert") throw new Error(marker);
            }
            return result;
          } catch (error) { if (error instanceof MongoServerError) nativeCode = error.code as number; throw error; }
        });
        try { await assert.rejects(f.write(value), safeError("IMPORT_FAILED")); }
        finally { patch.mock.restore(); }
        assert.equal(runs, 1, "run was actually inserted inside the aborted transaction");
        assert.equal(rows, failure === "row-codec" ? 0 : 1);
        if (failure === "native-row-validator") assert.equal(nativeCode, 121);
        if (failure === "native-unique-HMAC") {
          assert.equal(nativeCode, 11000); assert.equal(attemptedSheets.length, 2);
          assert.equal(attemptedSheets[0], attemptedSheets[1], "random encryption retains the existing compound HMAC uniqueness");
        }
        assert.deepEqual(await f.snapshot(), before, "fixed abort leaves every raw collection unchanged");
      });
    }

    for (const corruption of ["source-name-HMAC", "missing-companion", "source-ciphertext", "late-row-ciphertext", "wrong-encryption-key", "wrong-index-key"] as const) {
      await suite.test(`stored corruption rejects reads and writes without an apparent miss: ${corruption} (fixture tampering/key injection)`, async () => {
        // Empty *real* roster collections ensure a wrong key is detected by import preauthentication,
        // rather than accidentally passing this assertion by failing the roster read first.
        const f = await fixture(false), value = input(2);
        const result = await f.write(value);
        const collection = f.store.collection("DataImportRun"), run = await collection.findOne({ _id: result.id }); assert.ok(run);
        const encryptionKey = process.env.PII_ENCRYPTION_KEYS!, indexKey = process.env.PII_INDEX_KEY!;
        if (corruption === "source-name-HMAC") await collection.updateOne({ _id: result.id }, { $set: { sourceNamePiiIndex: "0".repeat(64) } });
        if (corruption === "missing-companion") await collection.updateOne({ _id: result.id }, { $unset: { sourceNamePiiIndex: "" } }, { bypassDocumentValidation: true });
        if (corruption === "source-ciphertext") await collection.updateOne({ _id: result.id }, { $set: { sourceName: damagedEnvelope(run.sourceName) } });
        if (corruption === "late-row-ciphertext") {
          const rows = f.store.collection("OperationSourceRecord");
          const last = await rows.findOne({ importRunId: result.id }, { sort: { _id: -1 } }); assert.ok(last);
          await rows.updateOne({ _id: last._id }, { $set: { "rowSnapshot.$json.__pii": damagedEnvelope(last.rowSnapshot.$json.__pii) } });
        }
        const before = await f.snapshot();
        if (corruption === "wrong-encryption-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
        if (corruption === "wrong-index-key") process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
        let preauthReads = 0;
        const scan = MongoOperationStore.prototype.scan;
        const patch = mock.method(MongoOperationStore.prototype, "scan", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["scan"]>) {
          if (this.namespace === f.settings.namespace && args[0] === "DataImportRun" && args[1]?.sourceType === value.sourceType && !args[1]?.sourceNamePiiIndex) preauthReads++;
          return scan.apply(this, args);
        });
        try {
          if (corruption !== "late-row-ciphertext") await assert.rejects(f.repo.listImportRuns(), safeError("IMPORT_FAILED"));
          await assert.rejects(f.repo.getImportRunById(result.id), safeError("IMPORT_FAILED"));
          await assert.rejects(f.write(value), safeError("IMPORT_FAILED"));
          assert.ok(preauthReads >= 1, "write reached the public sourceType authentication scan");
          assert.deepEqual(await f.snapshot(), before);
        } finally {
          patch.mock.restore(); process.env.PII_ENCRYPTION_KEYS = encryptionKey; process.env.PII_INDEX_KEY = indexKey;
        }
      });
    }

    await suite.test("null relation is valid; missing nonnull operation/course/company refuses the entire detail", async () => {
      const f = await fixture(), result = await f.write(input(1));
      assert.equal((await f.repo.getImportRunById(result.id))?.records[0].linkedOperation, null);
      const company = await f.seed("Company", { name: "가상 기업", normalizedName: "가상기업" });
      const course = await f.seed("Course", { companyId: company.id, processSeq: 1, name: "가상 과정" });
      const operation = await f.seed("OperationSession", { courseRecordId: course.id, deletedAt: new Date("2099-12-02") });
      const rows = f.store.collection("OperationSourceRecord");
      await rows.updateOne({ importRunId: result.id }, { $set: { operationSessionId: operation.id } });
      assert.equal((await f.repo.getImportRunById(result.id))?.records[0].linkedOperation?.operationId, operation.operationId);
      for (const [model, row, code] of [["OperationSession", operation, "IMPORT_MISSING_OPERATION"], ["Course", course, "IMPORT_MISSING_COURSE"], ["Company", company, "IMPORT_MISSING_COMPANY"]] as const) {
        const collection = f.store.collection(model), raw = await collection.findOne({ _id: row.id as string }); assert.ok(raw);
        await collection.deleteOne({ _id: raw._id });
        const before = await f.snapshot();
        try { await assert.rejects(f.repo.getImportRunById(result.id), safeError(code)); assert.deepEqual(await f.snapshot(), before); }
        finally { await collection.insertOne(raw); }
      }
    });

    for (const broken of ["unprepared", "validator", "index", "hello"] as const) {
      await suite.test(`readiness refuses ${broken} without DDL repair${broken === "hello" ? " (injected hello; not a native standalone claim)" : ""}`, async () => {
        const f = await fixture(), settings = broken === "unprepared" ? options() : f.settings;
        await f.write(input(1));
        const collection = f.store.collection("DataImportRun");
        if (broken === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "moderate" });
        if (broken === "index") {
          const name = operationMongoIndexes("DataImportRun").find(index => index.key && Object.hasOwn(index.key, "sourceNamePiiIndex"))?.name;
          assert.ok(name); await collection.dropIndex(name);
        }
        const before = await f.metadata(), raw = await f.snapshot(), commands: string[] = [];
        const command = Db.prototype.command;
        const patch = broken === "hello" ? mock.method(Db.prototype, "command", async function (this: Db, ...args: Parameters<Db["command"]>) {
          if (this.databaseName === databaseName && args[0].hello) return { ok: 1, isWritablePrimary: true, logicalSessionTimeoutMinutes: 30 };
          return command.apply(this, args);
        }) : undefined;
        const listener = (event: CommandStartedEvent) => { if (event.databaseName === databaseName) commands.push(event.commandName); };
        client.on("commandStarted", listener);
        try { await assert.rejects(MongoImportRepository.open(settings), safeError(broken === "hello" ? "TRANSACTIONS_REQUIRED" : broken === "index" ? "INDEX_NOT_READY" : "VALIDATOR_NOT_READY")); }
        finally { patch?.mock.restore(); client.off("commandStarted", listener); }
        assert.ok(commands.every(name => ["hello", "listCollections", "listIndexes", "getMore", "killCursors"].includes(name)), commands.join(","));
        assert.deepEqual(await f.metadata(), before); assert.deepEqual(await f.snapshot(), raw);
        if (broken === "unprepared") assert.deepEqual((await f.store.db.listCollections().toArray()).filter(item => item.name.startsWith(`${settings.namespace}_`)), []);
      });
    }

    for (const schedule of ["both-read-before-either-commit", "second-read-after-first-commit"] as const) {
      await suite.test(`native duplicate concurrency with explicit barriers: ${schedule}`, async () => {
        const f = await fixture(), reached = deferred(), release = deferred(), events: string[] = [];
        const insert = Collection.prototype.insertOne, scan = MongoOperationStore.prototype.scan;
        let arrivals = 0;
        const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          if (schedule === "both-read-before-either-commit" && this.collectionName === f.store.collection("DataImportRun").collectionName) {
            // Every prior duplicate read used the actual session/cursor. No writes yet.
            events.push(`${request.getStore()}-dedup-complete`);
            if (++arrivals === 2) reached.resolve();
            await within(release.promise);
          }
          return insert.apply(this, args);
        });
        let heldSecond = false;
        const scanPatch = mock.method(MongoOperationStore.prototype, "scan", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["scan"]>) {
          if (schedule === "second-read-after-first-commit" && this.namespace === f.settings.namespace && request.getStore() === "second" && args[0] === "DataImportRun" && !heldSecond) {
            heldSecond = true; events.push("second-before-snapshot"); reached.resolve();
            await within(release.promise); events.push("second-snapshot-start");
          }
          return scan.apply(this, args);
        });
        const calls: ReturnType<typeof f.write>[] = [];
        const launch = (name: string) => {
          const pending = request.run(name, () => f.write(input(1)));
          calls.push(pending); void pending.catch(() => {}); return pending;
        };
        try {
          if (schedule === "both-read-before-either-commit") {
            const first = launch("first"), second = launch("second");
            await within(reached.promise);
            assert.equal(arrivals, 2);
            assert.equal(await f.store.collection("DataImportRun").countDocuments(), 0);
            release.resolve();
            const results = await Promise.all([first, second]);
            assert.deepEqual(results.map(result => [result.storedCount, result.duplicateCount]), [[1, 0], [1, 0]]);
            assert.equal(new Set(results.map(result => result.id)).size, 2);
          } else {
            const second = launch("second");
            await within(reached.promise);
            const first = await launch("first"); events.push("first-committed");
            assert.equal(first.storedCount, 1);
            assert.equal(await f.store.collection("OperationSourceRecord").countDocuments(), 1);
            release.resolve();
            const result = await second;
            assert.equal(result.storedCount, 0); assert.equal(result.duplicateCount, 1);
            assert.deepEqual(events, ["second-before-snapshot", "first-committed", "second-snapshot-start"]);
          }
        } finally {
          release.resolve(); await Promise.allSettled(calls); scanPatch.mock.restore(); insertPatch.mock.restore();
        }
        const rowCount = schedule === "both-read-before-either-commit" ? 2 : 1;
        assert.equal(await f.store.collection("DataImportRun").countDocuments(), 2);
        assert.equal(await f.store.collection("OperationSourceRecord").countDocuments(), rowCount);
        const replay = await f.write(input(1));
        assert.deepEqual({ stored: replay.storedCount, duplicates: replay.duplicateCount, errors: replay.errorCount }, { stored: 0, duplicates: 1, errors: 1 });
        assert.equal(await f.store.collection("DataImportRun").countDocuments(), 3);
        assert.equal(await f.store.collection("OperationSourceRecord").countDocuments(), rowCount);
        const replayRun = await f.store.one("DataImportRun", { _id: replay.id }); assert.ok(replayRun);
        assert.equal(replayRun.rowCount, 1); assert.equal(replayRun.successCount, 0);
        assert.deepEqual(replayRun.validationLogs, [{ rowNumber: 2, errors: ["이미 같은 행이 저장되어 있어 중복 저장하지 않았습니다."] }]);
      });
    }

    await suite.test("TransientTransactionError injection after a native row insert retries the actual session callback once", async () => {
      const f = await fixture(), insert = Collection.prototype.insertOne;
      const runIds: string[] = [], rowIds: string[] = [];
      let injected = false;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await insert.apply(this, args);
        if (this.collectionName === f.store.collection("DataImportRun").collectionName) runIds.push(String(args[0]._id));
        if (this.collectionName === f.store.collection("OperationSourceRecord").collectionName) {
          rowIds.push(String(args[0]._id));
          if (!injected) {
            injected = true;
            const error = new MongoServerError({ code: 112, message: marker });
            error.addErrorLabel("TransientTransactionError"); throw error;
          }
        }
        return result;
      });
      let result;
      try { result = await f.write(input(1)); }
      finally { patch.mock.restore(); }
      assert.equal(runIds.length, 2); assert.equal(new Set(runIds).size, 1);
      assert.equal(rowIds.length, 2); assert.notEqual(rowIds[0], rowIds[1]);
      assert.equal(result.id, runIds[0]); assert.equal(result.storedCount, 1);
      assert.equal(await f.store.collection("DataImportRun").countDocuments(), 1);
      assert.equal(await f.store.collection("OperationSourceRecord").countDocuments(), 1);
      assert.equal(await f.store.collection("OperationSourceRecord").findOne({ _id: rowIds[0] }), null, "aborted attempt's row does not survive");
      assert.ok(await f.store.collection("OperationSourceRecord").findOne({ _id: rowIds[1], importRunId: result.id }));
    });

    for (const outcome of ["retry-ACK", "unresolved-ACK"] as const) {
      await suite.test(`UnknownTransactionCommitResult ${outcome} injection follows native commit; never claim rollback`, async () => {
        const f = await fixture(), commit = ClientSession.prototype.commitTransaction;
        const requestId = randomUUID(); let commits = 0, runInserts = 0;
        const listener = (event: CommandStartedEvent) => {
          if (event.databaseName === databaseName && event.command.insert === f.store.collection("DataImportRun").collectionName) runInserts++;
        };
        const patch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
          const result = await commit.apply(this, args);
          if (request.getStore() === requestId && ++commits === 1) {
            // Native commit has completed. Only its acknowledgement is lost to the caller.
            const error = new MongoServerError({ code: outcome === "retry-ACK" ? 91 : 50, message: marker });
            error.addErrorLabel("UnknownTransactionCommitResult"); throw error;
          }
          return result;
        });
        client.on("commandStarted", listener);
        try {
          const pending = request.run(requestId, () => f.write(input(2)));
          if (outcome === "retry-ACK") assert.equal((await pending).storedCount, 2);
          else await assert.rejects(pending, safeError("IMPORT_FAILED"));
        } finally { patch.mock.restore(); client.off("commandStarted", listener); }
        assert.equal(commits, outcome === "retry-ACK" ? 2 : 1); assert.equal(runInserts, 1, "commit retries must not replay the callback");
        const runs = await f.store.collection("DataImportRun").find({}).toArray();
        const rows = await f.store.collection("OperationSourceRecord").find({}).toArray();
        assert.equal(runs.length, 1); assert.equal(rows.length, 2);
        assert.ok(rows.every(row => row.importRunId === runs[0]._id));
        // For this injection the server definitely committed; unresolved ACK must not auto-delete.
        const replay = await f.write(input(2));
        assert.equal(replay.storedCount, 0); assert.equal(replay.duplicateCount, 2);
        assert.equal(await f.store.collection("OperationSourceRecord").countDocuments(), 2);
      });
    }

    await suite.test("native shared-store row boundary accepts 20,000; 20,001 refuses list and sourceType preauthentication without writes", async () => {
      const f = await fixture();
      const base = encodeMongoRuntimeDocument("DataImportRun", completeMongoRow("DataImportRun", {
        id: randomUUID(), sourceTeam: "TEAM_1", sourceType: input().sourceType, sourceName: "synthetic-boundary",
        status: "COMPLETED", rowCount: 0, successCount: 0, errorCount: 0, startedAt: new Date("2099-12-01")
      }));
      // Reuse encrypted synthetic values; every persisted document still has a distinct valid UUID.
      for (let offset = 0; offset < MONGO_SCAN_ROWS; offset += 1000) {
        await f.store.collection("DataImportRun").insertMany(Array.from({ length: 1000 }, () => ({ ...base, _id: randomUUID() })));
      }
      assert.equal(MONGO_SCAN_ROWS, 20_000);
      assert.equal((await f.store.scan("DataImportRun")).length, 20_000);
      await f.store.collection("DataImportRun").insertOne({ ...base, _id: randomUUID() });
      const before = await f.digest();
      await assert.rejects(f.repo.listImportRuns(), safeError("SCAN_LIMIT_EXCEEDED"));
      // Different sourceName has no HMAC candidates, but must still authenticate all same-type runs.
      await assert.rejects(f.write(input(1)), safeError("SCAN_LIMIT_EXCEEDED"));
      assert.equal(await f.digest(), before);
    });

    await suite.test("native BSON byte boundary: 32 MiB minus one and exact limit succeed; plus one refuses whole detail", async () => {
      const f = await fixture(), result = await f.write(input(5));
      const collection = f.store.collection("OperationSourceRecord");
      const rows = await collection.find({ importRunId: result.id }).sort({ _id: 1 }).toArray();
      // Padding is a public fingerprint string, so exact bytes are independent of AES/base64 sizing.
      const target = MONGO_SCAN_BYTES - 1;
      assert.equal(MONGO_SCAN_BYTES, 32 * 1024 * 1024);
      let remaining = target - rows.reduce((size, row) => size + BSON.calculateObjectSize(row), 0);
      for (let i = 0; i < rows.length; i++) {
        const padding = Math.floor(remaining / (rows.length - i));
        rows[i].sourceFingerprint += "x".repeat(padding); remaining -= padding;
        assert.ok(BSON.calculateObjectSize(rows[i]) < 16 * 1024 * 1024, "every document remains below native BSON's 16 MiB limit");
        await collection.replaceOne({ _id: rows[i]._id }, rows[i]);
      }
      assert.equal(rows.reduce((size, row) => size + BSON.calculateObjectSize(row), 0), target);
      assert.equal((await f.repo.getImportRunById(result.id))?.records.length, 5);
      const last = rows[rows.length - 1];
      for (const extra of [1, 2]) {
        const updated = { ...last, sourceFingerprint: last.sourceFingerprint + "x".repeat(extra) };
        await collection.replaceOne({ _id: last._id }, updated);
        assert.equal(rows.slice(0, -1).reduce((size, row) => size + BSON.calculateObjectSize(row), 0) + BSON.calculateObjectSize(updated), target + extra);
        if (extra === 1) assert.equal((await f.repo.getImportRunById(result.id))?.records.length, 5);
        else {
          const before = await f.digest();
          await assert.rejects(f.repo.getImportRunById(result.id), safeError("SCAN_LIMIT_EXCEEDED"));
          assert.equal(await f.digest(), before);
        }
      }
    });

    await suite.test("15s shared scan deadline after a native page (clock injection; no real waiting)", async () => {
      const f = await fixture(), result = await f.write(input(1)), before = await f.snapshot();
      const find = Collection.prototype.find, now = performance.now.bind(performance);
      let elapsed = 0, pages = 0;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(Collection.prototype, "find", function (this: Collection, ...args: Parameters<Collection["find"]>) {
        const cursor = find.apply(this, args);
        if (this.collectionName === f.store.collection("OperationSourceRecord").collectionName) {
          const close = cursor.close.bind(cursor);
          // Actual cursor and page; advance the clock only after the page has been consumed.
          cursor.close = async (...closeArgs: Parameters<typeof cursor.close>) => {
            const value = await close(...closeArgs);
            if (++pages === 1) elapsed += 15_001;
            return value;
          };
        }
        return cursor;
      });
      try { await assert.rejects(f.repo.getImportRunById(result.id), safeError("SCAN_TIMEOUT")); }
      finally { patch.mock.restore(); clock.mock.restore(); }
      assert.ok(pages >= 1); assert.deepEqual(await f.snapshot(), before);
    });

    for (const operation of ["list", "detail", "write", "retry-write", "roster-write"] as const) {
      await suite.test(`${operation} uses the total ${operation === "list" || operation === "detail" ? "30" : "60"}s deadline (clock injection over native operations)`, async () => {
        const f = await fixture(), existing = await f.write(input(1)), before = await f.snapshot();
        const read = operation === "list" || operation === "detail";
        const now = performance.now.bind(performance), scan = MongoOperationStore.prototype.scan, insert = Collection.prototype.insertOne;
        let elapsed = 0, injected = false, runInserts = 0;
        const clock = mock.method(performance, "now", () => now() + elapsed);
        const scanPatch = mock.method(MongoOperationStore.prototype, "scan", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["scan"]>) {
          const result = await scan.apply(this, args);
          const target = operation === "list" ? "DataImportRun" : operation === "detail" ? "OperationSourceRecord" : operation === "roster-write" ? "InstructorNote" : undefined;
          if (this.namespace === f.settings.namespace && args[0] === target && !injected) {
            injected = true; elapsed += read ? 30_001 : 60_001;
          }
          return result;
        });
        const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const result = await insert.apply(this, args);
          if (this.collectionName === f.store.collection("DataImportRun").collectionName) runInserts++;
          if (this.collectionName === f.store.collection("OperationSourceRecord").collectionName && !injected && !read) {
            injected = true; elapsed += 60_001;
            if (operation === "retry-write") {
              const error = new MongoServerError({ code: 112, message: marker });
              error.addErrorLabel("TransientTransactionError"); throw error;
            }
          }
          return result;
        });
        const value = input(1); value.sourceName += "-new";
        try {
          const pending = operation === "list" ? f.repo.listImportRuns() : operation === "detail" ? f.repo.getImportRunById(existing.id) : f.write(value);
          // Driver CSOT may consume the advanced clock before the repository's retry check.
          // Both paths must stop and sanitize; neither may restart a fresh 60-second budget.
          if (operation === "retry-write") await assert.rejects(pending, error => {
            assert.ok(error instanceof MongoOperationError);
            assert.ok(["IMPORT_TIMEOUT", "IMPORT_FAILED"].includes(error.code));
            return safeError(error.code)(error);
          });
          else await assert.rejects(pending, safeError("IMPORT_TIMEOUT"));
        } finally { insertPatch.mock.restore(); scanPatch.mock.restore(); clock.mock.restore(); }
        assert.ok(injected);
        assert.equal(runInserts, read || operation === "roster-write" ? 0 : 1, "no fresh write attempt after total budget expiry");
        assert.deepEqual(await f.snapshot(), before);
      });
    }
  } finally {
    try {
      if (ownsDatabase) {
        assert.match(databaseName, /^hub_om_shadow_import_[a-f0-9]{24}$/);
        await client.db(databaseName).dropDatabase();
      }
    } finally {
      try { await client.close(); }
      finally {
        for (const name of envNames) {
          const value = saved.get(name);
          if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
      }
    }
  }
});
