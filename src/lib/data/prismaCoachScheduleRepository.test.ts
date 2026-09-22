/** Adapter contract tests use only a fake Prisma client; no database connection or real lock runs here. */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";

let fakeClient: unknown;
let clientRequests = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { clientRequests++; assert.ok(fakeClient); return fakeClient; } } });
const { PrismaCoachScheduleRepository } = await import("./prismaCoachScheduleRepository");
const { getCoachScheduleRepository } = await import("./coachScheduleRepositoryFactory");
const coachId = "aaaaaaaa-0000-4000-8000-000000000001";
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function transactional(models: Record<string, unknown>) {
  const events: string[] = [];
  const locks: Array<{ sql: string; values: unknown[] }> = [];
  let active = false;
  const tx = {
    ...models,
    async $queryRaw(sql: TemplateStringsArray, ...values: unknown[]) {
      assert.ok(active, "Lock must run inside the same transaction as writes");
      events.push("lock"); locks.push({ sql: sql.join("?"), values }); return [];
    }
  };
  fakeClient = {
    async $transaction(work: (client: typeof tx) => Promise<unknown>) {
      assert.equal(active, false); active = true; events.push("begin");
      try { const result = await work(tx); events.push("commit"); return result; }
      catch (error) { events.push("rollback"); throw error; }
      finally { active = false; }
    }
  };
  return { events, locks, assertActive() { assert.ok(active); } };
}

test("reservation responses retain actual owners and input order; only missing days are created", async () => {
  const inserted: Array<{ coachId: string; date: Date; reservedByName: string; reservedByEmail: string }> = [];
  const state = transactional({
    coach: { async findUnique() { state.assertActive(); return { id: coachId, deletedAt: null }; } },
    coachDayReservation: {
      async findMany(args: { where: { coachId: string; date: { in: Date[] }; cancelledAt: null } }) {
        state.assertActive(); state.events.push("read"); assert.equal(args.where.cancelledAt, null);
        assert.deepEqual(args.where.date.in, [date("2026-10-03"), date("2026-10-01"), date("2026-10-02")]);
        return [
          { date: date("2026-10-01"), reservedByName: "Existing one", reservedByEmail: "one@example.invalid" },
          { date: date("2026-10-03"), reservedByName: "Existing three", reservedByEmail: "three@example.invalid" }
        ];
      },
      async createMany(args: { data: typeof inserted }) { state.assertActive(); state.events.push("create"); inserted.push(...args.data); }
    }
  });
  const result = await new PrismaCoachScheduleRepository().reserveDates(coachId, ["2026-10-03", "2026-10-01", "2026-10-02", "2026-10-03"], { name: "New owner", email: "new@example.invalid" });
  assert.deepEqual(result, [
    { date: "2026-10-03", reservedByName: "Existing three", reservedByEmail: "three@example.invalid" },
    { date: "2026-10-01", reservedByName: "Existing one", reservedByEmail: "one@example.invalid" },
    { date: "2026-10-02", reservedByName: "New owner", reservedByEmail: "new@example.invalid" }
  ]);
  assert.deepEqual(inserted, [{ coachId, date: date("2026-10-02"), reservedByName: "New owner", reservedByEmail: "new@example.invalid" }]);
  assert.deepEqual(state.events, ["begin", "lock", "read", "create", "commit"]);
});

test("advisory locks are parameterized and use the same key for equivalent UUID case", async () => {
  const state = transactional({ coach: { async findUnique() { return null; } } });
  const repository = new PrismaCoachScheduleRepository();
  for (const id of [coachId, coachId.toUpperCase(), "bbbbbbbb-0000-4000-8000-000000000001"]) {
    assert.equal(await repository.reserveDates(id, ["2026-10-01"], { name: "Owner", email: "owner@example.invalid" }), null);
  }
  assert.equal(state.locks.length, 3);
  for (const lock of state.locks) {
    assert.match(lock.sql, /pg_advisory_xact_lock\(\?::bigint\)/);
    assert.equal(lock.values.length, 1);
    assert.equal(typeof lock.values[0], "bigint");
    assert.ok(!lock.sql.includes(coachId));
  }
  assert.deepEqual(state.locks[0].values, state.locks[1].values);
  assert.notDeepEqual(state.locks[0].values, state.locks[2].values);
});

test("cancellation only selects the caller's active bookings and changes no confirmation metadata", async () => {
  let where: unknown;
  let update: { where: { id: { in: string[] } }; data: Record<string, unknown> } | undefined;
  const state = transactional({ coachDayReservation: {
    async findMany(args: { where: unknown }) { state.assertActive(); where = args.where; return [{ id: "owned", date: date("2026-10-02") }]; },
    async updateMany(args: NonNullable<typeof update>) { state.assertActive(); update = args; }
  } });
  const cancelled = await new PrismaCoachScheduleRepository().cancelDates(coachId, ["2026-10-01", "2026-10-02"], "owner@example.invalid");
  assert.deepEqual(where, { coachId, date: { in: [date("2026-10-01"), date("2026-10-02")] }, cancelledAt: null, reservedByEmail: "owner@example.invalid" });
  assert.deepEqual(cancelled, ["2026-10-02"]);
  assert.deepEqual(update?.where, { id: { in: ["owned"] } });
  assert.deepEqual(Object.keys(update!.data), ["cancelledAt"]);
  assert.ok(update!.data.cancelledAt instanceof Date);
  assert.deepEqual(state.events, ["begin", "lock", "commit"]);
});

