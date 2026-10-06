import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import pg from "pg";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { IMPORT_PROMOTION_MODELS, MongoImportPromotionRepository, prepareMongoImportPromotionStore } from "./mongoImportPromotionRepository";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";
import type { OperationImportEntry } from "./operationImportRepository";
import { disconnectPrismaClient, getPrismaClient } from "./prisma";
import { PrismaOperationImportRepository } from "./prismaOperationImportRepository";

const pgUrl = process.env.OPERATION_IMPORT_PG_TEST_DATABASE_URL, mongoUri = process.env.MONGODB_OPERATION_IMPORT_TEST_URI;
const privateText = "Synthetic operation import private";
const entry = (id: string): OperationImportEntry => ({ operationId: id, companyName: "Synthetic Company", courseName: "Synthetic Course", courseId: "COURSE-1", startDate: "2099-01-01", endDate: "2099-01-02", sourceTeam: "1팀", om: "Synthetic OM", ld: "Synthetic LD", specialNotes: privateText });
const expectedDry = { operations: 2, inserted: 1, updated: 1, sourceRecordsInserted: 2, sourceRecordsSkipped: 0 };
const privacyNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
function privacy() { const saved = new Map(privacyNames.map(name => [name, process.env[name]])); Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" }); return () => { for (const name of privacyNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }; }

test("operation JSON import is dry-run safe, encrypted and repeatable on PostgreSQL", { skip: !pgUrl, timeout: 120_000 }, async () => {
  const restore = privacy(), prior = process.env.DATABASE_URL; process.env.DATABASE_URL = pgUrl; const raw = new pg.Client({ connectionString: pgUrl });
  try {
    await raw.connect(); await raw.query("TRUNCATE activity_changes, operation_source_records, data_import_runs, operation_sessions, courses, companies, members CASCADE"); const db = getPrismaClient();
    await db.member.createMany({ data: [{ name: "Synthetic OM", normalizedName: "syntheticom", role: "OM", sourceTeam: "TEAM_1", isActive: true }, { name: "Synthetic LD", normalizedName: "syntheticld", role: "LD", sourceTeam: "TEAM_1", isActive: true }] });
    const repo = new PrismaOperationImportRepository(db), rows = [entry("OP-1"), entry("OP-2")];
    assert.deepEqual(await repo.importOperations(rows, "synthetic.json", false), expectedDry); assert.equal(await db.operationSession.count(), 0);
    assert.deepEqual(await repo.importOperations(rows, "synthetic.json", true), expectedDry); assert.equal(await db.operationSession.count(), 1); assert.equal(await db.operationSourceRecord.count(), 2);
    assert.deepEqual(await repo.importOperations(rows, "synthetic.json", true), { operations: 2, inserted: 0, updated: 2, sourceRecordsInserted: 0, sourceRecordsSkipped: 2 });
    const stored = JSON.stringify((await raw.query("SELECT * FROM operation_sessions")).rows) + JSON.stringify((await raw.query("SELECT * FROM operation_source_records")).rows) + JSON.stringify((await raw.query("SELECT * FROM activity_changes")).rows); assert.equal(stored.includes(privateText), false); assert.equal(stored.includes("Synthetic OM"), false);
    const before = { runs: await db.dataImportRun.count(), operations: await db.operationSession.count() };
    await assert.rejects(repo.importOperations([{ ...entry("OVERFLOW"), companyName: "Rollback Company", revenue: "999999999999999999" }], "synthetic.json", true));
    assert.deepEqual({ runs: await db.dataImportRun.count(), operations: await db.operationSession.count() }, before);
  } finally { await disconnectPrismaClient(); await raw.end().catch(() => {}); restore(); if (prior === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior; }
});

test("operation JSON import is dry-run safe, encrypted and repeatable on prepared Mongo", { skip: !mongoUri, timeout: 120_000 }, async () => {
  const restore = privacy(), client = new MongoClient(mongoUri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 }); const databaseName = `hub_om_shadow_operation_import_${randomBytes(5).toString("hex")}`, namespace = `shadow_operation_import_${randomBytes(5).toString("hex")}`;
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const }; await prepareMongoImportPromotionStore({ ...options, processSequenceHighWater: 0 }); await prepareMongoReadStore(options, ["Member"]);
    const store = new MongoOperationStore(options, [...IMPORT_PROMOTION_MODELS, "Member"]); const seed = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); };
    await seed("Member", { name: "Synthetic OM", normalizedName: "syntheticom", role: "OM", sourceTeam: "TEAM_1", isActive: true, displayOrder: 1 }); await seed("Member", { name: "Synthetic LD", normalizedName: "syntheticld", role: "LD", sourceTeam: "TEAM_1", isActive: true, displayOrder: 2 });
    const repo = await MongoImportPromotionRepository.open(options), rows = [entry("OP-1"), entry("OP-2")]; assert.deepEqual(await repo.importOperations(rows, "synthetic.json", false), expectedDry); assert.equal(await store.collection("OperationSession").countDocuments(), 0);
    assert.deepEqual(await repo.importOperations(rows, "synthetic.json", true), expectedDry); assert.equal(await store.collection("OperationSession").countDocuments(), 1); assert.equal(await store.collection("OperationSourceRecord").countDocuments(), 2);
    assert.deepEqual(await repo.importOperations(rows, "synthetic.json", true), { operations: 2, inserted: 0, updated: 2, sourceRecordsInserted: 0, sourceRecordsSkipped: 2 });
    const stored = JSON.stringify(await Promise.all([store.collection("OperationSession").find({}).toArray(), store.collection("OperationSourceRecord").find({}).toArray(), store.collection("ActivityChange").find({}).toArray()])); assert.equal(stored.includes(privateText), false); assert.equal(stored.includes("Synthetic OM"), false);
    const before = { runs: await store.collection("DataImportRun").countDocuments(), operations: await store.collection("OperationSession").countDocuments() };
    await assert.rejects(repo.importOperations([{ ...entry("OVERFLOW"), companyName: "Rollback Company", revenue: "999999999999999999" }], "synthetic.json", true));
    assert.deepEqual({ runs: await store.collection("DataImportRun").countDocuments(), operations: await store.collection("OperationSession").countDocuments() }, before);
  } finally { try { await client.db(databaseName).dropDatabase(); } finally { await client.close(); restore(); } }
});
