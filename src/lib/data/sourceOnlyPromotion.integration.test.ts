import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { SourceTeam } from "@prisma/client";
import { MongoClient } from "mongodb";
import pg from "pg";
import { activityContext } from "../activity/context";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { IMPORT_PROMOTION_MODELS, MongoImportPromotionRepository, prepareMongoImportPromotionStore } from "./mongoImportPromotionRepository";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";
import { disconnectPrismaClient, getPrismaClient } from "./prisma";
import { PrismaImportPromotionRepository } from "./prismaImportPromotionRepository";

const pgUrl = process.env.SOURCE_ONLY_PROMOTION_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_SOURCE_ONLY_PROMOTION_TEST_URI;
const secret = "Synthetic source-only private";
const fields = (suffix: string) => ({ companyName: `Synthetic Company ${suffix}`, courseName: `Synthetic Course ${suffix}`,
  courseId: suffix, startDate: "2099-01-01", endDate: "2099-01-02", om: "Synthetic OM", ld: "Synthetic LD", specialNotes: secret });
const expected = { sourceRows: 4, promoted: 2, linkedExisting: 1, blocked: 1, blockedReasons: { "Synthetic blocking error": 1 } };
const privacyNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
function installPrivacy() {
  const saved = new Map(privacyNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  return () => { for (const name of privacyNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
}

test("source-only promotion spans import runs and is repeatable on encrypted PostgreSQL", { skip: !pgUrl, timeout: 120_000 }, async () => {
  const url = new URL(pgUrl!); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  const restorePrivacy = installPrivacy(), priorUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = pgUrl;
  const raw = new pg.Client({ connectionString: pgUrl });
  try {
    await raw.connect(); await raw.query("TRUNCATE activity_changes, operation_source_records, data_import_runs, operation_sessions, courses, companies, members CASCADE");
    const db = getPrismaClient();
    await db.member.createMany({ data: [
      { name: "Synthetic OM", normalizedName: "syntheticom", role: "OM", sourceTeam: "TEAM_1", isActive: true, displayOrder: 1 },
      { name: "Synthetic LD", normalizedName: "syntheticld", role: "LD", sourceTeam: "TEAM_1", isActive: true, displayOrder: 2 }
    ] });
    const runIds: string[] = [];
    for (const sourceName of ["Synthetic Run A", "Synthetic Run B"]) runIds.push((await db.dataImportRun.create({ data: { sourceTeam: "TEAM_1", sourceType: "SYNTHETIC", sourceName } })).id);
    const sharedFingerprint = randomBytes(32).toString("hex");
    await db.operationSourceRecord.createMany({ data: [
      { importRunId: runIds[0], sourceTeam: "TEAM_1", sourceWorkbook: "Synthetic Workbook", sourceSheet: "Sheet A", sourceRowNumber: 2, sourceFingerprint: sharedFingerprint, rowSnapshot: {}, mappedFields: fields("A"), validationErrors: [] },
      { importRunId: runIds[1], sourceTeam: "TEAM_1", sourceWorkbook: "Synthetic Workbook", sourceSheet: "Sheet A", sourceRowNumber: 3, sourceFingerprint: sharedFingerprint, rowSnapshot: {}, mappedFields: fields("A duplicate"), validationErrors: [] },
      { importRunId: runIds[1], sourceTeam: "TEAM_1", sourceWorkbook: "Synthetic Workbook", sourceSheet: "Sheet B", sourceRowNumber: 2, sourceFingerprint: randomBytes(32).toString("hex"), rowSnapshot: {}, mappedFields: fields("B"), validationErrors: ["코스ID 누락"] },
      { importRunId: runIds[1], sourceTeam: "TEAM_1", sourceWorkbook: "Synthetic Workbook", sourceSheet: "Sheet B", sourceRowNumber: 3, sourceFingerprint: randomBytes(32).toString("hex"), rowSnapshot: {}, mappedFields: fields("Blocked"), validationErrors: ["Synthetic blocking error"] }
    ] });
    const repo = new PrismaImportPromotionRepository();
    assert.deepEqual(await repo.promoteSourceOnlyRows(SourceTeam.TEAM_1, false), expected);
    assert.equal(await db.operationSession.count(), 0); assert.equal(await db.operationSourceRecord.count({ where: { operationSessionId: { not: null } } }), 0);
    assert.deepEqual(await repo.promoteSourceOnlyRows(SourceTeam.TEAM_1, true), expected);
    assert.equal(await db.operationSession.count(), 2); assert.equal(await db.operationSourceRecord.count({ where: { operationSessionId: { not: null } } }), 3);
    assert.deepEqual(await repo.promoteSourceOnlyRows(SourceTeam.TEAM_1, true), { sourceRows: 1, promoted: 0, linkedExisting: 0, blocked: 1, blockedReasons: { "Synthetic blocking error": 1 } });
    const collision = "abcdef123456";
    const collisionRows = await Promise.all(["1", "2"].map((suffix, index) => db.operationSourceRecord.create({ data: {
      importRunId: runIds[index], sourceTeam: "TEAM_2", sourceWorkbook: "Synthetic Workbook", sourceSheet: `Collision ${suffix}`, sourceRowNumber: 10,
      sourceFingerprint: collision + suffix.repeat(52), rowSnapshot: {}, mappedFields: fields(`Collision ${suffix}`), validationErrors: []
    } })));
    const beforeCollision = { companies: await db.company.count(), courses: await db.course.count(), operations: await db.operationSession.count() };
    await assert.rejects(repo.promoteSourceOnlyRows(SourceTeam.TEAM_2, true));
    assert.deepEqual({ companies: await db.company.count(), courses: await db.course.count(), operations: await db.operationSession.count() }, beforeCollision);
    assert.equal(await db.operationSourceRecord.count({ where: { id: { in: collisionRows.map(row => row.id) }, operationSessionId: { not: null } } }), 0);
    await db.operationSourceRecord.delete({ where: { id: collisionRows[1].id } });
    assert.deepEqual(await repo.promoteSourceOnlyRows(SourceTeam.TEAM_2, true), { sourceRows: 1, promoted: 1, linkedExisting: 0, blocked: 0, blockedReasons: {} });
    const stored = JSON.stringify((await raw.query("SELECT * FROM companies, courses LIMIT 20")).rows) + JSON.stringify((await raw.query("SELECT * FROM operation_sessions LIMIT 20")).rows);
    for (const plaintext of ["Synthetic OM", "Synthetic LD", secret]) assert.equal(stored.includes(plaintext), false, plaintext);
  } finally {
    await disconnectPrismaClient(); await raw.end().catch(() => {}); restorePrivacy(); if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
  }
});

test("source-only promotion spans import runs and is repeatable on prepared Mongo", { skip: !mongoUri, timeout: 120_000 }, async () => {
  const url = new URL(mongoUri!); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.searchParams.get("replicaSet"));
  const restorePrivacy = installPrivacy(), client = new MongoClient(mongoUri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  const databaseName = `hub_om_shadow_source_only_${randomBytes(6).toString("hex")}`, namespace = `shadow_source_only_${randomBytes(6).toString("hex")}`;
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoImportPromotionStore({ ...options, processSequenceHighWater: 0 }); await prepareMongoReadStore(options, ["Member"]);
    const store = new MongoOperationStore(options, [...IMPORT_PROMOTION_MODELS, "Member"]);
    const seed = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    await seed("Member", { role: "OM", sourceTeam: "TEAM_1", name: "Synthetic OM", normalizedName: "syntheticom", isActive: true, displayOrder: 1 });
    await seed("Member", { role: "LD", sourceTeam: "TEAM_1", name: "Synthetic LD", normalizedName: "syntheticld", isActive: true, displayOrder: 2 });
    const runA = await seed("DataImportRun", { sourceTeam: "TEAM_1", sourceType: "SYNTHETIC", sourceName: "Synthetic Run A", status: "COMPLETED", rowCount: 0, successCount: 0, errorCount: 0 });
    const runB = await seed("DataImportRun", { sourceTeam: "TEAM_1", sourceType: "SYNTHETIC", sourceName: "Synthetic Run B", status: "COMPLETED", rowCount: 0, successCount: 0, errorCount: 0 });
    const sharedFingerprint = randomBytes(32).toString("hex");
    for (const [runId, sheet, rowNumber, suffix, errors, fingerprint] of [[runA.id, "Sheet A", 2, "A", [], sharedFingerprint], [runB.id, "Sheet A", 3, "A duplicate", [], sharedFingerprint], [runB.id, "Sheet B", 2, "B", ["코스ID 누락"], randomBytes(32).toString("hex")], [runB.id, "Sheet B", 3, "Blocked", ["Synthetic blocking error"], randomBytes(32).toString("hex")]] as const) {
      await seed("OperationSourceRecord", { importRunId: runId, operationSessionId: null, sourceTeam: "TEAM_1", sourceWorkbook: "Synthetic Workbook", sourceSheet: sheet,
        sourceRowNumber: rowNumber, sourceFingerprint: fingerprint, rowSnapshot: {}, mappedFields: fields(suffix), validationErrors: [...errors] });
    }
    const repo = await MongoImportPromotionRepository.open(options);
    const run = <T>(work: () => Promise<T>) => activityContext.run({ requestId: randomUUID(), actorEmail: null, actorName: null, actorType: "development", route: "source-only-promotion", method: "CLI" }, work);
    assert.deepEqual(await run(() => repo.promoteSourceOnlyRows(SourceTeam.TEAM_1, false)), expected);
    assert.equal(await store.collection("OperationSession").countDocuments(), 0);
    assert.deepEqual(await run(() => repo.promoteSourceOnlyRows(SourceTeam.TEAM_1, true)), expected);
    assert.equal(await store.collection("OperationSession").countDocuments(), 2);
    assert.deepEqual(await run(() => repo.promoteSourceOnlyRows(SourceTeam.TEAM_1, true)), { sourceRows: 1, promoted: 0, linkedExisting: 0, blocked: 1, blockedReasons: { "Synthetic blocking error": 1 } });
    const collision = "abcdef123456";
    const collisionRows = [];
    for (const [runId, suffix] of [[runA.id, "1"], [runB.id, "2"]] as const) collisionRows.push(await seed("OperationSourceRecord", {
      importRunId: runId, operationSessionId: null, sourceTeam: "TEAM_2", sourceWorkbook: "Synthetic Workbook", sourceSheet: `Collision ${suffix}`,
      sourceRowNumber: 10, sourceFingerprint: collision + suffix.repeat(52), rowSnapshot: {}, mappedFields: fields(`Collision ${suffix}`), validationErrors: []
    }));
    const beforeCollision = { companies: await store.collection("Company").countDocuments(), courses: await store.collection("Course").countDocuments(), operations: await store.collection("OperationSession").countDocuments() };
    await assert.rejects(run(() => repo.promoteSourceOnlyRows(SourceTeam.TEAM_2, true)));
    assert.deepEqual({ companies: await store.collection("Company").countDocuments(), courses: await store.collection("Course").countDocuments(), operations: await store.collection("OperationSession").countDocuments() }, beforeCollision);
    assert.equal(await store.collection("OperationSourceRecord").countDocuments({ _id: { $in: collisionRows.map(row => row.id as string) }, operationSessionId: { $ne: null } }), 0);
    await store.collection("OperationSourceRecord").deleteOne({ _id: collisionRows[1].id as string });
    assert.deepEqual(await run(() => repo.promoteSourceOnlyRows(SourceTeam.TEAM_2, true)), { sourceRows: 1, promoted: 1, linkedExisting: 0, blocked: 0, blockedReasons: {} });
    const stored = JSON.stringify(await Promise.all([store.collection("Company").find({}).toArray(), store.collection("Course").find({}).toArray(), store.collection("OperationSession").find({}).toArray()]));
    for (const plaintext of ["Synthetic OM", "Synthetic LD", secret]) assert.equal(stored.includes(plaintext), false, plaintext);
  } finally { try { await client.db(databaseName).dropDatabase(); } finally { await client.close(); restorePrivacy(); } }
});