test("monthly replacement stays within one transaction, preserves access time and propagates log failure", async () => {
  const entries = [{ date: "2024-02-29", startTime: "09:00", endTime: "12:00" }];
  let deletion: unknown;
  let inserted: Array<{ sourceScheduleId: string; coachId: string; date: Date; startTime: string; endTime: string }> = [];
  let failLog = false;
  const logs: Array<{ create: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const state = transactional({
    coachSchedule: {
      async deleteMany(args: unknown) { state.assertActive(); deletion = args; state.events.push("delete"); },
      async createMany(args: { data: typeof inserted }) { state.assertActive(); inserted = args.data; state.events.push("insert"); }
    },
    coachScheduleAccessLog: { async upsert(args: { create: Record<string, unknown>; update: Record<string, unknown> }) {
      state.assertActive(); logs.push(args); state.events.push("log"); if (failLog) throw new Error("synthetic log failure");
    } }
  });
  const repository = new PrismaCoachScheduleRepository();
  await repository.replaceCoachMonth(coachId, "2024-02", entries);
  assert.deepEqual(deletion, { where: { coachId, date: { gte: date("2024-02-01"), lte: date("2024-02-29") } } });
  assert.deepEqual(inserted, [{ sourceScheduleId: `hub:${coachId}:2024-02:0:2024-02-29:09:00:12:00`, coachId, date: date("2024-02-29"), startTime: "09:00", endTime: "12:00" }]);
  assert.deepEqual(Object.keys(logs[0].update), ["lastEditedAt"]);
  assert.ok(logs[0].create.accessedAt instanceof Date);
  assert.equal(logs[0].create.accessedAt, logs[0].create.lastEditedAt);
  assert.deepEqual(state.events, ["begin", "lock", "delete", "insert", "log", "commit"]);
  failLog = true; state.events.length = 0;
  await assert.rejects(repository.replaceCoachMonth(coachId, "2024-02", []), /synthetic log failure/);
  assert.deepEqual(state.events, ["begin", "lock", "delete", "log", "rollback"]);
});

test("coach reads retain date/status DTOs, lastSaved fallback and access-only log updates", async () => {
  const accessed: Array<{ update: Record<string, unknown> }> = [];
  const saved = date("2026-10-02");
  let explicitSaved: Date | null = null;
  fakeClient = {
    coachSchedule: {
      async findMany() { return [{ id: "schedule", date: date("2026-10-01"), startTime: "09:00", endTime: "12:00" }]; },
      async aggregate() { return { _max: { updatedAt: saved } }; }
    },
    coachEngagement: { async findMany() { return [{ id: "engagement", courseName: "Synthetic course", startDate: date("2026-10-01"), endDate: date("2026-10-03"), startTime: null, endTime: null, status: "IN_PROGRESS" }]; } },
    coachEngagementSchedule: { async findMany() { return [{ date: date("2026-10-01"), startTime: "09:00", endTime: "12:00", engagement: { courseName: "Synthetic course", status: "IN_PROGRESS" } }]; } },
    coachScheduleAccessLog: {
      async findUnique() { return { lastEditedAt: explicitSaved }; },
      async upsert(args: { update: Record<string, unknown> }) { accessed.push(args); }
    }
  };
  const repository = new PrismaCoachScheduleRepository();
  const result = await repository.getCoachMonth(coachId, "2026-10");
  assert.deepEqual(result, {
    schedules: [{ id: "schedule", date: "2026-10-01", startTime: "09:00", endTime: "12:00" }],
    engagements: [{ id: "engagement", courseName: "Synthetic course", startDate: "2026-10-01", endDate: "2026-10-03", startTime: null, endTime: null, status: "in_progress" }],
    engagementSchedules: [{ date: "2026-10-01", startTime: "09:00", endTime: "12:00", courseName: "Synthetic course", status: "in_progress" }],
    lastSavedAt: saved.toISOString()
  });
  assert.deepEqual(Object.keys(accessed[0].update), ["accessedAt"]);
  explicitSaved = date("2026-10-04");
  assert.equal((await repository.getCoachMonth(coachId, "2026-10")).lastSavedAt, explicitSaved.toISOString());
});

test("factory defaults to PostgreSQL and missing or failing scoped repositories never fall back", async () => {
  const before = clientRequests;
  assert.ok(getCoachScheduleRepository() instanceof PrismaCoachScheduleRepository);
  assert.throws(() => runWithDataRepositories({}, getCoachScheduleRepository), /DATA_REPOSITORY_NOT_CONFIGURED: coachSchedule/);
  const scoped = new PrismaCoachScheduleRepository();
  scoped.cancelDates = async () => { throw new Error("synthetic scoped failure"); };
  await runWithDataRepositories({ coachSchedule: scoped }, async () => {
    assert.equal(getCoachScheduleRepository(), scoped);
    await assert.rejects(getCoachScheduleRepository().cancelDates(coachId, ["2026-10-01"], "owner@example.invalid"), /synthetic scoped failure/);
  });
  assert.equal(clientRequests, before);
});
