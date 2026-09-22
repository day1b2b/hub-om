/** Fake-client contract regression only: real PostgreSQL locking/rollback is not exercised. */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { CoachEngagementRow } from "./coachEngagementRepository";

let fakeClient: unknown;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { assert.ok(fakeClient); return fakeClient; } } });
const { PrismaCoachEngagementRepository } = await import("./prismaCoachEngagementRepository");
const { getCoachEngagementRepository } = await import("./coachEngagementRepositoryFactory");
const coachId = "aaaaaaaa-0000-4000-8000-000000000001";
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const author = { name: "Synthetic author", email: "synthetic@example.invalid" };
function fixture(): CoachEngagementRow {
  return { id: "bbbbbbbb-0000-4000-8000-000000000002", coachId, sourceEngagementId: "synthetic", operationSessionId: null,
    courseName: "Synthetic course", status: "SCHEDULED", source: "MANUAL", startDate: day("2026-09-21"), endDate: day("2026-09-23"),
    startTime: null, endTime: null, rating: 4, feedback: "Synthetic review", rehire: true, reviewFlaggedAt: null, hiredById: null, hiredByText: null, createdAt: day("2026-09-01") };
}
function state() {
  let row: CoachEngagementRow | null = fixture();
  const history: Array<Record<string, unknown>> = [], events: string[] = [];
  let queue = Promise.resolve(), failHistory = false;
  let onLock: (() => void) | undefined;
  fakeClient = { async $transaction(work: (tx: unknown) => Promise<unknown>) {
    let release: (() => void) | undefined, locked = false;
    let snapshot: CoachEngagementRow | null = null, historyLength = 0;
    const tx = {
      async $queryRaw(sql: TemplateStringsArray, ...values: unknown[]) {
        assert.match(sql.join("?"), /pg_advisory_xact_lock\(\?::bigint\)/); assert.equal(typeof values[0], "bigint");
        const previous = queue; queue = new Promise<void>(resolve => { release = resolve; }); await previous;
        onLock?.(); onLock = undefined; snapshot = structuredClone(row); historyLength = history.length; locked = true; events.push("lock");
      },
      coach: { async findFirst() { assert.ok(locked); return { id: coachId }; } },
      coachEngagement: {
        async findUnique(args: { select?: unknown }) { if (args.select) return row ? { coachId: row.coachId } : null; assert.ok(locked); events.push("reread"); return structuredClone(row); },
        async create(args: { data: Partial<CoachEngagementRow> }) { assert.ok(locked); row = { ...fixture(), ...args.data }; events.push("create"); return structuredClone(row); },
        async update(args: { data: Partial<CoachEngagementRow>; select?: Record<string, boolean> }) {
          assert.ok(locked && row); row = { ...row, ...args.data }; events.push("update");
          return args.select ? Object.fromEntries(Object.keys(args.select).map(key => [key, row![key as keyof CoachEngagementRow]])) : structuredClone(row);
        }
      },
      coachEngagementSchedule: {
        async deleteMany() { assert.ok(locked); events.push("delete-schedules"); },
        async createMany(args: { data: Array<{ date: Date; startTime: string; endTime: string }> }) {
          assert.ok(locked); events.push("create-schedules"); assert.equal(args.data.length, 3); assert.equal(args.data[0].startTime, "09:00"); assert.equal(args.data[0].endTime, "18:00");
        }
      },
      coachDayReservation: { async updateMany(args: { data: { confirmedEngagementId: string; cancelledAt: Date } }) { assert.ok(locked); events.push("auto-cancel"); assert.equal(args.data.confirmedEngagementId, row?.id); assert.ok(args.data.cancelledAt instanceof Date); } },
      coachContentEntry: { async create(args: { data: Record<string, unknown> }) { assert.ok(locked); events.push("history"); if (failHistory) throw new Error("synthetic history failure"); history.push(args.data); } }
    };
    try { const result = await work(tx); events.push("commit"); return result; }
    catch (error) { if (locked) { row = snapshot; history.splice(historyLength); } events.push("rollback"); throw error; }
    finally { release?.(); }
  } };
  return { events, history, get row() { return row; }, setRow(value: CoachEngagementRow | null) { row = value; }, beforeLock(work: () => void) { onLock = work; }, failHistory() { failHistory = true; } };
}

