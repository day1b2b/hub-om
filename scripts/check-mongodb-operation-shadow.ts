/** External synthetic runtime check. Never loads env files, reads application collections, or drops a database. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { activityContext } from "../src/lib/activity/context";
import { MongoOperationRepository } from "../src/lib/data/mongoOperationRepository";
import { MongoOperationStore, OPERATION_MODELS, operationMongoValidator, prepareMongoOperationStore } from "../src/lib/data/mongoOperationStore";
import { decodeMongoRuntimeDocument } from "../src/lib/data/mongoRuntimeCodec";
import { operationCreationIdentity, OperationCreationConflict } from "../src/lib/data/operationCreationIdentity";
import type { CreateOperationInput } from "../src/lib/data/operationTypes";
import { configuredMongoUri, mongoConnectionOptions } from "../src/lib/mongodb/connection";
import { isEncrypted } from "../src/lib/privacy/crypto";

let stage = "ARGUMENTS";
let cleanupVerified = false;
let ownedRemaining = 0;
let cleanupPendingCollections: string[] = [];
function payload(key: string): CreateOperationInput {
  const row: CreateOperationInput = {
    companyName: "Synthetic runtime company", courseName: "Synthetic runtime course", courseId: "SYNTHETIC-RUNTIME",
    startDate: "2099-09-21", endDate: "2099-09-23", educationDates: ["2099-09-21", "2099-09-23"],
    archiveStatus: "아카이빙전", operationStatus: "배정필요", operationType: "단기", educationFormat: "오프라인",
    onsiteRequired: "N", revenue: 1200.50, totalCost: 100.25, instructorCost: null, operationCost: null,
    coach: "Synthetic coach", companyWikiLink: "", costRaw: "", driveLink: "", educationDays: "2",
    instructorWikiLink: "", instructors: "Synthetic instructor", ld: "", lectureManagementLink: "",
    om: "Synthetic owner", operationDetail: "Synthetic details", operationIssue: "", padletLink: "",
    region: "", resultReportLink: "", roundNo: "1", specialNotes: "", timeText: "09:00-10:00", createdBy: "synthetic@example.invalid"
  };
  row.creationIdentity = operationCreationIdentity(`synthetic-runtime-key-${key}`, "synthetic@example.invalid", "/synthetic-runtime-check", row);
  return row;
}

async function main() {
  const flags = process.argv.slice(2);
  assert.equal(flags.length, 2);
  assert.equal(new Set(flags).size, 2);
  assert.ok(flags.includes("--allow-synthetic-shadow-writes") && flags.includes("--cleanup-owned-collections"));
  stage = "EXPLICIT_SHADOW_CONFIGURATION";
  assert.equal(process.env.MONGODB_SHADOW_DATABASE, "hub-om-shadow-validation");
  const uri = configuredMongoUri({ MONGODB_URI: process.env.MONGODB_URI });
  const databaseName = "hub-om-shadow-validation";
  const namespace = `shadow_runtime_${randomBytes(12).toString("hex")}`;
  const models = [...OPERATION_MODELS, "__creation", "__counter"];
  const names = models.map(model => `${namespace}_${model}`);
  assert.equal(names.length, 9);
  const owned = new Set<string>();
  const initialValidator = { $jsonSchema: { bsonType: "object", description: `synthetic-owner-${randomBytes(16).toString("hex")}` } };
  const client = new MongoClient(uri, mongoConnectionOptions());
  const db = client.db(databaseName);
  const keys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const previous = keys.map(key => process.env[key]);
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ synthetic_runtime: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "synthetic_runtime";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const checks: string[] = [];
  let syntheticRows = 0;
  try {
    stage = "CONNECT";
    await client.connect();
    stage = "CREATE_OWNED_COLLECTIONS";
    assert.equal((await db.listCollections({ name: { $in: names } }, { nameOnly: true }).toArray()).length, 0);
    // Preflight plus unpredictable create options reject adoption of an existing collection.
    // Mongo create may otherwise report success for an existing name with identical options.
    for (const name of names) {
      await db.command({ create: name, validator: initialValidator, collation: { locale: "simple" }, writeConcern: { w: "majority" } });
      owned.add(name);
      ownedRemaining = owned.size;
    }
    assert.equal(owned.size, 9);
    const options = { client, databaseName, namespace };
    stage = "PREPARE_RUNTIME_STORE";
    await prepareMongoOperationStore({ ...options, allowShadowWrites: true, processSequenceHighWater: 100 });
    const repository = await MongoOperationRepository.open(options);
    const store = new MongoOperationStore(options);
    checks.push("validators_indexes_transactions_ready");
    await activityContext.run({ requestId: randomUUID(), route: "/synthetic-runtime-check", method: "POST", actorEmail: "synthetic@example.invalid", actorName: "Synthetic actor", actorType: "development" }, async () => {
      stage = "CONCURRENT_SAME_SCOPE";
      const input = payload("same-scope");
      const settled = await Promise.allSettled(Array.from({ length: 6 }, () => repository.createOperation(input)));
      const concurrent = settled.map(result => {
        assert.equal(result.status, "fulfilled");
        return result.value;
      });
      const created = concurrent[0];
      assert.equal(new Set(concurrent.map(row => row.id)).size, 1);
      assert.equal(concurrent.filter(row => !row.creationReplayed).length, 1);
      assert.equal(created.processId, "PRC-000101");
      assert.equal((await repository.getOperationById(created.operationId))?.om, input.om);
      checks.push("same_scope_six_requests_one_creation");
      stage = "UPDATE_AND_REPLAY";
      const updated = await repository.updateOperation(created.operationId, { om: "Synthetic updated owner", operationStatus: "진행중", totalCost: 200.25 }, "synthetic@example.invalid");
      assert.equal(updated.profit, 1000.25);
      const replay = await repository.createOperation(input);
      assert.equal(replay.id, created.id);
      assert.equal(replay.creationReplayed, true);
      assert.equal(replay.om, updated.om);
      checks.push("create_read_update_replay");
      stage = "ENCRYPTION_HMAC_AUDIT";
      const raw = await store.collection("OperationSession").findOne({ _id: created.id });
      assert.ok(raw && isEncrypted(raw.omName) && isEncrypted(raw.createdBy));
      assert.ok(!JSON.stringify(raw).includes(updated.om));
      assert.ok(!JSON.stringify(raw).includes("synthetic@example.invalid"));
      assert.equal((await store.findPrivateEqual("OperationSession", "omName", updated.om)).length, 1);
      assert.equal((await store.findPrivateEqual("OperationSession", "omName", "Synthetic absent owner")).length, 0);
      const audit = await store.collection("ActivityChange").find({ targetId: created.id }).toArray();
      assert.equal(audit.length, 2);
      for (const row of audit) {
        assert.ok(isEncrypted(row.actorEmail));
        const plain = decodeMongoRuntimeDocument("ActivityChange", row);
        assert.equal(plain.actorEmail, "synthetic@example.invalid");
        assert.equal(plain.actorName, "Synthetic actor");
      }
      checks.push("encrypted_storage_hmac_authenticated_audit");
      stage = "CONCURRENT_DIFFERENT_FINGERPRINT";
      const race = payload("fingerprint-race");
      const changed = { ...race, om: "Synthetic conflicting owner", creationIdentity: { ...race.creationIdentity!, fingerprint: "e".repeat(64) } };
      const outcomes = await Promise.allSettled([repository.createOperation(race), repository.createOperation(changed)]);
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      const failures = outcomes.filter(result => result.status === "rejected");
      assert.equal(failures.length, 1);
      assert.ok(failures[0].reason instanceof OperationCreationConflict);
      assert.equal(await store.collection("OperationSession").countDocuments(), 2);
      checks.push("concurrent_fingerprint_conflict");
      stage = "SOFT_DELETE_REPLAY_CONFLICT";
      await repository.deleteOperation(created.operationId, "synthetic@example.invalid");
      assert.equal(await repository.getOperationById(created.operationId), null);
      await assert.rejects(repository.createOperation(input), OperationCreationConflict);
      checks.push("soft_delete_replay_conflict");
      stage = "LATE_AUDIT_ROLLBACK";
      const counts = await Promise.all(models.map(model => store.collection(model).countDocuments()));
      const counter = await store.collection("__counter").findOne({ _id: "Course.processSeq" });
      const rollback = { ...payload("rollback"), companyName: "Synthetic rollback company", courseName: "Synthetic rollback course" };
      await db.command({ collMod: store.collection("ActivityChange").collectionName, validator: { $expr: { $ne: ["$targetType", "operation_sessions"] } }, validationLevel: "strict", validationAction: "error" });
      try {
        await assert.rejects(repository.createOperation(rollback), /DATABASE_TRANSACTION_FAILED/);
        assert.deepEqual(await Promise.all(models.map(model => store.collection(model).countDocuments())), counts);
        assert.deepEqual(await store.collection("__counter").findOne({ _id: "Course.processSeq" }), counter);
      } finally {
        await db.command({ collMod: store.collection("ActivityChange").collectionName, validator: operationMongoValidator("ActivityChange"), validationLevel: "strict", validationAction: "error" });
      }
      checks.push("late_audit_full_transaction_rollback");
      syntheticRows = (await Promise.all(models.map(model => store.collection(model).countDocuments()))).reduce((sum, count) => sum + count, 0);
      assert.ok(syntheticRows <= 20);
    });
  } finally {
    let cleanupFailed = false;
    try {
      // Never drop the database or any preexisting collection, including after partial setup failures.
      for (const name of [...owned]) {
        try {
          assert.ok(names.includes(name) && name.startsWith(`${namespace}_`));
          assert.equal(await db.collection(name).drop(), true);
          owned.delete(name);
          ownedRemaining = owned.size;
        } catch { cleanupFailed = true; }
      }
      cleanupVerified = !cleanupFailed && owned.size === 0;
      cleanupPendingCollections = [...owned];
    } finally {
      try { await client.close(); }
      finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
    }
    if (cleanupFailed) { stage = "OWNED_COLLECTION_CLEANUP_FAILED"; throw new Error("CLEANUP_FAILED"); }
  }
  return { ok: true, checks, syntheticRows, createdCollections: 9, cleanupVerified, ownedRemaining, cutoverAuthorized: false };
}

main().then(result => console.log(JSON.stringify(result))).catch(() => {
  // Do not include raw exception messages, URI, credentials, keys, or database document values.
  console.error(JSON.stringify({ ok: false, stage, cleanupVerified, ownedRemaining, cleanupPendingCollections, cutoverAuthorized: false }));
  process.exitCode = 1;
});
