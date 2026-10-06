import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { Prisma } from "@prisma/client";
import { runCoachOperationBackfillCommand, runCoachOperationDiagnoseCommand } from "./coachOperationMatchCommand";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { disconnectPrismaClient, getPrismaClient } from "./prisma";
import { PrismaCoachOperationMatchRepository } from "./prismaCoachOperationMatchRepository";

const url = process.env.POSTGRES_COACH_OPERATION_MATCH_TEST_URL;
test("coach operation match repository uses encrypted Prisma reads and idempotent conditional writes on isolated PostgreSQL", { skip: !url, timeout: 120_000 }, async () => {
  const parsed = new URL(url!); assert.equal(parsed.hostname, "127.0.0.1"); assert.equal(parsed.pathname, "/hub_om_match_test");
  assert.ok(parsed.port); assert.equal(parsed.password, "");
  const names = ["DATABASE_URL", "PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: url, PII_ACTIVE_KEY_ID: "match-pg", PII_ENCRYPTION_KEYS: JSON.stringify({ "match-pg": randomBytes(32).toString("base64") }),
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: url }); let connected = false;
  const fixtureIds = { company: randomUUID(), course: randomUUID(), operation: randomUUID(), coach: randomUUID(), engagement: randomUUID(), schedule: randomUUID() };
  try {
    await sql.connect(); connected = true;
    const empty = await sql.query(`SELECT
      (SELECT count(*) FROM companies) + (SELECT count(*) FROM courses) + (SELECT count(*) FROM operation_sessions) +
      (SELECT count(*) FROM coaches) + (SELECT count(*) FROM coach_engagements) + (SELECT count(*) FROM coach_engagement_schedules) AS count`);
    assert.equal(Number(empty.rows[0].count), 0, "isolated PostgreSQL fixture database must be empty");
    const db = getPrismaClient(), now = new Date("2099-06-01T00:00:00.000Z");
    const company = coachFixtureRow("Company", { id: fixtureIds.company, name: "합성 PG 회사", normalizedName: "합성 pg 회사", createdAt: now, updatedAt: now });
    const course = coachFixtureRow("Course", { id: fixtureIds.course, companyId: company.id, processSeq: 8101, courseId: "SYN-PG-8101", name: "합성 PG 매칭 과정", createdAt: now, updatedAt: now });
    const operation = coachFixtureRow("OperationSession", { id: fixtureIds.operation, operationId: "SYN-PG-OP-8101", courseRecordId: course.id,
      startDate: now, endDate: now, educationDates: [now], validationErrors: Prisma.DbNull, deletedAt: null, createdAt: now, updatedAt: now });
    const coach = coachFixtureRow("Coach", { id: fixtureIds.coach, sourceCoachId: "synthetic-pg-coach-match", name: "합성 PG 코치", normalizedName: "합성pg코치",
      status: "ACTIVE", isActive: true, createdAt: now, updatedAt: now, deletedAt: null });
    const engagement = coachFixtureRow("CoachEngagement", { id: fixtureIds.engagement, sourceEngagementId: "synthetic-pg-engagement-match", coachId: coach.id,
      operationSessionId: null, courseName: "합성 PG 매칭 과정", source: "SHEET", status: "SCHEDULED", startDate: now, endDate: now, createdAt: now });
    const schedule = coachFixtureRow("CoachEngagementSchedule", { id: fixtureIds.schedule, sourceEngagementScheduleId: "synthetic-pg-schedule-match",
      engagementId: engagement.id, coachId: coach.id, date: now, startTime: "09:00", endTime: "10:00", cancelledAt: null });
    type Delegate = { createMany(args: { data: Record<string, unknown>[] }): Promise<unknown> };
    const delegates = db as unknown as Record<string, Delegate>;
    for (const [model, row] of [["company", company], ["course", course], ["operationSession", operation], ["coach", coach], ["coachEngagement", engagement], ["coachEngagementSchedule", schedule]] as const) {
      try { await delegates[model].createMany({ data: [row] }); }
      catch (error) { throw new Error(`SYNTHETIC_FIXTURE_FAILED:${model}`, { cause: error }); }
    }
    const raw = await sql.query("SELECT c.name AS coach_name, ce.source_engagement_id FROM coaches c JOIN coach_engagements ce ON ce.coach_id = c.id WHERE ce.id = $1", [engagement.id]);
    assert.match(raw.rows[0].coach_name, /^pii:v1:/); assert.match(raw.rows[0].source_engagement_id, /^pii:v1:/);
    assert.doesNotMatch(JSON.stringify(raw.rows[0]), /합성 PG 코치|synthetic-pg-engagement-match/);
    const repository = new PrismaCoachOperationMatchRepository();
    const diagnosis = await runCoachOperationDiagnoseCommand([], () => {}); assert.deepEqual(diagnosis.counts, { total: 1, matched: 0, unmatched: 1 });
    assert.equal(diagnosis.rows[0].bestOperation, "SYN-PG-OP-8101");
    assert.deepEqual(await runCoachOperationBackfillCommand([], () => {}), { checked: 1, matched: 1, unmatched: 0, updated: 0, apply: false });
    assert.deepEqual(await runCoachOperationBackfillCommand(["--apply"], () => {}), { checked: 1, matched: 1, unmatched: 0, updated: 1, apply: true });
    assert.equal((await repository.readSnapshot()).counts.matched, 1);
    assert.deepEqual(await runCoachOperationBackfillCommand(["--apply"], () => {}), { checked: 0, matched: 0, unmatched: 0, updated: 0, apply: true });
  } finally {
    await disconnectPrismaClient();
    if (connected) {
      for (const [table, id] of [["coach_engagement_schedules", fixtureIds.schedule], ["coach_engagements", fixtureIds.engagement],
        ["coaches", fixtureIds.coach], ["operation_sessions", fixtureIds.operation], ["courses", fixtureIds.course], ["companies", fixtureIds.company]] as const)
        await sql.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      await sql.end();
    }
    for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