test("cancelled creation still regenerates weekdays and cancels reservations; status-only update does neither", async () => {
  const fixtureState = state(), repository = new PrismaCoachEngagementRepository();
  const base = fixture();
  const created = await repository.createForCoach(coachId, { courseName: base.courseName, status: "CANCELLED", startDate: base.startDate, endDate: base.endDate, startTime: null, endTime: null, rating: null, feedback: null, rehire: null, hiredByText: null });
  assert.equal(created?.status, "CANCELLED"); assert.equal(created.startDate, "2026-09-21T00:00:00.000Z");
  assert.deepEqual(fixtureState.events, ["lock", "create", "delete-schedules", "create-schedules", "auto-cancel", "commit"]);
  fixtureState.events.length = 0;
  await repository.update(created.id, { status: "SCHEDULED" });
  assert.deepEqual(fixtureState.events, ["lock", "reread", "update", "commit"]);
});

test("invalid PUT date fallback uses the row re-read after lock acquisition", async () => {
  const fixtureState = state(), repository = new PrismaCoachEngagementRepository();
  fixtureState.beforeLock(() => fixtureState.setRow({ ...fixture(), courseName: "Concurrent name" }));
  const updated = await repository.update(fixture().id, { courseName: null, startDate: null });
  assert.equal(updated?.courseName, "Concurrent name"); assert.equal(updated.startDate, "2026-09-21T00:00:00.000Z");
  assert.deepEqual(fixtureState.events, ["lock", "reread", "update", "delete-schedules", "create-schedules", "auto-cancel", "commit"]);
});

test("concurrent review toggles read inside the lock and write their histories in the same transaction", async () => {
  const fixtureState = state(), repository = new PrismaCoachEngagementRepository();
  await Promise.all([repository.updateReview(fixture().id, { action: "toggleFlag" }, author), repository.updateReview(fixture().id, { action: "toggleFlag" }, author)]);
  assert.equal(fixtureState.row?.reviewFlaggedAt, null);
  assert.deepEqual(fixtureState.history.map(row => row.content), ["리뷰 경고 설정", "리뷰 경고 해제"]);
  assert.ok(fixtureState.history.every(row => row.sourceField === `coach_engagements.review:${fixture().id}` && row.authorEmail === author.email));
  assert.deepEqual(fixtureState.events, ["lock", "reread", "update", "history", "commit", "lock", "reread", "update", "history", "commit"]);
});

test("review history failure aborts the transaction and rehire-only updates retain the narrow response", async () => {
  const fixtureState = state(), repository = new PrismaCoachEngagementRepository();
  const edited = await repository.updateReview(fixture().id, { action: "edit", rehire: false }, author);
  assert.deepEqual(edited, { id: fixture().id, coachId, rating: 4, feedback: "Synthetic review", rehire: false });
  assert.equal(fixtureState.history.length, 0);
  const before = structuredClone(fixtureState.row); fixtureState.failHistory(); fixtureState.events.length = 0;
  await assert.rejects(repository.updateReview(fixture().id, { action: "edit", rating: 2, feedback: "Changed" }, author), /synthetic history failure/);
  assert.deepEqual(fixtureState.row, before);
  assert.deepEqual(fixtureState.events, ["lock", "reread", "update", "history", "rollback"]);
});

test("review deletion keeps flag and rehire while missing reviews still throw", async () => {
  const fixtureState = state(), repository = new PrismaCoachEngagementRepository();
  fixtureState.setRow({ ...fixture(), reviewFlaggedAt: day("2026-09-20") });
  const deleted = await repository.updateReview(fixture().id, { action: "deleteReview" }, author);
  assert.equal(deleted.rating, null); assert.equal(deleted.feedback, null); assert.equal(deleted.rehire, true);
  assert.ok("reviewFlaggedAt" in deleted); assert.equal(deleted.reviewFlaggedAt, "2026-09-20T00:00:00.000Z");
  assert.equal(fixtureState.history[0].content, "리뷰 삭제");
  fixtureState.setRow(null);
  await assert.rejects(repository.updateReview(fixture().id, { action: "toggleFlag" }, author), /COACH_ENGAGEMENT_NOT_FOUND/);
  assert.equal(await repository.update(fixture().id, {}), null);
});

test("engagement factory keeps PostgreSQL default and fails closed for missing scoped services", () => {
  assert.ok(getCoachEngagementRepository() instanceof PrismaCoachEngagementRepository);
  assert.throws(() => runWithDataRepositories({}, getCoachEngagementRepository), /DATA_REPOSITORY_NOT_CONFIGURED: coachEngagement/);
});
