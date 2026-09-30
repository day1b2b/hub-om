import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { PrismaDuplicateCompanyMergeRepository } from "./prismaDuplicateCompanyMergeRepository";
import { disconnectPrismaClient, getPrismaClient } from "./prisma";

const url = process.env.POSTGRES_DUPLICATE_COMPANY_MERGE_TEST_URL;
test("duplicate company merge is atomic and repeatable on isolated PostgreSQL", { skip: !url, timeout: 120_000 }, async () => {
  const parsed = new URL(url!); assert.equal(parsed.hostname, "127.0.0.1"); assert.equal(parsed.pathname, "/hub_om_duplicate_company_test"); assert.ok(parsed.port); assert.equal(parsed.password, "");
  const names = ["DATABASE_URL", "PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const, saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: url, PII_ACTIVE_KEY_ID: "merge-pg", PII_ENCRYPTION_KEYS: JSON.stringify({ "merge-pg": randomBytes(32).toString("base64") }), PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: url }); let connected = false;
  try {
    await sql.connect(); connected = true; const db = getPrismaClient(), repository = new PrismaDuplicateCompanyMergeRepository(db);
    const source = await db.company.create({ data: { id: randomUUID(), name: "Synthetic PG Typo", normalizedName: "synthetic pg typo" } });
    const target = await db.company.create({ data: { id: randomUUID(), name: "Synthetic PG Correct", normalizedName: "synthetic pg correct" } });
    const move = await db.course.create({ data: { companyId: source.id, processSeq: 2001, courseId: "MOVE", name: "Move course" } });
    const merge = await db.course.create({ data: { companyId: source.id, processSeq: 2002, courseId: "MERGE", name: "Merge course" } });
    const destination = await db.course.create({ data: { companyId: target.id, processSeq: 2003, courseId: "MERGE", name: "Merge course" } });
    const movedSession = await db.operationSession.create({ data: { operationId: "synthetic-pg-move", courseRecordId: move.id, startDate: new Date("2099-01-01"), endDate: new Date("2099-01-01") } });
    const mergedSession = await db.operationSession.create({ data: { operationId: "synthetic-pg-merge", courseRecordId: merge.id, startDate: new Date("2099-01-01"), endDate: new Date("2099-01-01") } });
    await db.courseIdLabel.createMany({ data: [{ companyId: source.id, courseId: "MOVE", label: "Move label" }, { companyId: source.id, courseId: "MERGE", label: "Discard label" }, { companyId: target.id, courseId: "MERGE", label: "Keep label" }] });
    const dry = await repository.merge({ sourceName: source.name, targetName: target.name, apply: false }); assert.equal(dry.courses.length, 2); assert.equal(await db.course.count({ where: { companyId: source.id } }), 2);
    await sql.query("CREATE FUNCTION synthetic_merge_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic late failure'; END $$");
    await sql.query("CREATE TRIGGER synthetic_merge_fail BEFORE DELETE ON course_id_labels FOR EACH ROW EXECUTE FUNCTION synthetic_merge_fail()")
    try { await assert.rejects(repository.merge({ sourceName: source.name, targetName: target.name, apply: true })); }
    finally { await sql.query("DROP TRIGGER synthetic_merge_fail ON course_id_labels"); await sql.query("DROP FUNCTION synthetic_merge_fail()") }
    assert.equal(await db.course.count({ where: { companyId: source.id } }), 2); assert.equal((await db.operationSession.findUniqueOrThrow({ where: { id: mergedSession.id } })).courseRecordId, merge.id);
    const applied = await repository.merge({ sourceName: source.name, targetName: target.name, apply: true });
    assert.deepEqual([applied.reassignedCourses, applied.mergedCourses, applied.updatedSessions, applied.reassignedLabels, applied.discardedLabels, applied.remainingCourses], [1, 1, 1, 1, 1, 0]);
    assert.equal(await db.company.count({ where: { id: source.id } }), 1); assert.equal((await db.operationSession.findUniqueOrThrow({ where: { id: mergedSession.id } })).courseRecordId, destination.id);
    assert.ok((await db.operationSession.findUniqueOrThrow({ where: { id: mergedSession.id } })).updatedAt > mergedSession.updatedAt);
    assert.equal((await db.operationSession.findUniqueOrThrow({ where: { id: movedSession.id } })).courseRecordId, move.id);
    const replay = await repository.merge({ sourceName: source.name, targetName: target.name, apply: true }); assert.equal(replay.courses.length, 0);
  } finally { await disconnectPrismaClient(); if (connected) await sql.end(); for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
