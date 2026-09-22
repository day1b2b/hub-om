/** PostgreSQL adapter wiring is mocked; this does not establish real server lock/rollback behavior. */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
let client: unknown;
let active = false;
const events: string[] = [];
mock.module("./prisma", { namedExports: { getPrismaClient: () => client } });
mock.module("../coaches/contentEntries", { namedExports: { async logProfileEdit() { assert.equal(active, false); events.push("profile-log"); } } });
const { PrismaCoachSheetSyncRepository } = await import("./prismaCoachSheetSyncRepository");
const { PrismaCoachManagementRepository } = await import("./prismaCoachManagementRepository");
const id = "aaaaaaaa-0000-4000-8000-000000000001";
function fake(models: Record<string, unknown>) {
  events.length = 0; const locks: bigint[] = [];
  client = { async $transaction(work: (tx: unknown) => Promise<unknown>) {
    active = true; events.push("begin");
    const tx = { ...models, async $queryRaw(sql: TemplateStringsArray, key: bigint) { assert.ok(active); assert.match(sql.join("?"), /pg_advisory_xact_lock\(\?::bigint\)/); locks.push(key); events.push("lock"); } };
    try { const value = await work(tx); events.push("commit"); return value; }
    catch (error) { events.push("rollback"); throw error; }
    finally { active = false; }
  } };
  return locks;
}

test("sheet transactions lock the catalog before sorted unique coach locks and preserve missing-only private patches", async () => {
  let privateWrite: unknown, scheduleDeletes: unknown, scheduleCreates: unknown;
  const locks = fake({
    coach: { async findMany() { assert.equal(events.at(-1), "lock"); return []; } },
    coachPrivateProfile: { async upsert(args: unknown) { assert.ok(active); privateWrite = args; } },
    coachEngagementSchedule: { async deleteMany(args: unknown) { scheduleDeletes = args; }, async createMany(args: unknown) { scheduleCreates = args; } }
  });
  const repository = new PrismaCoachSheetSyncRepository();
  await repository.transaction(async tx => {
    assert.deepEqual(await tx.listLiveCoaches(), []);
    await tx.lockCoaches([id.toUpperCase(), "bbbbbbbb-0000-4000-8000-000000000002", id]);
    await tx.upsertPrivateProfile(id, { employeeId: "source", email: "source@example.invalid", phone: null }, { phone: "010-1234-5678" });
    await tx.replaceSchedules("synthetic-engagement", []);
  });
  assert.equal(locks.length, 3); assert.notEqual(locks[0], locks[1]);
  assert.deepEqual(privateWrite, { where: { coachId: id }, create: { coachId: id, employeeId: "source", email: "source@example.invalid", phone: null, birthDate: null, affiliation: null }, update: { phone: "010-1234-5678" } });
  assert.deepEqual(scheduleDeletes, { where: { engagementId: "synthetic-engagement" } }); assert.equal(scheduleCreates, undefined);
  assert.deepEqual(events, ["begin", "lock", "lock", "lock", "commit"]);
  await assert.rejects(repository.transaction(async () => { throw new Error("Synthetic workflow failure"); }), /Synthetic workflow failure/);
  assert.equal(events.at(-1), "rollback");
});

test("management create preallocates an ID before catalog/coach locks and writes the profile in the same transaction", async () => {
  let createdId = "";
  const locks = fake({
    coach: { async create(args: { data: { id: string; name: string } }) { assert.ok(active); assert.equal(events.filter(event => event === "lock").length, 2); createdId = args.data.id; return { id: createdId, name: args.data.name }; } },
    coachPrivateProfile: { async create(args: { data: { coachId: string } }) { assert.ok(active); assert.equal(args.data.coachId, createdId); } },
    coachField: { async deleteMany() { assert.ok(active); } }
  });
  const created = await new PrismaCoachManagementRepository().createCoach({ name: "Synthetic coach" });
  assert.match(createdId, /^[a-f0-9-]{36}$/); assert.equal(created.id, createdId); assert.equal(locks.length, 2); assert.deepEqual(events, ["begin", "lock", "lock", "commit"]);
});

test("management update/status/delete inspect existence after both locks and retain post-commit profile logging", async () => {
  let deleted = false; const writes: unknown[] = [];
  fake({ coach: {
    async findUnique() { assert.ok(active); assert.equal(events.slice(-2).join(","), "lock,lock"); return { id, deletedAt: deleted ? new Date() : null }; },
    async update(args: { data: Record<string, unknown> }) { assert.ok(active); writes.push(args.data); return { id, name: "Updated synthetic", status: "INACTIVE", isActive: true }; }
  } });
  const repository = new PrismaCoachManagementRepository();
  await repository.updateCoach(id, { name: "Updated synthetic" }, { name: "Actor", email: "actor@example.invalid" });
  assert.deepEqual(events, ["begin", "lock", "lock", "commit", "profile-log"]);
  events.length = 0;
  assert.deepEqual(await repository.updateCoachStatus(id, "inactive"), { id, status: "inactive", isActive: true });
  assert.deepEqual(events, ["begin", "lock", "lock", "commit"]);
  events.length = 0; await repository.deleteCoach(id, "actor@example.invalid");
  assert.deepEqual(events, ["begin", "lock", "lock", "commit"]);
  assert.equal(writes.length, 3); deleted = true; events.length = 0;
  await assert.rejects(repository.updateCoach(id, { name: "Rejected" }, { name: "Actor", email: "actor@example.invalid" }));
  assert.equal(writes.length, 3); assert.equal(events.at(-1), "rollback");
});


test("replacement discovers reservation owners without filtering to the engagement coach or active reservations", async () => {
  let query: unknown;
  fake({ coachDayReservation: { async findMany(args: unknown) { query = args; return [{ coachId: id }]; } } });
  await new PrismaCoachSheetSyncRepository().transaction(async tx => {
    assert.deepEqual(await tx.listReservationCoachIdsForEngagements([]), []);
    assert.equal(query, undefined);
    assert.deepEqual(await tx.listReservationCoachIdsForEngagements(["synthetic-engagement"]), [id]);
  });
  assert.deepEqual(query, { where: { confirmedEngagementId: { in: ["synthetic-engagement"] } }, select: { coachId: true }, distinct: ["coachId"] });
});


test("coach name lookup queries live exact-name matches and retains the last returned match", async () => {
  const first = { id, name: "Synthetic duplicate", workType: null, privateProfile: null };
  const last = { ...first, id: "bbbbbbbb-0000-4000-8000-000000000002" };
  let rows = [first, last];
  fake({ coach: { async findMany(args: { where: unknown; orderBy?: unknown }) {
    assert.deepEqual(args.where, { name: first.name, deletedAt: null });
    assert.equal(args.orderBy, undefined);
    return rows;
  } } });
  await new PrismaCoachSheetSyncRepository().transaction(async tx => {
    assert.deepEqual(await tx.findLiveCoachByName(first.name), last);
    rows = [];
    assert.equal(await tx.findLiveCoachByName(first.name), null);
  });
});
