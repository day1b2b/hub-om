import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { pruneActivityBatch } from "./retention";
import { withActivityDatabase } from "./database";
import { activityContext, type ActivityContext } from "./context";

const url = process.env.ACTIVITY_TEST_DATABASE_URL;

test("activity triggers and attribution on isolated PostgreSQL", { skip: !url }, async (t) => {
  const parsed = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname.startsWith("/activity_test"), "Integration tests require a dedicated local activity_test database");
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, options: "-c timezone=UTC" }) });
  const db = withActivityDatabase(raw);
  const context = (name: string): ActivityContext => ({ requestId: randomUUID(), actorEmail: `${name}@example.test`, actorName: name, actorType: "development", route: "/api/test", method: "PATCH" });
  const one = context("one");
  const two = context("two");
  const prefix = randomUUID();
  let companyId = "";
  let coachId = "";
  const requestIds = [one.requestId, two.requestId];
  try {
    await t.test("standalone create and nested private data are atomic and sanitized", async () => {
      const company = await activityContext.run(one, () => db.company.create({ data: { name: `${prefix}-A`, normalizedName: prefix } }));
      companyId = company.id;
      const coach = await activityContext.run(one, () => db.coach.create({ data: {
        sourceCoachId: prefix, name: "테스트 코치", normalizedName: prefix, accessToken: "never-store-token",
        managerNote: "never-store-free-text", privateProfile: { create: { phone: "never-store-phone" } }
      } }));
      coachId = coach.id;
      const logs = await raw.activityChange.findMany({ where: { requestId: one.requestId } });
      assert.equal(logs.length, 3);
      assert.ok(logs.every((log) => Math.abs(Date.now() - log.occurredAt.getTime()) < 10000), "timestamps must not shift with the database server timezone");
      assert.ok(logs.every((log) => log.actorEmail === one.actorEmail));
      assert.ok(!JSON.stringify(logs).includes("never-store"));
      const companyLog = logs.find((log) => log.targetType === "companies")!;
      assert.deepEqual((companyLog.changes as Record<string, unknown>).name, { before: null, after: `${prefix}-A` });
    });
    await t.test("no-op saves do not create history; long values compare before truncation", async () => {
      const before = await raw.activityChange.count({ where: { targetId: companyId } });
      await activityContext.run(one, () => db.company.update({ where: { id: companyId }, data: { name: `${prefix}-A` } }));
      assert.equal(await raw.activityChange.count({ where: { targetId: companyId } }), before);
      await activityContext.run(one, () => db.company.update({ where: { id: companyId }, data: { name: "x".repeat(700) + "A" } }));
      await activityContext.run(one, () => db.company.update({ where: { id: companyId }, data: { name: "x".repeat(700) + "B" } }));
      assert.equal(await raw.activityChange.count({ where: { targetId: companyId } }), before + 2);
      const long = await raw.activityChange.findFirstOrThrow({ where: { targetId: companyId }, orderBy: { occurredAt: "desc" } });
      assert.ok(JSON.stringify(long.changes).includes('"truncated":true'));
    });
    await t.test("callback transaction rollback also rolls back all history", async () => {
      const before = await raw.activityChange.count({ where: { requestId: two.requestId } });
      await assert.rejects(activityContext.run(two, () => db.$transaction(async (tx) => {
        await tx.company.update({ where: { id: companyId }, data: { name: "rollback-me" } });
        throw new Error("expected rollback");
      })));
      assert.notEqual((await raw.company.findUniqueOrThrow({ where: { id: companyId } })).name, "rollback-me");
      assert.equal(await raw.activityChange.count({ where: { requestId: two.requestId } }), before);
    });
    await t.test("concurrent updates capture the actual prior committed row and keep actors isolated", async () => {
      await raw.company.update({ where: { id: companyId }, data: { name: "initial" } });
      let release!: () => void;
      const started = new Promise<void>((resolve) => { release = resolve; });
      const first = activityContext.run(one, () => db.$transaction(async (tx) => {
        await tx.company.update({ where: { id: companyId }, data: { name: "first" } });
        release();
        await tx.$queryRaw`SELECT pg_sleep(0.1)::text`;
      }));
      await started;
      const second = activityContext.run(two, () => db.company.update({ where: { id: companyId }, data: { name: "second" } }));
      await Promise.all([first, second]);
      const logs = await raw.activityChange.findMany({ where: { targetId: companyId, requestId: two.requestId } });
      assert.equal(logs.length, 1);
      assert.deepEqual((logs[0].changes as Record<string, unknown>).name, { before: "first", after: "second" });
      assert.equal(logs[0].actorEmail, two.actorEmail);
    });
    await t.test("failed audit insertion rejects the business save", async () => {
      const invalid = { ...one, requestId: "not-a-uuid" };
      await assert.rejects(activityContext.run(invalid, () => db.company.update({ where: { id: companyId }, data: { name: "must-not-save" } })));
      assert.equal((await raw.company.findUniqueOrThrow({ where: { id: companyId } })).name, "second");
    });
    await t.test("soft delete, restore, hard delete and cascades survive target removal", async () => {
      await activityContext.run(one, () => db.coach.update({ where: { id: coachId }, data: { deletedAt: new Date() } }));
      await activityContext.run(one, () => db.coach.update({ where: { id: coachId }, data: { deletedAt: null } }));
      await activityContext.run(one, () => db.coach.delete({ where: { id: coachId } }));
      const logs = await raw.activityChange.findMany({ where: { targetId: coachId } });
      assert.ok(logs.some((log) => log.action === "restore"));
      assert.equal(logs.filter((log) => log.action === "delete").length, 3); // soft delete, coach delete, private-profile cascade
      assert.equal(await raw.coach.count({ where: { id: coachId } }), 0);
    });
    await t.test("transaction-local actor does not leak to later non-API writes", async () => {
      const before = await raw.activityChange.count({ where: { targetId: companyId } });
      await db.company.update({ where: { id: companyId }, data: { name: "script-without-context" } });
      assert.equal(await raw.activityChange.count({ where: { targetId: companyId } }), before);
    });
    await t.test("retention removes expired records without cascading to surviving history", async () => {
      const requestId = randomUUID();
      const oldChangeId = randomUUID();
      const freshChangeId = randomUUID();
      requestIds.push(requestId);
      await raw.activityRequest.create({ data: {
        id: requestId, occurredAt: new Date(Date.now() - 31 * 86400000), actorType: "development", route: "/api/test", method: "GET", status: 200, durationMs: 1
      } });
      const data = { requestId, actorType: "development", route: "/api/test", method: "PATCH", targetType: "companies", targetId: companyId, action: "update", changes: {} };
      await raw.activityChange.create({ data: { ...data, id: oldChangeId, occurredAt: new Date(Date.now() - 366 * 86400000) } });
      await raw.activityChange.create({ data: { ...data, id: freshChangeId } });
      await raw.$transaction(pruneActivityBatch);
      assert.equal(await raw.activityRequest.count({ where: { id: requestId } }), 0);
      assert.equal(await raw.activityChange.count({ where: { id: oldChangeId } }), 0);
      assert.equal(await raw.activityChange.count({ where: { id: freshChangeId } }), 1);
    });
    await t.test("bulk update records each affected row under one request", async () => {
      await raw.company.create({ data: { name: `${prefix}-B`, normalizedName: `${prefix}-B` } });
      await activityContext.run(two, () => db.company.updateMany({ where: { normalizedName: { startsWith: prefix } }, data: { name: "bulk" } }));
      const logs = await raw.activityChange.findMany({ where: { requestId: two.requestId } });
      assert.equal(logs.filter((log) => (log.changes as Record<string, { after?: string }>).name?.after === "bulk").length, 2);
    });
  } finally {
    await raw.coach.deleteMany({ where: { sourceCoachId: prefix } });
    await raw.company.deleteMany({ where: { normalizedName: { startsWith: prefix } } });
    await raw.activityChange.deleteMany({ where: { requestId: { in: requestIds } } });
    await raw.$disconnect();
  }
});
