import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { BSON, MongoClient } from "mongodb";
import { activityContext } from "../activity/context";
import { isEncrypted } from "../privacy/crypto";
import { operationCreationIdentity, OperationCreationConflict } from "./operationCreationIdentity";
import type { CreateOperationInput } from "./operationTypes";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoOperationStore, MONGO_SCAN_ROWS, completeMongoRow, operationMongoIndexes, operationMongoValidator, prepareMongoOperationStore } from "./mongoOperationStore";

function input(suffix: string): CreateOperationInput {
  const fields: CreateOperationInput = {
    companyName: `Synthetic company ${suffix}`, courseName: `Synthetic course ${suffix}`, courseId: `SYNTHETIC-${suffix}`,
    startDate: "2099-09-21", endDate: "2099-09-23", educationDates: ["2099-09-21", "2099-09-23"],
    archiveStatus: "아카이빙전", operationStatus: "배정필요", operationType: "단기", educationFormat: "오프라인",
    onsiteRequired: "N", revenue: 1200.50, totalCost: 100.25, instructorCost: null, operationCost: null,
    coach: "Synthetic coach", companyWikiLink: "", costRaw: "", driveLink: "", educationDays: "2",
    instructorWikiLink: "", instructors: "Synthetic instructor", ld: "", lectureManagementLink: "",
    om: "Synthetic owner", operationDetail: "Synthetic details", operationIssue: "", padletLink: "",
    region: "", resultReportLink: "", roundNo: "1", specialNotes: "", timeText: "09:00-10:00",
    createdBy: "synthetic@example.invalid"
  };
  fields.creationIdentity = operationCreationIdentity(`synthetic-runtime-key-${suffix}`, "synthetic@example.invalid", "/api/operations", fields);
  return fields;
}

