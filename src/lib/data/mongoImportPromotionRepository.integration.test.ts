/**
 * Native storage/concurrency coverage only; independent PG and actual POST oracles
 * belong to their separate suites. Fault/clock injections below are labelled and
 * always delegate to real Mongo storage. They do not simulate a process crash.
 * No env-file loading, application URI fallback, or persistent fixture ownership.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { BSON, ClientSession, Collection, MongoClient, MongoServerError, type CommandStartedEvent } from "mongodb";
import { activityContext } from "../activity/context";
import { isEncrypted } from "../privacy/crypto";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { IMPORT_PROMOTION_MODELS, MongoImportPromotionRepository, prepareMongoImportPromotionStore } from "./mongoImportPromotionRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoDeletedOperationRepository } from "./mongoDeletedOperationRepository";
import { MongoCourseNameRestoreRepository, prepareMongoCourseNameRestoreStore } from "./mongoCourseNameRestoreRepository";
import { CourseNameRestoreConflict } from "./courseNameRestoreRepository";
import { courseNameRestoreGuardCollection } from "./mongoCourseNameRestoreGuard";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MONGO_SCAN_BYTES, MONGO_SCAN_ROWS, MongoOperationError, MongoOperationStore, OPERATION_MODELS, prepareMongoOperationStore, type MongoRow } from "./mongoOperationStore";
import type { CreateOperationInput } from "./operationTypes";

const uri = process.env.MONGODB_IMPORT_PROMOTION_TEST_URI;
const secret = "synthetic-promotion-private@example.invalid";
const om = "가상승격운영자", ld = "가상승격기획자";
const oldDate = new Date("2090-01-01T00:00:00.000Z");
const id = (row: MongoRow) => { assert.equal(typeof row.id, "string"); return row.id as string; };
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Synthetic promotion barrier not reached")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
async function arrived(held: ReturnType<typeof signal>, pending: Promise<unknown>) {
  await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Operation completed before expected barrier"); })]));
}
function attributed<T>(work: () => Promise<T>, requestId: string = randomUUID()) {
  return activityContext.run({ requestId, actorEmail: secret, actorName: om, actorType: "user", route: "/api/admin/imports/[id]/promote", method: "POST" }, work);
}
function safeError(error: unknown) {
  assert.ok(error instanceof MongoOperationError);
  assert.match(error.code, /^[A-Z][A-Z0-9_]+$/);
  assert.equal(error.message, "Mongo operation failed: " + error.code);
  assert.equal(error.cause, undefined);
  for (const value of [secret, om, ld]) assert.ok(!String(error.stack).includes(value));
  return true;
}
function damagedEnvelope(value: string) {
  const pieces = value.split(":"); assert.equal(pieces.length, 6);
  pieces[4] = (pieces[4][0] === "A" ? "B" : "A") + pieces[4].slice(1);
  return pieces.join(":");
}
function fields(suffix = "new") {
  return { companyName: "Synthetic company " + suffix, courseName: "Synthetic course " + suffix, courseId: "123",
    om, ld, startDate: "2099-12-01", endDate: "2099-12-02", specialNotes: secret, revenue: "12.50" };
}
function ordinaryInput(): CreateOperationInput {
  return {
    companyName: "Synthetic ordinary company", courseName: "Synthetic ordinary course", courseId: "456",
    startDate: "2099-12-01", endDate: "2099-12-02", educationDates: ["2099-12-01", "2099-12-02"],
    archiveStatus: "아카이빙전", operationStatus: "배정필요", operationType: "단기", educationFormat: "오프라인",
    onsiteRequired: "N", revenue: null, totalCost: null, instructorCost: null, operationCost: null,
    coach: "", companyWikiLink: "", costRaw: "", driveLink: "", educationDays: "2", instructorWikiLink: "",
    instructors: "", ld, lectureManagementLink: "", om, operationDetail: "", operationIssue: "", padletLink: "",
    region: "", resultReportLink: "", roundNo: "1", specialNotes: secret, timeText: "", createdBy: secret
  };
}

test("import promotion: isolated native Mongo, labelled fault/clock injection", { skip: !uri, timeout: 360_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, "");
  assert.ok(url.pathname === "" || url.pathname === "/"); assert.equal(url.hash, "");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = "hub_om_shadow_promotion_" + randomBytes(12).toString("hex");
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  let owned = false;
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });

  async function fixture(highWater = 100) {
    const options = { client, databaseName, namespace: "shadow_promotion_" + randomBytes(8).toString("hex"), allowShadowWrites: true as const };
    await prepareMongoImportPromotionStore({ ...options, processSequenceHighWater: highWater });
    await prepareMongoReadStore(options, TEAM_READ_MODELS);
    const store = new MongoOperationStore(options, [...new Set([...IMPORT_PROMOTION_MODELS, ...TEAM_READ_MODELS, ...OPERATION_MODELS])]);
    const seed = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, values);
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
    };
    for (const [role, name] of [["OM", om], ["LD", ld]]) await seed("TeamUser", { role, name, team: "1팀", email: role.toLowerCase() + "@example.invalid" });
    const repo = await MongoImportPromotionRepository.open(options);
    const teamMembers = await MongoTeamMemberRepository.open(options);
    const promote = (runId: string, requestId: string = randomUUID()) => attributed(() => runWithDataRepositories({ importPromotion: repo, teamMembers }, () => repo.promoteReadyImportRows(runId)), requestId);
    const run = () => seed("DataImportRun", { sourceType: "SYNTHETIC_PROMOTION", sourceTeam: "TEAM_1", sourceName: secret,
      status: "COMPLETED", rowCount: 0, successCount: 0, errorCount: 0, importedBy: secret });
    const source = (runId: string, rowNumber = 2, values: MongoRow = {}) => seed("OperationSourceRecord", {
      importRunId: runId, operationSessionId: null, sourceTeam: "TEAM_1", sourceWorkbook: secret, sourceSheet: "가상승격시트",
      sourceRowNumber: rowNumber, sourceFingerprint: randomBytes(32).toString("hex"), rowSnapshot: { private: secret },
      mappedFields: fields(), validationErrors: [], createdAt: new Date("2099-01-01"), ...values
    });
    const existing = async (values: MongoRow = {}) => {
      const company = await seed("Company", { name: "Synthetic existing", normalizedName: "synthetic existing" });
      const course = await seed("Course", { companyId: id(company), courseId: "123", name: "Synthetic current", processSeq: 10,
        operationType: "LONG", revenue: "20.00", revenueRaw: "Synthetic revenue" });
      const operation = await seed("OperationSession", { courseRecordId: id(course), operationId: "SYNTHETIC-" + randomUUID(),
        sourceFingerprint: randomBytes(32).toString("hex"), startDate: new Date("2099-12-01"), endDate: new Date("2099-12-02"),
        educationDates: [], deletedAt: null, deletedBy: null, operationStatus: "ASSIGNMENT_NEEDED", onsiteRequired: "N",
        omName: om, ldName: ld, specialNotes: secret, updatedAt: oldDate, ...values });
      return { company, course, operation };
    };
    const names = async () => (await store.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name)
      .filter(name => name.startsWith(options.namespace + "_")).sort();
    const snapshot = async () => {
      const result = [];
      for (const name of await names()) result.push({ name, rows: await store.db.collection(name, { promoteBuffers: false }).find({}).sort({ _id: 1 }).toArray() });
      return result;
    };
    const digest = async () => {
      const hash = createHash("sha256");
      for (const name of await names()) {
        hash.update(name);
        for await (const row of store.db.collection(name, { promoteBuffers: false }).find({}).sort({ _id: 1 })) hash.update(BSON.serialize(row));
      }
      return hash.digest("hex");
    };
    const metadata = async () => {
      const result = [];
      for (const name of await names()) result.push({ name,
        options: (await store.db.listCollections({ name }, { nameOnly: false }).next())?.options,
        indexes: (await store.db.collection(name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name))) });
      return result;
    };
    const counter = () => store.collection("__counter").findOne({ _id: "Course.processSeq" });
    const business = async () => ({ company: await store.collection("Company").countDocuments(), course: await store.collection("Course").countDocuments(),
      operation: await store.collection("OperationSession").countDocuments(), audit: await store.collection("ActivityChange").countDocuments() });
    const ordinary = async () => {
      await prepareMongoOperationStore({ ...options, processSequenceHighWater: highWater });
      return MongoOperationRepository.open(options);
    };
    return { options, store, repo, teamMembers, seed, run, source, existing, promote, snapshot, digest, metadata, counter, business, ordinary };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function wire() {
    const commands: string[] = [];
    const listener = (event: CommandStartedEvent) => { if (event.databaseName === databaseName) commands.push(event.commandName); };
    client.on("commandStarted", listener);
    return { commands, stop: () => client.off("commandStarted", listener) };
  }

  /** Two actual barriers: winner holds a native guard write; loser pauses after
   * a native conflict until the winner commits. No fabricated write conflict. */
  async function orderedGuard<A, B>(f: Fixture, winnerWork: (requestId: string) => Promise<A>, loserWork: (requestId: string) => Promise<B>) {
    const winnerId = randomUUID(), loserId = randomUUID();
    const held = signal(), releaseWinner = signal(), conflicted = signal(), releaseLoser = signal();
    const original = Collection.prototype.updateOne;
    let winnerPaused = false, loserPaused = false, conflicts = 0, loserAttempts = 0;
    const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
      const owner = activityContext.getStore()?.requestId;
      const guard = this.collectionName === courseNameRestoreGuardCollection(f.store).collectionName;
      if (guard && owner === loserId) loserAttempts++;
      try {
        const result = await original.apply(this, args);
        if (guard && owner === winnerId && !winnerPaused) { winnerPaused = true; held.resolve(); await bounded(releaseWinner.promise); }
        return result;
      } catch (error) {
        if (guard && owner === loserId && error instanceof MongoServerError && [112, 11000].includes(Number(error.code))) {
          conflicts++;
          if (!loserPaused) { loserPaused = true; conflicted.resolve(); await bounded(releaseLoser.promise); }
        }
        throw error;
      }
    });
    const winner = winnerWork(winnerId); void winner.catch(() => {});
    let loser: Promise<B> | undefined;
    try {
      await arrived(held, winner);
      loser = loserWork(loserId); void loser.catch(() => {});
      await arrived(conflicted, loser);
      releaseWinner.resolve(); const first = await winner;
      releaseLoser.resolve(); const [second] = await Promise.allSettled([loser]);
      assert.ok(conflicts > 0); assert.ok(loserAttempts >= 2, "Loser retries the guard before predicate reads");
      return { first, second, winnerId, loserId };
    } finally {
      releaseWinner.resolve(); releaseLoser.resolve();
      await Promise.allSettled(loser ? [winner, loser] : [winner]); patch.mock.restore();
    }
  }

  try {
    await client.connect();
    assert.equal((await client.db(databaseName).listCollections().toArray()).length, 0, "Never claim an existing database");
    owned = true;
    const hello = await client.db(databaseName).command({ hello: 1 });
    assert.equal(hello.setName, url.searchParams.get("replicaSet"));
    assert.equal(typeof hello.logicalSessionTimeoutMinutes, "number", "Native transaction support is mandatory; no injected hello acceptance");

    await suite.test("native creation links existing source without changing run, encrypts values and commits attributed audits", async () => {
      const f = await fixture(), run = await f.run(), source = await f.source(id(run)), requestId = randomUUID();
      const beforeRun = await f.store.collection("DataImportRun").findOne({ _id: id(run) });
      const result = await f.promote(id(run), requestId);
      assert.deepEqual(result, { sourceRows: 1, eligible: 1, blocked: 0, blockedReasons: {}, created: 1, linkedExisting: 0, revived: 0 });
      const linked = await f.store.one("OperationSourceRecord", { _id: id(source) }); assert.ok(linked);
      const raw = await f.store.collection("OperationSession").findOne({ _id: String(linked.operationSessionId) }); assert.ok(raw);
      assert.ok(isEncrypted(raw.omName)); assert.match(raw.omNamePiiIndex, /^[a-f0-9]{64}$/);
      assert.equal(decodeMongoRuntimeDocument("OperationSession", raw).specialNotes, secret);
      const audits = await f.store.scan("ActivityChange", { requestId });
      assert.deepEqual(audits.map(row => row.targetType).sort(), ["companies", "courses", "operation_sessions"]);
      assert.ok(audits.every(row => row.actorEmail === secret && row.action === "create"));
      assert.equal((await f.counter())?.value, 101);
      assert.deepEqual(await f.store.collection("DataImportRun").findOne({ _id: id(run) }), beforeRun);
      for (const privateValue of [secret, om, ld]) assert.ok(!JSON.stringify(await f.snapshot()).includes(privateValue));
    });

    for (const parent of ["DataImportRun", "Course", "Company"] as const) {
      await suite.test("native missing required parent " + parent + " rejects with exact raw rollback", async () => {
        const f = await fixture(), run = await f.run();
        if (parent === "DataImportRun") {
          await f.source(id(run));
          await f.store.collection(parent).deleteOne({ _id: id(run) });
        } else {
          const existing = await f.existing();
          await f.source(id(run), 2, { sourceFingerprint: existing.operation.sourceFingerprint });
          await f.store.collection(parent).deleteOne({ _id: id(parent === "Course" ? existing.course : existing.company) });
        }
        const before = await f.snapshot();
        const code = parent === "DataImportRun" ? "IMPORT_PROMOTION_MISSING_RUN"
          : parent === "Course" ? "IMPORT_PROMOTION_MISSING_COURSE" : "IMPORT_PROMOTION_MISSING_COMPANY";
        await assert.rejects(() => f.promote(id(run)), error => { safeError(error); assert.equal((error as MongoOperationError).code, code); return true; });
        assert.deepEqual(await f.snapshot(), before);
      });
    }

    await suite.test("native orphan run rejects even when every source row is blocked", async () => {
      const f = await fixture(), run = await f.run();
      await f.source(id(run), 2, { mappedFields: {}, validationErrors: [secret] });
      await f.store.collection("DataImportRun").deleteOne({ _id: id(run) });
      const before = await f.snapshot();
      await assert.rejects(() => f.promote(id(run)), error => {
        safeError(error); assert.equal((error as MongoOperationError).code, "IMPORT_PROMOTION_MISSING_RUN"); return true;
      });
      assert.deepEqual(await f.snapshot(), before);
    });

    for (const failure of ["after-second-source-link", "audit-native-unique", "late-operation-codec", "operation-id-native-unique"] as const) {
      await suite.test("late " + failure + " rolls back actual business/source/audit/counter/guard bytes", async () => {
        const f = await fixture(), run = await f.run();
        const fingerprint = "0123456789ab";
        await f.source(id(run), 2, { mappedFields: fields("first"), ...(failure === "operation-id-native-unique" ? { sourceFingerprint: fingerprint + "1".repeat(52) } : {}) });
        await f.source(id(run), 3, { mappedFields: { ...fields("second"), ...(failure === "late-operation-codec" ? { sessionDurationDays: "2147483648" } : {}) },
          ...(failure === "operation-id-native-unique" ? { sourceFingerprint: fingerprint + "2".repeat(52) } : {}) });
        if (failure === "audit-native-unique") await f.store.collection("ActivityChange").createIndex({ requestId: 1 }, { unique: true, name: "synthetic_one_audit_per_request" });
        const before = await f.snapshot(); let operations = 0, links = 0, duplicate = 0, audits = 0;
        const insert = Collection.prototype.insertOne, update = Collection.prototype.updateOne;
        const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          try {
            const result = await insert.apply(this, args);
            if (this.collectionName === f.store.collection("OperationSession").collectionName) operations++;
            if (this.collectionName === f.store.collection("ActivityChange").collectionName) audits++;
            return result;
          } catch (error) { if (error instanceof MongoServerError && error.code === 11000) duplicate++; throw error; }
        });
        const updatePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          const result = await update.apply(this, args);
          if (this.collectionName === f.store.collection("OperationSourceRecord").collectionName && ++links === 2 && failure === "after-second-source-link") {
            assert.equal(result.matchedCount, 1); throw new Error(secret); // Fault injection AFTER actual update.
          }
          return result;
        });
        try { await assert.rejects(f.promote(id(run)), safeError); }
        finally { updatePatch.mock.restore(); insertPatch.mock.restore(); }
        if (failure === "audit-native-unique") { assert.equal(duplicate, 1); assert.equal(audits, 1); }
        else { assert.ok(operations >= 1, "Failure must follow a real operation insertion"); assert.ok(links >= 1); }
        if (failure === "operation-id-native-unique") assert.equal(duplicate, 1, "Business duplicate is not blindly replayed");
        if (failure === "after-second-source-link") assert.equal(links, 2);
        assert.deepEqual(await f.snapshot(), before);
      });
    }

    for (const damage of ["cipher", "missing-companion", "wrong-index-key", "wrong-encryption-key"] as const) {
      await suite.test("authenticated source " + damage + " fails safely with raw writes zero", async () => {
        const f = await fixture(), run = await f.run(), source = await f.source(id(run));
        const collection = f.store.collection("OperationSourceRecord");
        if (damage === "cipher") {
          const row = await collection.findOne({ _id: id(source) }); assert.ok(row);
          await collection.updateOne({ _id: id(source) }, { $set: { sourceSheet: damagedEnvelope(row.sourceSheet) } });
        }
        if (damage === "missing-companion") await collection.updateOne({ _id: id(source) }, { $unset: { sourceSheetPiiIndex: "" } }, { bypassDocumentValidation: true });
        const before = await f.snapshot(), indexKey = process.env.PII_INDEX_KEY, encryptionKeys = process.env.PII_ENCRYPTION_KEYS;
        if (damage === "wrong-index-key") process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
        if (damage === "wrong-encryption-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
        try { await assert.rejects(f.promote(id(run)), safeError); }
        finally { process.env.PII_INDEX_KEY = indexKey!; process.env.PII_ENCRYPTION_KEYS = encryptionKeys!; }
        assert.deepEqual(await f.snapshot(), before);
      });
    }

    for (const damage of ["guard-missing", "counter-missing", "counter-behind", "validator", "index"] as const) {
      await suite.test("open refuses " + damage + " without DDL, repair or data writes", async () => {
        const f = await fixture();
        if (damage === "guard-missing") await courseNameRestoreGuardCollection(f.store).drop();
        if (damage === "counter-missing") await f.store.collection("__counter").deleteOne({ _id: "Course.processSeq" });
        if (damage === "counter-behind") { await f.existing(); await f.store.collection("__counter").updateOne({ _id: "Course.processSeq" }, { $set: { value: 0 } }); }
        if (damage === "validator") await f.store.db.command({ collMod: f.store.collection("OperationSession").collectionName, validationLevel: "off" });
        if (damage === "index") {
          const index = (await f.store.collection("OperationSession").listIndexes().toArray()).find(row => row.unique && row.name !== "_id_");
          assert.ok(index?.name); await f.store.collection("OperationSession").dropIndex(index.name);
        }
        const before = await f.snapshot(), metadata = await f.metadata(), evidence = wire();
        try { await assert.rejects(MongoImportPromotionRepository.open(f.options), safeError); }
        finally { evidence.stop(); }
        assert.ok(evidence.commands.length > 0);
        assert.ok(!evidence.commands.some(name => ["insert", "update", "delete", "findAndModify", "create", "createIndexes", "dropIndexes", "collMod", "drop"].includes(name)), evidence.commands.join(","));
        assert.deepEqual(await f.metadata(), metadata); assert.deepEqual(await f.snapshot(), before);
      });
    }

    for (const kind of ["eligible", "mixed", "all-blocked"] as const) {
      await suite.test("same-run " + kind + ": native guard contention, blocked retention and sequential replay", async () => {
        const f = await fixture(), run = await f.run();
        if (kind !== "all-blocked") await f.source(id(run));
        if (kind !== "eligible") await f.source(id(run), 3, { validationErrors: ["Synthetic blocked reason"] });
        const result = await orderedGuard(f, requestId => f.promote(id(run), requestId), requestId => f.promote(id(run), requestId));
        assert.equal(result.first.created, kind === "all-blocked" ? 0 : 1);
        assert.equal(result.first.blocked, kind === "eligible" ? 0 : 1);
        assert.equal(result.second.status, "fulfilled");
        const expected = { sourceRows: kind === "eligible" ? 0 : 1, eligible: 0, blocked: kind === "eligible" ? 0 : 1,
          blockedReasons: kind === "eligible" ? {} : { "Synthetic blocked reason": 1 }, created: 0, linkedExisting: 0, revived: 0 };
        assert.deepEqual(result.second.value, expected);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId: result.loserId }), 0);
        const before = await f.business(); assert.deepEqual(await f.promote(id(run)), expected);
        assert.deepEqual(await f.business(), before);
        assert.equal(await f.store.collection("OperationSourceRecord").countDocuments({ operationSessionId: null }), expected.blocked);
        assert.equal((await f.counter())?.value, kind === "all-blocked" ? 100 : 101);
      });
    }

    await suite.test("different runs, same fingerprint: actual overlapping promotion creates one operation and links both sources", async () => {
      const f = await fixture(), a = await f.run(), b = await f.run(), fingerprint = randomBytes(32).toString("hex");
      const sa = await f.source(id(a), 2, { sourceFingerprint: fingerprint });
      const sb = await f.source(id(b), 2, { sourceFingerprint: fingerprint, sourceTeam: "TEAM_2" });
      const result = await orderedGuard(f, requestId => f.promote(id(a), requestId), requestId => f.promote(id(b), requestId));
      assert.equal(result.first.created, 1); assert.equal(result.second.status, "fulfilled");
      assert.equal(result.second.value.linkedExisting, 1); assert.equal(result.second.value.created, 0);
      const linkedA = await f.store.one("OperationSourceRecord", { _id: id(sa) }), linkedB = await f.store.one("OperationSourceRecord", { _id: id(sb) });
      assert.ok(linkedA?.operationSessionId); assert.equal(linkedB?.operationSessionId, linkedA.operationSessionId);
      assert.deepEqual(await f.business(), { company: 1, course: 1, operation: 1, audit: 3 });
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId: result.loserId }), 0);
    });

    await suite.test("source-only link permits non-participating ordinary soft-delete between read and link commit", async () => {
      const f = await fixture(), ordinary = await f.ordinary(), group = await f.existing(), run = await f.run();
      const source = await f.source(id(run), 2, { sourceFingerprint: group.operation.sourceFingerprint });
      const owner = randomUUID(), held = signal(), release = signal(), update = Collection.prototype.updateOne;
      let paused = false;
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        if (this.collectionName === f.store.collection("OperationSourceRecord").collectionName && activityContext.getStore()?.requestId === owner && !paused) {
          paused = true; held.resolve(); await bounded(release.promise);
        }
        return update.apply(this, args);
      });
      const pending = f.promote(id(run), owner); void pending.catch(() => {});
      let deleted: unknown;
      try {
        await arrived(held, pending);
        await attributed(() => ordinary.deleteOperation(String(group.operation.operationId), secret));
        deleted = await f.store.collection("OperationSession").findOne({ _id: id(group.operation) });
        release.resolve(); const result = await pending;
        assert.equal(result.linkedExisting, 1); assert.equal(result.revived, 0); assert.equal(result.created, 0);
      } finally { release.resolve(); await Promise.allSettled([pending]); patch.mock.restore(); }
      assert.deepEqual(await f.store.collection("OperationSession").findOne({ _id: id(group.operation) }), deleted);
      assert.equal((await f.store.one("OperationSourceRecord", { _id: id(source) }))?.operationSessionId, id(group.operation));
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId: owner }), 0);
      assert.equal((await f.counter())?.value, 100);
      // Opposite ordering: a fresh unlinked source sees the already deleted row.
      const laterRun = await f.run(); await f.source(id(laterRun), 2, { sourceFingerprint: group.operation.sourceFingerprint });
      assert.equal((await f.promote(id(laterRun))).revived, 1);
      assert.equal((await f.store.one("OperationSession", { _id: id(group.operation) }))?.deletedAt, null);
    });

    await suite.test("native same-row conflict retries promotion restore and preserves the ordinary writer's non-patch field", async () => {
      const f = await fixture(), ordinary = await f.ordinary();
      const deleted = await MongoDeletedOperationRepository.open(f.options);
      const group = await f.existing({ deletedAt: oldDate, deletedBy: secret, avgSatisfaction: "old synthetic score" });
      const run = await f.run(); await f.source(id(run), 2, { sourceFingerprint: group.operation.sourceFingerprint });
      const owner = randomUUID(), held = signal(), release = signal(), replace = Collection.prototype.replaceOne;
      let paused = false, nativeConflicts = 0, attempts = 0;
      const patch = mock.method(Collection.prototype, "replaceOne", async function (this: Collection, ...args: Parameters<Collection["replaceOne"]>) {
        const ours = this.collectionName === f.store.collection("OperationSession").collectionName && activityContext.getStore()?.requestId === owner;
        if (ours) {
          attempts++;
          if (!paused) { paused = true; held.resolve(); await bounded(release.promise); }
        }
        try { return await replace.apply(this, args); }
        catch (error) { if (ours && error instanceof MongoServerError && error.code === 112) nativeConflicts++; throw error; }
      });
      const pending = f.promote(id(run), owner); void pending.catch(() => {});
      try {
        await arrived(held, pending);
        // Actual public repositories: make the deleted row editable, then modify
        // a manual field outside promotion's restoration patch and delete again.
        await attributed(() => deleted.restoreOperation(String(group.operation.operationId)));
        await attributed(() => ordinary.updateOperation(String(group.operation.operationId), { avgSatisfaction: "new synthetic score" }, secret));
        await attributed(() => ordinary.deleteOperation(String(group.operation.operationId), secret));
        release.resolve(); assert.equal((await pending).revived, 1);
      } finally { release.resolve(); await Promise.allSettled([pending]); patch.mock.restore(); }
      assert.ok(nativeConflicts >= 1); assert.ok(attempts >= 2);
      const row = await f.store.one("OperationSession", { _id: id(group.operation) }); assert.ok(row);
      assert.equal(row.avgSatisfaction, "new synthetic score"); assert.equal(row.deletedAt, null);
      assert.equal(row.courseRecordId, id(group.course)); assert.equal(row.operationId, group.operation.operationId);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId: owner, action: "restore" }), 1);
    });

    for (const first of ["promotion", "course-restore"] as const) {
      await suite.test("course-name restore guard ordering: " + first + " commits first", async () => {
        const f = await fixture(); await prepareMongoCourseNameRestoreStore({ ...f.options, processSequenceHighWater: 100 });
        const restore = await MongoCourseNameRestoreRepository.open(f.options), group = await f.existing();
        const oldRun = await f.run(); await f.source(id(oldRun), 2, { operationSessionId: id(group.operation), mappedFields: { courseName: "Synthetic restored name" } });
        const run = await f.run(), source = await f.source(id(run), 2, { sourceFingerprint: group.operation.sourceFingerprint,
          mappedFields: { ...fields(), courseName: "Synthetic newest source name" }, createdAt: new Date("2099-02-01") });
        const plan = await restore.planCourseNameRestore("123"); assert.equal(plan.rows[0]?.restorable, true);
        const apply = (requestId: string) => attributed(() => restore.applyCourseNameRestore("123", [String(group.operation.operationId)], plan.snapshot, secret), requestId);
        if (first === "promotion") {
          const result = await orderedGuard(f, requestId => f.promote(id(run), requestId), apply);
          assert.equal(result.first.linkedExisting, 1); assert.equal(result.second.status, "rejected");
          if (result.second.status === "rejected") assert.ok(result.second.reason instanceof CourseNameRestoreConflict);
          assert.equal((await f.store.one("OperationSession", { _id: id(group.operation) }))?.courseRecordId, id(group.course));
          assert.equal(await f.store.collection("Course").countDocuments(), 1);
          assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId: result.loserId }), 0);
        } else {
          const result = await orderedGuard(f, apply, requestId => f.promote(id(run), requestId));
          assert.equal(result.first.moved.length, 1); assert.equal(result.second.status, "fulfilled");
          assert.equal(result.second.value.linkedExisting, 1);
          const operation = await f.store.one("OperationSession", { _id: id(group.operation) }); assert.ok(operation);
          assert.notEqual(operation.courseRecordId, id(group.course));
          assert.equal((await f.store.one("Course", { _id: String(operation.courseRecordId) }))?.name, "Synthetic restored name");
          assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId: result.loserId }), 0);
        }
        assert.equal((await f.store.one("OperationSourceRecord", { _id: id(source) }))?.operationSessionId, id(group.operation));
      });
    }

    // GAP: natural-key parity is under independent review. These provisional
    // Mongo expectations remain strict; no skip/TODO or PG-parity claim.
    // Same-business-key whole-callback retry may link one operation where the
    // original PG upsert path creates two. Independent PG oracle must resolve it.
    for (const winnerRole of ["ordinary", "promotion"] as const) for (const dates of ["same", "different"] as const) {
      await suite.test("native Mongo natural-key outcome (PG tuple oracle is separate), " + dates + " dates: " + winnerRole + " wins actual insert race", async () => {
        const f = await fixture(), ordinary = await f.ordinary(), run = await f.run(), input = ordinaryInput();
        const source = await f.source(id(run), 2, { mappedFields: { ...fields(), companyName: input.companyName,
          courseName: input.courseName, courseId: input.courseId, ...(dates === "different" ? { startDate: "2099-12-05", endDate: "2099-12-06" } : {}) } });
        const winnerId = randomUUID(), loserId = randomUUID(), winnerHeld = signal(), loserHeld = signal(), releaseWinner = signal(), releaseLoser = signal();
        const insert = Collection.prototype.insertOne; let firstPaused = false, secondPaused = false, nativeConflicts = 0;
        const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const owner = activityContext.getStore()?.requestId, company = this.collectionName === f.store.collection("Company").collectionName;
          // Both normal repositories have read a missing natural key in their
          // own actual transactions before either company insertion proceeds.
          if (company && owner === winnerId && !firstPaused) { firstPaused = true; winnerHeld.resolve(); await bounded(releaseWinner.promise); }
          if (company && owner === loserId && !secondPaused) { secondPaused = true; loserHeld.resolve(); await bounded(releaseLoser.promise); }
          try { return await insert.apply(this, args); }
          catch (error) {
            if (company && owner === loserId && error instanceof MongoServerError && [11000, 112].includes(Number(error.code))) nativeConflicts++;
            throw error;
          }
        });
        const ordinaryWork = (requestId: string) => attributed(() => ordinary.createOperation(input), requestId);
        const promotionWork = (requestId: string) => f.promote(id(run), requestId);
        // Keep the heterogeneous result types; assert each branch explicitly.
        const winner = winnerRole === "ordinary" ? ordinaryWork(winnerId) : promotionWork(winnerId); void winner.catch(() => {});
        let loser: ReturnType<typeof ordinaryWork> | ReturnType<typeof promotionWork> | undefined;
        try {
          await arrived(winnerHeld, winner);
          loser = winnerRole === "ordinary" ? promotionWork(loserId) : ordinaryWork(loserId); void loser.catch(() => {});
          await arrived(loserHeld, loser);
          releaseWinner.resolve(); await winner;
          releaseLoser.resolve(); const result = await loser;
          if (winnerRole === "ordinary") {
            assert.ok("linkedExisting" in result);
            assert.equal(result.linkedExisting, dates === "same" ? 1 : 0);
            assert.equal(result.created, dates === "same" ? 0 : 1);
          }
        } finally {
          releaseWinner.resolve(); releaseLoser.resolve(); await Promise.allSettled(loser ? [winner, loser] : [winner]); patch.mock.restore();
        }
        assert.ok(nativeConflicts >= 1, "Native insert race must actually occur; sequential success is insufficient");
        assert.equal(await f.store.collection("Company").countDocuments(), 1);
        assert.equal(await f.store.collection("Course").countDocuments(), 1);
        assert.equal(await f.store.collection("OperationSession").countDocuments(), winnerRole === "ordinary" && dates === "same" ? 1 : 2);
        assert.equal((await f.counter())?.value, 101);
        const linked = await f.store.one("OperationSourceRecord", { _id: id(source) }); assert.ok(linked?.operationSessionId);
        const operation = await f.store.one("OperationSession", { _id: String(linked.operationSessionId) }); assert.ok(operation);
        assert.equal((operation.startDate as Date).toISOString().slice(0, 10), dates === "same" ? "2099-12-01" : "2099-12-05");
        const course = await f.store.one("Course", { _id: String(operation.courseRecordId) }); assert.ok(course);
        assert.equal(course.name, input.courseName); assert.equal(course.courseId, input.courseId);
        const requestAudits = await f.store.scan("ActivityChange", { requestId: loserId });
        if (winnerRole === "ordinary" && dates === "same") assert.equal(requestAudits.length, 0, "Re-reading the existing operation only links its source");
        const before = await f.business(); assert.equal((await f.promote(id(run))).sourceRows, 0); assert.deepEqual(await f.business(), before);
      });
    }

    await suite.test("native counter write conflict with ordinary create retries promotion and gives distinct shared processSeq", async () => {
      const f = await fixture(), ordinary = await f.ordinary(), run = await f.run(); await f.source(id(run));
      const winnerId = randomUUID(), loserId = randomUUID(), held = signal(), conflicted = signal(), releaseWinner = signal(), releaseLoser = signal();
      const increment = Collection.prototype.findOneAndUpdate; let paused = false, loserPaused = false, conflicts = 0, loserAttempts = 0;
      const patch = mock.method(Collection.prototype, "findOneAndUpdate", async function (this: Collection, ...args: Parameters<Collection["findOneAndUpdate"]>) {
        const owner = activityContext.getStore()?.requestId, counter = this.collectionName === f.store.collection("__counter").collectionName;
        if (counter && owner === loserId) loserAttempts++;
        try {
          const result = await increment.apply(this, args);
          if (counter && owner === winnerId && !paused) { paused = true; held.resolve(); await bounded(releaseWinner.promise); }
          return result;
        } catch (error) {
          if (counter && owner === loserId && error instanceof MongoServerError && error.code === 112) {
            conflicts++; if (!loserPaused) { loserPaused = true; conflicted.resolve(); await bounded(releaseLoser.promise); }
          }
          throw error;
        }
      });
      const winner = attributed(() => ordinary.createOperation(ordinaryInput()), winnerId); void winner.catch(() => {});
      let loser: ReturnType<typeof f.promote> | undefined;
      try {
        await arrived(held, winner); loser = f.promote(id(run), loserId); void loser.catch(() => {});
        await arrived(conflicted, loser); releaseWinner.resolve(); await winner;
        releaseLoser.resolve(); assert.equal((await loser).created, 1);
      } finally { releaseWinner.resolve(); releaseLoser.resolve(); await Promise.allSettled(loser ? [winner, loser] : [winner]); patch.mock.restore(); }
      assert.ok(conflicts >= 1); assert.ok(loserAttempts >= 2);
      assert.deepEqual((await f.store.scan("Course")).map(row => row.processSeq).sort(), [101, 102]);
      assert.equal((await f.counter())?.value, 102);
      assert.equal(await f.store.collection("OperationSession").countDocuments(), 2);
      assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId: loserId }), 3);
    });

    await suite.test("promotion and real course-name restore allocate from the same counter under their shared guard", async () => {
      const f = await fixture(); await prepareMongoCourseNameRestoreStore({ ...f.options, processSequenceHighWater: 100 });
      const restore = await MongoCourseNameRestoreRepository.open(f.options), group = await f.existing(), oldRun = await f.run();
      await f.source(id(oldRun), 2, { operationSessionId: id(group.operation), mappedFields: { courseName: "Synthetic restored" } });
      const plan = await restore.planCourseNameRestore("123"), run = await f.run(); await f.source(id(run));
      const result = await orderedGuard(f, requestId => attributed(() => restore.applyCourseNameRestore("123", [String(group.operation.operationId)], plan.snapshot, secret), requestId), requestId => f.promote(id(run), requestId));
      assert.equal(result.first.moved.length, 1); assert.equal(result.second.status, "fulfilled");
      assert.equal(result.second.value.created, 1);
      const sequences = (await f.store.scan("Course")).map(row => Number(row.processSeq)).sort((a, b) => a - b);
      assert.deepEqual(sequences, [10, 101, 102]); assert.equal((await f.counter())?.value, 102);
    });

    await suite.test("explicit high-water/max-stored survives deleting the maximum and reopening; preparation never rewinds it", async () => {
      const f = await fixture(0), group = await f.existing();
      await prepareMongoImportPromotionStore({ ...f.options, processSequenceHighWater: 5 });
      assert.equal((await f.counter())?.value, 10, "Stored maximum beats supplied high-water");
      const maximum = await f.seed("Course", { companyId: id(group.company), courseId: "999", name: "Synthetic unused maximum", processSeq: 150, operationType: "LONG" });
      await prepareMongoImportPromotionStore({ ...f.options, processSequenceHighWater: 140 });
      assert.equal((await f.counter())?.value, 150);
      await f.store.collection("Course").deleteOne({ _id: id(maximum) }); // Owned synthetic fixture only.
      await prepareMongoImportPromotionStore({ ...f.options, processSequenceHighWater: 120 });
      assert.equal((await f.counter())?.value, 150);
      const reopened = await MongoImportPromotionRepository.open(f.options), run = await f.run(); await f.source(id(run));
      const result = await attributed(() => runWithDataRepositories({ importPromotion: reopened, teamMembers: f.teamMembers }, () => reopened.promoteReadyImportRows(id(run))));
      assert.equal(result.created, 1); assert.equal((await f.counter())?.value, 151);
      assert.equal((await f.store.one("Course", { _id: id(group.course) }))?.processSeq, 10);
    });

    await suite.test("Int32MAX accepts read-only target linking and rejects new course allocation atomically", async () => {
      const f = await fixture(2_147_483_647), group = await f.existing(), run = await f.run();
      await f.source(id(run), 2, { sourceFingerprint: group.operation.sourceFingerprint });
      const before = await f.business(), counter = await f.counter(), operation = await f.store.collection("OperationSession").findOne({ _id: id(group.operation) });
      const company = await f.store.collection("Company").findOne({ _id: id(group.company) }), course = await f.store.collection("Course").findOne({ _id: id(group.course) });
      assert.equal((await f.promote(id(run))).linkedExisting, 1);
      assert.deepEqual(await f.business(), before); assert.deepEqual(await f.counter(), counter);
      assert.deepEqual(await f.store.collection("OperationSession").findOne({ _id: id(group.operation) }), operation);
      assert.deepEqual(await f.store.collection("Company").findOne({ _id: id(group.company) }), company);
      assert.deepEqual(await f.store.collection("Course").findOne({ _id: id(group.course) }), course);
      const newRun = await f.run(); await f.source(id(newRun));
      const raw = await f.snapshot();
      await assert.rejects(f.promote(id(newRun)), error => { safeError(error); assert.equal((error as MongoOperationError).code, "IMPORT_PROMOTION_SEQUENCE_EXHAUSTED_OR_MISSING"); return true; });
      assert.deepEqual(await f.snapshot(), raw);
    });

    await suite.test("TransientTransactionError fault injection AFTER actual source link retries callback, not summary or committed rows", async () => {
      const f = await fixture(), run = await f.run(); await f.source(id(run));
      const update = Collection.prototype.updateOne, insert = Collection.prototype.insertOne;
      let links = 0; const attemptedIds: string[] = [];
      const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await insert.apply(this, args);
        if (this.collectionName === f.store.collection("OperationSession").collectionName) attemptedIds.push(String(args[0]._id));
        return result;
      });
      const updatePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const result = await update.apply(this, args);
        if (this.collectionName === f.store.collection("OperationSourceRecord").collectionName && ++links === 1) {
          const error = new MongoServerError({ code: 112, message: secret }); error.addErrorLabel("TransientTransactionError"); throw error;
        }
        return result;
      });
      try { assert.deepEqual(await f.promote(id(run)), { sourceRows: 1, eligible: 1, blocked: 0, blockedReasons: {}, created: 1, linkedExisting: 0, revived: 0 }); }
      finally { updatePatch.mock.restore(); insertPatch.mock.restore(); }
      assert.equal(links, 2); assert.equal(attemptedIds.length, 2); assert.notEqual(attemptedIds[0], attemptedIds[1]);
      assert.equal(await f.store.collection("OperationSession").findOne({ _id: attemptedIds[0] }), null);
      assert.ok(await f.store.collection("OperationSession").findOne({ _id: attemptedIds[1] }));
      assert.deepEqual(await f.business(), { company: 1, course: 1, operation: 1, audit: 3 }); assert.equal((await f.counter())?.value, 101);
    });

    for (const outcome of ["retry-ACK", "unresolved-ACK", "commit-11000"] as const) {
      await suite.test("commit " + outcome + " fault injection AFTER native commit, no callback replay", async () => {
        const f = await fixture(), run = await f.run(); await f.source(id(run));
        const owner = randomUUID(), commit = ClientSession.prototype.commitTransaction;
        let commits = 0, operationInserts = 0, companyKey: unknown;
        const listener = (event: CommandStartedEvent) => {
          if (event.databaseName === databaseName && event.command.insert === f.store.collection("OperationSession").collectionName) operationInserts++;
          if (event.databaseName === databaseName && event.command.insert === f.store.collection("Company").collectionName) companyKey = event.command.documents[0].normalizedName;
        };
        const patch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
          const result = await commit.apply(this, args);
          if (activityContext.getStore()?.requestId === owner && ++commits === 1) {
            const error = new MongoServerError({ code: outcome === "retry-ACK" ? 91 : outcome === "unresolved-ACK" ? 50 : 11000, message: secret,
              ...(outcome === "commit-11000" ? { keyPattern: { normalizedName: 1 }, keyValue: { normalizedName: companyKey } } : {}) });
            if (outcome !== "commit-11000") error.addErrorLabel("UnknownTransactionCommitResult");
            throw error;
          }
          return result;
        });
        client.on("commandStarted", listener);
        try {
          const pending = f.promote(id(run), owner);
          if (outcome === "retry-ACK") assert.equal((await pending).created, 1);
          else await assert.rejects(pending, safeError);
        } finally { patch.mock.restore(); client.off("commandStarted", listener); }
        assert.equal(typeof companyKey, "string");
        assert.equal(commits, outcome === "retry-ACK" ? 2 : 1); assert.equal(operationInserts, 1);
        assert.deepEqual(await f.business(), { company: 1, course: 1, operation: 1, audit: 3 }); assert.equal((await f.counter())?.value, 101);
        assert.equal(await f.store.collection("OperationSourceRecord").countDocuments({ operationSessionId: null }), 0);
        const before = await f.business(); assert.equal((await f.promote(id(run))).sourceRows, 0); assert.deepEqual(await f.business(), before);
        // This injected loss of ACK is known to follow commit. No physical crash
        // or real network failure, and no rollback of an unknown outcome, claimed.
      });
    }

    const duplicateCases: Array<{ model: string; pattern: Record<string, number>; retry: boolean; label: string; value?: "missing" | "mismatch" }> = [
      { model: "Company", pattern: { normalizedName: 1 }, retry: true, label: "exact company natural key" },
      { model: "Course", pattern: { companyId: 1, courseId: 1, name: 1 }, retry: true, label: "exact course natural key" },
      { model: "Company", pattern: { normalizedName: 1 }, retry: false, value: "missing", label: "company keyValue absent" },
      { model: "Course", pattern: { companyId: 1, courseId: 1, name: 1 }, retry: false, value: "missing", label: "course keyValue absent" },
      { model: "Company", pattern: { normalizedName: 1 }, retry: false, value: "mismatch", label: "company keyValue does not match inserted document" },
      { model: "Course", pattern: { companyId: 1, courseId: 1, name: 1 }, retry: false, value: "mismatch", label: "course keyValue does not match inserted document" },
      { model: "Company", pattern: { normalizedName: 1, extra: 1 }, retry: false, label: "company extra key is not the exact natural key" },
      { model: "Company", pattern: { _id: 1 }, retry: false, label: "company primary ID is not a natural-key race" },
      { model: "Course", pattern: { processSeq: 1 }, retry: false, label: "course sequence duplicate is not an upsert race" },
      { model: "OperationSession", pattern: { operationId: 1 }, retry: false, label: "operation ID duplicate" },
      { model: "OperationSession", pattern: { sourceFingerprint: 1 }, retry: false, label: "operation fingerprint duplicate" },
      { model: "ActivityChange", pattern: { normalizedName: 1 }, retry: false, label: "matching keyPattern on the wrong insert" }
    ];
    for (const item of duplicateCases) {
      await suite.test("labelled duplicate fault after actual insert: " + item.label, async () => {
        const f = await fixture(), run = await f.run(); await f.source(id(run));
        const before = await f.snapshot(), insert = Collection.prototype.insertOne; let attempts = 0;
        const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const result = await insert.apply(this, args);
          if (this.collectionName === f.store.collection(item.model).collectionName && ++attempts === 1) {
            // Error classification injection; actual insert has already happened
            // and must be rolled back. This is NOT a native duplicate occurrence.
            const keyValue = Object.fromEntries(Object.keys(item.pattern).map(key => [key, args[0][key]]));
            if (item.value === "mismatch") keyValue[Object.keys(item.pattern)[0]] = "synthetic-other-natural-key";
            throw new MongoServerError({ code: 11000, message: secret, keyPattern: item.pattern,
              ...(item.value === "missing" ? {} : { keyValue }) });
          }
          return result;
        });
        try {
          if (item.retry) assert.equal((await f.promote(id(run))).created, 1);
          else await assert.rejects(f.promote(id(run)), safeError);
        } finally { patch.mock.restore(); }
        if (item.retry) {
          assert.equal(attempts, 2); assert.deepEqual(await f.business(), { company: 1, course: 1, operation: 1, audit: 3 });
          assert.equal((await f.counter())?.value, 101);
        } else { assert.equal(attempts, 1); assert.deepEqual(await f.snapshot(), before); }
      });
    }

    for (const target of ["guard", "company"] as const) {
      await suite.test("labelled " + target + " duplicate injection exhausts five attempts and restores all native writes", async () => {
        const f = await fixture(), run = await f.run(); await f.source(id(run));
        const before = await f.snapshot(), update = Collection.prototype.updateOne, insert = Collection.prototype.insertOne;
        let failures = 0;
        const updatePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          const result = await update.apply(this, args);
          if (target === "guard" && this.collectionName === courseNameRestoreGuardCollection(f.store).collectionName) {
            failures++; throw new MongoServerError({ code: 11000, message: secret, keyPattern: { _id: 1 } });
          }
          return result;
        });
        const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const result = await insert.apply(this, args);
          if (target === "company" && this.collectionName === f.store.collection("Company").collectionName) {
            failures++; throw new MongoServerError({ code: 11000, message: secret, keyPattern: { normalizedName: 1 }, keyValue: { normalizedName: args[0].normalizedName } });
          }
          return result;
        });
        try { await assert.rejects(f.promote(id(run)), safeError); }
        finally { updatePatch.mock.restore(); insertPatch.mock.restore(); }
        assert.equal(failures, 5); assert.deepEqual(await f.snapshot(), before);
      });
    }

    await suite.test("native 20,000 source-row boundary succeeds; 20,001 fails without partial writes", async () => {
      const f = await fixture(), run = await f.run(), first = await f.source(id(run), 1, { validationErrors: ["Synthetic blocked reason"] });
      const collection = f.store.collection("OperationSourceRecord"), base = await collection.findOne({ _id: id(first) }); assert.ok(base);
      assert.equal(MONGO_SCAN_ROWS, 20_000);
      for (let offset = 1; offset < MONGO_SCAN_ROWS; offset += 1000) {
        await collection.insertMany(Array.from({ length: Math.min(1000, MONGO_SCAN_ROWS - offset) }, (_, index) =>
          ({ ...base, _id: randomUUID(), sourceRowNumber: offset + index + 1 })));
      }
      const result = await f.promote(id(run)); assert.equal(result.sourceRows, 20_000); assert.equal(result.blocked, 20_000);
      assert.equal(result.eligible, 0); assert.deepEqual(await f.business(), { company: 0, course: 0, operation: 0, audit: 0 });
      await collection.insertOne({ ...base, _id: randomUUID(), sourceRowNumber: 20_001 });
      const before = await f.digest(); await assert.rejects(f.promote(id(run)), error => {
        safeError(error); assert.equal((error as MongoOperationError).code, "SCAN_LIMIT_EXCEEDED"); return true;
      });
      assert.equal(await f.digest(), before);
    });

    await suite.test("native BSON source scan accepts 32MiB-1/exact, rejects +1 with guard rollback", async () => {
      const f = await fixture(), run = await f.run();
      for (let i = 0; i < 5; i++) await f.source(id(run), i + 2, { validationErrors: ["Synthetic blocked reason"] });
      const collection = f.store.collection("OperationSourceRecord"), rows = await collection.find({ importRunId: id(run) }).sort({ _id: 1 }).toArray();
      assert.equal(MONGO_SCAN_BYTES, 32 * 1024 * 1024);
      const target = MONGO_SCAN_BYTES - 1;
      let remaining = target - rows.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0);
      for (let i = 0; i < rows.length; i++) {
        const length = Math.floor(remaining / (rows.length - i)); remaining -= length;
        rows[i].sourceFingerprint += "x".repeat(length);
        assert.ok(BSON.calculateObjectSize(rows[i]) < 16 * 1024 * 1024);
        await collection.replaceOne({ _id: rows[i]._id }, rows[i]);
      }
      assert.equal(rows.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0), target);
      assert.equal((await f.promote(id(run))).blocked, 5);
      const last = rows[rows.length - 1];
      for (const extra of [1, 2]) {
        const modified = { ...last, sourceFingerprint: last.sourceFingerprint + "x".repeat(extra) };
        await collection.replaceOne({ _id: last._id }, modified);
        assert.equal(rows.slice(0, -1).reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0) + BSON.calculateObjectSize(modified), target + extra);
        if (extra === 1) assert.equal((await f.promote(id(run))).blocked, 5);
        else {
          const before = await f.digest(); await assert.rejects(f.promote(id(run)), error => {
            safeError(error); assert.equal((error as MongoOperationError).code, "SCAN_LIMIT_EXCEEDED"); return true;
          }); assert.equal(await f.digest(), before);
        }
      }
    });

    await suite.test("15s shared scan expiry after actual cursor page (clock injection, no elapsed-time claim)", async () => {
      const f = await fixture(), run = await f.run(); await f.source(id(run));
      const before = await f.snapshot(), find = Collection.prototype.find, now = performance.now.bind(performance);
      let offset = 0, pages = 0;
      const clock = mock.method(performance, "now", () => now() + offset);
      const patch = mock.method(Collection.prototype, "find", function (this: Collection, ...args: Parameters<Collection["find"]>) {
        const cursor = find.apply(this, args);
        if (this.collectionName === f.store.collection("OperationSourceRecord").collectionName) {
          const close = cursor.close.bind(cursor);
          cursor.close = async (...closeArgs: Parameters<typeof cursor.close>) => {
            const result = await close(...closeArgs); if (++pages === 1) offset += 15_001; return result;
          };
        }
        return cursor;
      });
      try { await assert.rejects(f.promote(id(run)), error => { safeError(error); assert.equal((error as MongoOperationError).code, "SCAN_TIMEOUT"); return true; }); }
      finally { patch.mock.restore(); clock.mock.restore(); }
      assert.ok(pages >= 1); assert.deepEqual(await f.snapshot(), before);
    });

    for (const stage of ["roster", "after-write", "transient-retry", "natural-key-retry"] as const) {
      await suite.test("60s total budget at " + stage + " (clock injection over native IO, no wall-clock guarantee)", async () => {
        const f = await fixture(), run = await f.run(); await f.source(id(run));
        const before = await f.snapshot(), now = performance.now.bind(performance), scan = MongoOperationStore.prototype.scan, insert = Collection.prototype.insertOne;
        let offset = 0, injected = false, companyInserts = 0;
        const clock = mock.method(performance, "now", () => now() + offset);
        const scanPatch = mock.method(MongoOperationStore.prototype, "scan", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["scan"]>) {
          const result = await scan.apply(this, args);
          if (stage === "roster" && this.namespace === f.options.namespace && args[0] === "TeamUser" && !injected) { injected = true; offset += 60_001; }
          return result;
        });
        const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const result = await insert.apply(this, args);
          if (this.collectionName === f.store.collection("Company").collectionName) companyInserts++;
          const target = stage === "natural-key-retry" ? "Company" : "OperationSession";
          if (stage !== "roster" && this.collectionName === f.store.collection(target).collectionName && !injected) {
            injected = true; offset += 60_001;
            if (stage === "transient-retry") { const error = new MongoServerError({ code: 112, message: secret }); error.addErrorLabel("TransientTransactionError"); throw error; }
            if (stage === "natural-key-retry") throw new MongoServerError({ code: 11000, message: secret, keyPattern: { normalizedName: 1 }, keyValue: { normalizedName: args[0].normalizedName } });
          }
          return result;
        });
        try { await assert.rejects(f.promote(id(run)), error => {
          safeError(error);
          assert.ok(["IMPORT_PROMOTION_TIMEOUT", "IMPORT_PROMOTION_FAILED"].includes((error as MongoOperationError).code)); return true;
        }); }
        finally { insertPatch.mock.restore(); scanPatch.mock.restore(); clock.mock.restore(); }
        assert.ok(injected); assert.equal(companyInserts, stage === "roster" ? 0 : 1, "Expired retry cannot start a fresh budget");
        assert.deepEqual(await f.snapshot(), before);
      });
    }
  } finally {
    try {
      if (owned) { assert.match(databaseName, /^hub_om_shadow_promotion_[a-f0-9]{24}$/); await client.db(databaseName).dropDatabase(); }
    } finally {
      try { await client.close(); }
      finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
    }
  }
});