const uri = process.env.MONGODB_RUNTIME_TEST_URI;
/** Never load an env file or infer a server from DATABASE_URL/MONGODB_URI. */
test("Mongo operation repository on a disposable local replica set", { skip: !uri, timeout: 180_000 }, async (suite) => {
  const target = new URL(uri!);
  assert.equal(target.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Only a single loopback MongoDB server is allowed");
  assert.equal(target.username, "");
  assert.equal(target.password, "");
  assert.ok(target.pathname === "" || target.pathname === "/", "Do not supply an existing database");
  assert.ok(target.port, "A disposable local replica-set port is required");
  const { MongoOperationRepository } = await import("./mongoOperationRepository");
  const databaseName = `hub_om_shadow_runtime_test_${randomBytes(12).toString("hex")}`;
  const privacyKeys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(privacyKeys.map((key) => [key, process.env[key]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ runtime_fixture: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "runtime_fixture";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  async function fixture(highWater = 0) {
    const options = { client, databaseName, namespace: `shadow_test_${randomBytes(10).toString("hex")}` };
    await prepareMongoOperationStore({ ...options, allowShadowWrites: true, processSequenceHighWater: highWater });
    return { options, repository: await MongoOperationRepository.open(options), store: new MongoOperationStore(options) };
  }
  try {
    await client.connect();
    await activityContext.run({ requestId: "00000000-0000-4000-8000-000000000001", route: "/api/operations", method: "POST", actorEmail: "synthetic@example.invalid", actorName: "Synthetic actor", actorType: "user" }, async () => {
    await suite.test("create, encrypted read, atomic update, idempotent replay and audit actor", async () => {
      const { repository, store } = await fixture();
      const payload = input("vertical");
      const created = await activityContext.run({ requestId: "00000000-0000-4000-8000-000000000002", route: "/api/operations", method: "POST", actorEmail: "synthetic@example.invalid", actorName: "Synthetic actor", actorType: "user" }, () => repository.createOperation(payload));
      assert.equal(created.companyName, payload.companyName);
      assert.equal(created.om, payload.om);
      assert.equal(created.profit, 1100.25);
      assert.deepEqual(created.educationDates, payload.educationDates);
      assert.equal((await repository.getOperationById(created.operationId))?.id, created.id);
      const stored = await store.collection("OperationSession").findOne({ _id: created.id });
      assert.ok(stored);
      assert.ok(isEncrypted(stored.omName));
      assert.ok(isEncrypted(stored.createdBy));
      assert.match(stored.omNamePiiIndex, /^[a-f0-9]{64}$/);
      const privateMatches = await store.findPrivateEqual("OperationSession", "omName", payload.om);
      assert.equal(privateMatches.length, 1);
      assert.equal(privateMatches[0].id, created.id);
      assert.equal(privateMatches[0].omName, payload.om);
      assert.deepEqual(await store.findPrivateEqual("OperationSession", "omName", "Synthetic absent owner"), []);
      assert.equal((await store.findPrivateEqual("OperationSession", "ldName", null)).length, 1);
      await assert.rejects(store.findPrivateEqual("OperationSession", "operationId", created.operationId), /PRIVATE_EQUALITY_NOT_SUPPORTED/);
      assert.ok(!JSON.stringify(stored).includes(payload.om));
      assert.ok(!JSON.stringify(stored).includes(payload.createdBy!));
      const audit = await store.collection("ActivityChange").find({ requestId: "00000000-0000-4000-8000-000000000002" }).toArray();
      assert.ok(audit.length > 0, "Successful creation must commit its audit record");
      for (const change of audit) {
        assert.ok(isEncrypted(change.actorEmail));
        const plain = decodeMongoRuntimeDocument("ActivityChange", change);
        assert.equal(plain.actorEmail, "synthetic@example.invalid");
        assert.equal(plain.actorName, "Synthetic actor");
      }
      const updated = await repository.updateOperation(created.operationId, { om: "Synthetic changed owner", operationStatus: "진행중", educationDates: ["2099-10-01", "2099-10-04"], totalCost: 200.25 }, "synthetic@example.invalid");
      assert.equal(updated.om, "Synthetic changed owner");
      assert.equal(updated.operationStatus, "진행중");
      assert.equal(updated.startDate, "2099-10-01");
      assert.equal(updated.endDate, "2099-10-04");
      assert.equal(updated.profit, 1000.25);
      const updateAudit = await store.collection("ActivityChange").findOne({ targetId: created.id, action: "update" });
      assert.ok(updateAudit);
      const updateChanges = decodeMongoRuntimeDocument("ActivityChange", updateAudit).changes as Record<string, { before: unknown; after: unknown }>;
      assert.deepEqual(updateChanges.operation_status, { before: "assignment_needed", after: "active" });
      assert.deepEqual(updateChanges.education_dates, { before: ["2099-09-21", "2099-09-23"], after: ["2099-10-01", "2099-10-04"] });
      assert.deepEqual(updateChanges.start_date, { before: "2099-09-21", after: "2099-10-01" });
      const auditCount = await store.collection("ActivityChange").countDocuments();
      const replay = await repository.createOperation(payload);
      assert.equal(replay.id, created.id);
      assert.equal(replay.creationReplayed, true);
      assert.equal(replay.om, updated.om, "Replay must not overwrite a later edit");
      assert.equal(await store.collection("ActivityChange").countDocuments(), auditCount);
      assert.equal((await repository.listOperations()).length, 1);
      assert.equal((await repository.getSummary()).total, 1);
      assert.equal((await repository.findCoursesByCourseId(payload.courseId)).length, 1);
      assert.equal((await repository.findCoursesByCompany(payload.companyName, payload.courseName, 10)).length, 1);
    });

    await suite.test("same-scope concurrent requests create exactly one receipt and reject changed content", async () => {
      const { repository, store } = await fixture();
      const payload = input("concurrent");
      const results = await Promise.all(Array.from({ length: 6 }, () => repository.createOperation(payload)));
      assert.equal(new Set(results.map((row) => row.id)).size, 1);
      assert.equal(results.filter((row) => !row.creationReplayed).length, 1);
      for (const model of ["Company", "Course", "OperationSession", "__creation"]) assert.equal(await store.collection(model).countDocuments(), 1);
      await assert.rejects(repository.createOperation({ ...payload, creationIdentity: { ...payload.creationIdentity!, fingerprint: "f".repeat(64) } }), OperationCreationConflict);
      await repository.deleteOperation(results[0].operationId, "synthetic@example.invalid");
      assert.equal(await repository.getOperationById(results[0].operationId), null);
      assert.deepEqual(await repository.listOperations(), []);
      await assert.rejects(repository.createOperation(payload), OperationCreationConflict);
    });

    await suite.test("same scope with concurrent different fingerprints commits exactly one winner", async () => {
      const { repository, store } = await fixture();
      const payload = input("fingerprint-race");
      const changed = { ...payload, om: "Synthetic conflicting owner", creationIdentity: { ...payload.creationIdentity!, fingerprint: "e".repeat(64) } };
      const results = await Promise.allSettled([repository.createOperation(payload), repository.createOperation(changed)]);
      const success = results.filter(result => result.status === "fulfilled");
      const failure = results.filter(result => result.status === "rejected");
      assert.equal(success.length, 1);
      assert.equal(failure.length, 1);
      assert.ok(failure[0].reason instanceof OperationCreationConflict);
      for (const model of ["Company", "Course", "OperationSession", "__creation"]) assert.equal(await store.collection(model).countDocuments(), 1);
      const rows = await repository.listOperations();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, success[0].value.id);
      assert.equal(rows[0].om, success[0].value.om);
    });

    await suite.test("concurrent distinct courses allocate sequence above the high-water mark", async () => {
      const { repository, store } = await fixture(700);
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => repository.createOperation(input(`sequence-${i}`))));
      assert.equal(new Set(results.map((row) => row.processId)).size, 6);
      const courses = await store.collection("Course").find().toArray();
      assert.deepEqual(courses.map((row) => row.processSeq).sort((a, b) => a - b), [701, 702, 703, 704, 705, 706]);
      assert.equal(await store.collection("OperationSession").countDocuments({ sourceFingerprint: null }), 6);
    });

    await suite.test("late session audit rejection rolls back company, course, session, receipt and counter", async () => {
      const { repository, store } = await fixture(100);
      await store.db.command({ collMod: store.collection("ActivityChange").collectionName, validator: { $expr: { $ne: ["$targetType", "operation_sessions"] } }, validationLevel: "strict", validationAction: "error" });
      await assert.rejects(repository.createOperation(input("rollback")), /DATABASE_TRANSACTION_FAILED/);
      for (const model of ["Company", "Course", "OperationSession", "__creation", "ActivityChange"]) assert.equal(await store.collection(model).countDocuments(), 0, `${model} must roll back`);
      assert.equal((await store.collection("__counter").findOne({ _id: "Course.processSeq" }))?.value, 100);
      await store.db.command({ collMod: store.collection("ActivityChange").collectionName, validator: operationMongoValidator("ActivityChange") });
      assert.equal((await repository.createOperation(input("rollback"))).processId, "PRC-000101");
    });

    await suite.test("late session audit failure during an update rolls back both course and session changes", async () => {
      const { repository, store } = await fixture();
      const created = await repository.createOperation(input("update-rollback"));
      const before = await repository.getOperationById(created.operationId);
      const auditCount = await store.collection("ActivityChange").countDocuments();
      const courseCount = await store.collection("Course").countDocuments();
      await store.db.command({ collMod: store.collection("ActivityChange").collectionName, validator: { $expr: { $ne: ["$targetType", "operation_sessions"] } }, validationLevel: "strict", validationAction: "error" });
      await assert.rejects(repository.updateOperation(created.operationId, { courseName: "Synthetic replacement course", om: "Synthetic changed owner" }, "synthetic@example.invalid"), /DATABASE_TRANSACTION_FAILED/);
      assert.deepEqual(await repository.getOperationById(created.operationId), before);
      assert.equal(await store.collection("Course").countDocuments(), courseCount);
      assert.equal(await store.collection("ActivityChange").countDocuments(), auditCount);
    });

    await suite.test("privacy fallback scan accepts 20,000 rows and rejects 20,001", async () => {
      const { repository, store } = await fixture();
      const created = await repository.createOperation(input("label-scan"));
      const companyId = created.companyId!;
      const now = new Date();
      const rows = Array.from({ length: MONGO_SCAN_ROWS + 1 }, (_, i) => encodeMongoRuntimeDocument("CourseIdLabel", completeMongoRow("CourseIdLabel", {
        id: randomUUID(), companyId, courseId: `synthetic-scan-${i}`, label: "Synthetic label", createdAt: now, updatedAt: now
      })));
      await store.collection("CourseIdLabel").insertMany(rows.slice(0, MONGO_SCAN_ROWS));
      assert.equal((await store.scan("CourseIdLabel")).length, MONGO_SCAN_ROWS);
      await store.collection("CourseIdLabel").insertOne(rows[MONGO_SCAN_ROWS]);
      await assert.rejects(store.scan("CourseIdLabel"), /SCAN_LIMIT_EXCEEDED/);
      assert.equal((await repository.getOperationById(created.operationId))?.courseIdLabel, "");
      const list = await repository.listOperations();
      assert.equal(list.length, 1);
      assert.equal(list[0].id, created.id);
      assert.equal(list[0].courseIdLabel, "");
    });

    await suite.test("server validator rejects malformed documents and partial unique index preserves multiple nulls", async () => {
      const { repository, store } = await fixture();
      const a = await repository.createOperation(input("index-a"));
      await repository.createOperation(input("index-b"));
      await assert.rejects(store.collection("OperationSession").insertOne({ _id: randomUUID(), operationId: "incomplete" }), (error: unknown) => (error as { code?: number }).code === 121);
      const stored = await store.collection("OperationSession").findOne({ _id: a.id });
      assert.ok(stored);
      await store.collection("OperationSession").insertOne({ ...stored, _id: randomUUID(), operationId: "synthetic-fingerprint-a", sourceFingerprint: "synthetic-fingerprint" });
      await assert.rejects(store.collection("OperationSession").insertOne({ ...stored, _id: randomUUID(), operationId: "synthetic-fingerprint-b", sourceFingerprint: "synthetic-fingerprint" }), (error: unknown) => (error as { code?: number }).code === 11000);
      assert.equal(await store.collection("OperationSession").countDocuments({ sourceFingerprint: null }), 2);
    });

    await suite.test("server validators reject plaintext PII, fake envelopes and missing or inconsistent indexes", async () => {
      const { repository, store } = await fixture();
      const created = await repository.createOperation(input("pii-validator"));
      const sessions = store.collection("OperationSession");
      const before = await sessions.findOne({ _id: created.id });
      assert.ok(before);
      const validationError = (error: unknown) => (error as { code?: number }).code === 121;
      for (const mutation of [
        { $set: { validationErrors: { $json: { email: "plain@example.invalid" } } } },
        { $set: { omName: "pii:v1:fake" } },
        { $set: { omName: null } },
        { $unset: { omNamePiiIndex: "" } }
      ]) {
        await assert.rejects(sessions.updateOne({ _id: created.id }, mutation), validationError);
        assert.deepEqual(await sessions.findOne({ _id: created.id }), before);
      }
      await assert.rejects(store.collection("Course").updateOne({ _id: created.courseRecordId }, { $set: { processSeq: 0 } }), validationError);
      assert.equal((await repository.getOperationById(created.operationId))?.om, "Synthetic owner");
    });

    await suite.test("privacy fallback byte budget accepts 24 MiB and rejects 36 MiB below the row cap", async () => {
      const { store } = await fixture();
      const now = new Date();
      const rows = Array.from({ length: 3 }, (_, i) => encodeMongoRuntimeDocument("Company", completeMongoRow("Company", {
        id: randomUUID(), name: "x".repeat(12 * 1024 * 1024), normalizedName: `synthetic-large-${i}`, createdAt: now, updatedAt: now
      })));
      assert.ok(rows.every(row => BSON.calculateObjectSize(row) < 16 * 1024 * 1024));
      await store.collection("Company").insertMany(rows.slice(0, 2));
      assert.equal((await store.scan("Company")).length, 2);
      await store.collection("Company").insertOne(rows[2]);
      await assert.rejects(store.scan("Company"), /SCAN_LIMIT_EXCEEDED/);
    });

    await suite.test("equal PII values do not create audits and changed PII values are redacted", async () => {
      const { repository, store } = await fixture();
      const payload = input("audit-equality");
      const created = await repository.createOperation(payload);
      const initialCount = await store.collection("ActivityChange").countDocuments();
      await repository.updateOperation(created.operationId, { om: payload.om }, "synthetic@example.invalid");
      assert.equal(await store.collection("ActivityChange").countDocuments(), initialCount);
      await repository.updateOperation(created.operationId, { om: "Synthetic private replacement" }, "synthetic@example.invalid");
      assert.equal(await store.collection("ActivityChange").countDocuments(), initialCount + 1);
      const raw = await store.collection("ActivityChange").findOne({ targetId: created.id, action: "update" });
      assert.ok(raw);
      const change = decodeMongoRuntimeDocument("ActivityChange", raw);
      assert.deepEqual(change.changes, { om_name: { redacted: true } });
      assert.ok(!JSON.stringify(raw).includes("Synthetic private replacement"));
    });

    await suite.test("concurrent independent field updates retain both committed changes", async () => {
      const { repository } = await fixture();
      const created = await repository.createOperation(input("concurrent-update"));
      await Promise.all([
        repository.updateOperation(created.operationId, { om: "Synthetic concurrent owner" }),
        repository.updateOperation(created.operationId, { operationIssue: "Synthetic concurrent issue" })
      ]);
      const result = await repository.getOperationById(created.operationId);
      assert.equal(result?.om, "Synthetic concurrent owner");
      assert.equal(result?.operationIssue, "Synthetic concurrent issue");
    });

    await suite.test("combined course changes preserve sibling sessions and lookup ordering", async () => {
      const { repository } = await fixture();
      const original = input("course-combined");
      const created = await repository.createOperation(original);
      const sibling = await repository.createOperation({ ...original, creationIdentity: input("sibling").creationIdentity });
      const beforeSibling = await repository.getOperationById(sibling.operationId);
      const moved = await repository.updateOperation(created.operationId, {
        courseId: "SYNTHETIC-FINAL", courseName: "Synthetic final course", courseIdLabel: "Synthetic final label",
        courseCategory: "Synthetic category", tools: "Synthetic tools", operationStatus: "진행중",
        educationDates: ["2099-10-01"], avgSatisfaction: "4.5", hasResultReport: "유"
      });
      assert.equal(moved.courseId, "SYNTHETIC-FINAL");
      assert.equal(moved.courseName, "Synthetic final course");
      assert.equal(moved.courseIdLabel, "Synthetic final label");
      assert.equal(moved.courseCategory, "Synthetic category");
      assert.equal(moved.tools, "Synthetic tools");
      assert.notEqual(moved.courseRecordId, sibling.courseRecordId);
      assert.deepEqual(await repository.getOperationById(sibling.operationId), beforeSibling);
      const candidates = await repository.findCoursesByCompany(original.companyName, "", 10);
      assert.deepEqual(candidates.map(row => row.courseName), ["Synthetic final course", original.courseName]);
      assert.equal((await repository.findCoursesByCourseId("SYNTHETIC-FINAL"))[0]?.courseName, "Synthetic final course");
      assert.deepEqual((await repository.listOperations()).map(row => row.id), [sibling.id, created.id]);
      assert.deepEqual(await repository.getSummary(), { total: 2, active: 1, assignmentNeeded: 1, archiveNeeded: 0, missingSatisfaction: 1, missingResultReport: 1 });
    });

    await suite.test("more than 20,000 historical source rows do not block latest-source reads", async () => {
      const { repository, store } = await fixture();
      const created = await repository.createOperation(input("source-history"));
      const importRunId = randomUUID();
      const count = MONGO_SCAN_ROWS + 1;
      const rows = Array.from({ length: count }, (_, i) => encodeMongoRuntimeDocument("OperationSourceRecord", completeMongoRow("OperationSourceRecord", {
        id: randomUUID(), importRunId, operationSessionId: created.id, sourceTeam: i === count - 1 ? "TEAM_2" : "TEAM_1",
        sourceWorkbook: "Synthetic workbook", sourceSheet: "Synthetic sheet", sourceRowNumber: i + 1,
        rowSnapshot: { synthetic: true }, createdAt: new Date(Date.UTC(2099, 0, 1) + i)
      })));
      await store.collection("OperationSourceRecord").insertMany(rows);
      assert.equal((await repository.getOperationById(created.operationId))?.sourceTeam, "2팀");
      const list = await repository.listOperations();
      assert.equal(list.length, 1);
      assert.equal(list[0].sourceTeam, "2팀");
    });

    await suite.test("opening fails closed for a missing index, wrong uniqueness, or changed validator", async () => {
      const { options, store } = await fixture();
      const [expected] = operationMongoIndexes("Course");
      assert.ok(expected?.name);
      await store.collection("Course").dropIndex(expected.name);
      await assert.rejects(MongoOperationRepository.open(options), /INDEX_NOT_READY/);
      await store.collection("Course").createIndex(expected.key, { name: expected.name });
      await assert.rejects(MongoOperationRepository.open(options), /INDEX_NOT_READY/);
      await store.collection("Course").dropIndex(expected.name);
      await store.collection("Course").createIndexes([expected]);
      await store.db.command({ collMod: store.collection("Course").collectionName, validator: {} });
      await assert.rejects(MongoOperationRepository.open(options), /VALIDATOR_NOT_READY/);
    });
    });
  } finally {
    try {
      assert.match(databaseName, /^hub_om_shadow_runtime_test_[a-f0-9]{24}$/);
      await client.db(databaseName).dropDatabase();
    } finally {
      await client.close();
      for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  }
});
