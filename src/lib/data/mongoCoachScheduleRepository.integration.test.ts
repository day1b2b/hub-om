import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MongoCoachScheduleRepository, prepareMongoCoachScheduleStore, COACH_SCHEDULE_MODELS } from "./mongoCoachScheduleRepository";
import { MongoCoachTokenRepository, prepareMongoCoachTokenStore, COACH_TOKEN_MODELS } from "./mongoCoachTokenRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { isEncrypted } from "../privacy/crypto";

// Each concurrent request gets its own synthetic authenticated identity.
type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const managerA: Session = { user: { email: "schedule-a@day1company.co.kr", name: "Synthetic Manager A" }, expires: "" };
const managerB: Session = { user: { email: "schedule-b@day1company.co.kr", name: "Synthetic Manager B" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("Unexpected PostgreSQL access"); } } });
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const selfRoute = await import("../../app/api/coach/schedule/[yearMonth]/route");
const managerRoute = await import("../../app/api/coaches/[id]/schedules/route");
const reservationRoute = await import("../../app/api/coaches/[id]/reservations/route");
hook.deregister();

const uri = process.env.MONGODB_COACH_SCHEDULE_TEST_URI;
const month = "2099-12";
const entry = { date: "2099-12-10", startTime: "09:00", endTime: "12:00" };
function request(path: string, method = "GET", body?: unknown) {
  return new Request(`https://example.invalid${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
}
function monthContext(yearMonth = month) { return { params: Promise.resolve({ yearMonth }) }; }
function coachContext(id: string) { return { params: Promise.resolve({ id }) }; }
function selfRequest(token: string, method = "GET", body?: unknown, yearMonth = month) { return request(`/api/coach/schedule/${yearMonth}?token=${encodeURIComponent(token)}`, method, body); }
function managerRequest(id: string, yearMonth = month) { return request(`/api/coaches/${id}/schedules?yearMonth=${yearMonth}`); }
function reservationRequest(id: string, method: string, dates: unknown) { return request(`/api/coaches/${id}/reservations`, method, { dates }); }

/** Explicit local test URI only: no env-file loading, server discovery from production env, or shared DB cleanup. */
test("actual coach schedule/reservation handlers against an isolated Mongo replica set", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const databaseName = `hub_om_shadow_schedule_test_${randomBytes(12).toString("hex")}`;
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL", "DEV_AUTH_BYPASS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "schedule_fixture";
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ schedule_fixture: randomBytes(32).toString("base64") });
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  let connected = false;
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_schedule_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoCoachTokenStore(options);
    await prepareMongoCoachScheduleStore(options);
    await prepareMongoRequestAuditStore(options);
    const coachSchedule = await MongoCoachScheduleRepository.open(options);
    const coachToken = await MongoCoachTokenRepository.open(options);
    const requestActivity = await MongoRequestAuditRepository.open(options);
    const store = new MongoOperationStore(options, [...new Set([...COACH_SCHEDULE_MODELS, ...COACH_TOKEN_MODELS, ...REQUEST_AUDIT_MODELS])]);
    const coach = coachFixtureRow("Coach", { name: "Synthetic Schedule Coach", normalizedName: "synthetic schedule coach", status: "ACTIVE", isActive: true, accessToken: "synthetic-schedule-token" });
    const other = coachFixtureRow("Coach", { name: "Synthetic Other Coach", normalizedName: "synthetic other coach", status: "ACTIVE", isActive: true, accessToken: "synthetic-other-token" });
    const deleted = coachFixtureRow("Coach", { name: "Synthetic Deleted Coach", normalizedName: "synthetic deleted coach", status: "ACTIVE", isActive: true, accessToken: "synthetic-deleted-token", deletedAt: new Date("2099-01-01T00:00:00.000Z") });
    const seed = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    await store.collection("Coach").insertMany([coach, other, deleted].map(row => encodeMongoRuntimeDocument("Coach", row)));
    return { options, store, seed, coach, other, deleted, id: coach.id as string, scope: { coachSchedule, coachToken, requestActivity } };
  }
  try {
    await client.connect(); connected = true;
    await suite.test("token and workspace authentication, deleted coaches, invalid calendar and malformed entries", async () => {
      const { scope, store, id, deleted } = await fixture();
      await runWithDataRepositories(scope, async () => {
        assert.equal((await selfRoute.GET(selfRequest("invalid"), monthContext())).status, 401);
        assert.equal((await selfRoute.PUT(selfRequest("invalid", "PUT", { schedules: [entry] }), monthContext())).status, 401);
        assert.equal((await selfRoute.GET(selfRequest("synthetic-deleted-token"), monthContext())).status, 401);
        await actors.run(null, async () => {
          await assert.rejects(managerRoute.GET(managerRequest(id), coachContext(id)), /NEXT_REDIRECT/);
          await assert.rejects(reservationRoute.POST(reservationRequest(id, "POST", [entry.date]), coachContext(id)), /NEXT_REDIRECT/);
          await assert.rejects(reservationRoute.DELETE(reservationRequest(id, "DELETE", [entry.date]), coachContext(id)), /NEXT_REDIRECT/);
        });
        await actors.run({ user: { email: "outside@example.invalid", name: "Synthetic external user" }, expires: "" }, async () => {
          await assert.rejects(managerRoute.GET(managerRequest(id), coachContext(id)), /NEXT_REDIRECT/);
          await assert.rejects(reservationRoute.POST(reservationRequest(id, "POST", [entry.date]), coachContext(id)), /NEXT_REDIRECT/);
        });
        assert.equal((await selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", null), monthContext())).status, 400);
        for (const yearMonth of ["2099-13", "2099-00", "2099-2", "not-month"]) {
          assert.equal((await selfRoute.GET(selfRequest("synthetic-schedule-token", "GET", undefined, yearMonth), monthContext(yearMonth))).status, 400);
          assert.equal((await selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules: [] }, yearMonth), monthContext(yearMonth))).status, 400);
          assert.equal((await actors.run(managerA, () => managerRoute.GET(managerRequest(id, yearMonth), coachContext(id)))).status, 400);
        }
        const invalid = [null, [null], [{}], [{ ...entry, date: "2099-12-32" }], [{ ...entry, date: "2100-01-01" }], [{ ...entry, startTime: "24:00" }], [{ ...entry, endTime: "08:00" }]];
        for (const schedules of invalid) assert.equal((await selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules }), monthContext())).status, 400);
        assert.equal((await selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules: [{ ...entry, date: "2099-02-29" }] }, "2099-02"), monthContext("2099-02"))).status, 400);
        await actors.run(managerA, async () => {
          for (const dates of [[], null, [null], ["2099-02-29"], ["2099-04-31"]]) {
            assert.equal((await reservationRoute.POST(reservationRequest(id, "POST", dates), coachContext(id))).status, 400);
            assert.equal((await reservationRoute.DELETE(reservationRequest(id, "DELETE", dates), coachContext(id))).status, 400);
          }
          assert.equal((await reservationRoute.POST(reservationRequest(deleted.id as string, "POST", [entry.date]), coachContext(deleted.id as string))).status, 404);
          // Existing DELETE contract returns the caller's cancelled dates without a coach lookup.
          const deletedCancellation = await reservationRoute.DELETE(reservationRequest(deleted.id as string, "DELETE", [entry.date]), coachContext(deleted.id as string));
          assert.equal(deletedCancellation.status, 200); assert.deepEqual(await deletedCancellation.json(), { ok: true, cancelledDates: [] });
          assert.equal((await managerRoute.GET(managerRequest(deleted.id as string), coachContext(deleted.id as string))).status, 404);
        });
        assert.equal(await store.collection("CoachSchedule").countDocuments(), 0);
        assert.equal(await store.collection("CoachDayReservation").countDocuments(), 0);
        assert.equal(await store.collection("CoachScheduleAccessLog").countDocuments(), 0);
      });
    });

    await suite.test("self and manager DTOs include only eligible confirmed slots and preserve GET/PUT access timestamps", async () => {
      const { scope, store, seed, id, other } = await fixture();
      const previousTime = new Date("2099-01-01T00:00:00.000Z");
      const initial = await seed("CoachSchedule", { coachId: id, date: new Date("2099-12-01"), startTime: "09:00", endTime: "10:00", updatedAt: previousTime });
      await seed("CoachSchedule", { coachId: id, date: new Date("2100-01-01"), startTime: "09:00", endTime: "10:00" });
      const sibling = await seed("CoachSchedule", { coachId: other.id, date: new Date("2099-12-01"), startTime: "09:00", endTime: "10:00" });
      for (const [i, status] of ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].entries()) {
        const engagement = await seed("CoachEngagement", { coachId: id, courseName: `Synthetic course ${i}`, status, source: "MANUAL", startDate: new Date("2099-12-01"), endDate: new Date("2099-12-20"), feedback: "Private feedback must not appear" });
        await seed("CoachEngagementSchedule", { coachId: id, engagementId: engagement.id, date: new Date(`2099-12-${String(i + 1).padStart(2, "0")}`), startTime: "10:00", endTime: "11:00" });
        await seed("CoachEngagementSchedule", { coachId: id, engagementId: engagement.id, date: new Date("2099-12-08"), startTime: "10:00", endTime: "11:00", cancelledAt: previousTime });
      }
      await runWithDataRepositories(scope, async () => {
        const response = await selfRoute.GET(selfRequest("synthetic-schedule-token"), monthContext());
        assert.equal(response.status, 200); assert.ok(response.headers.get("X-Request-Id"));
        const payload = await response.json();
        assert.deepEqual(payload.schedules, [{ id: initial.id, date: "2099-12-01", startTime: "09:00", endTime: "10:00" }]);
        assert.equal(payload.lastSavedAt, previousTime.toISOString());
        assert.equal(payload.engagements.length, 4);
        assert.deepEqual(payload.engagementSchedules.map((row: { status: string }) => row.status), ["scheduled", "in_progress", "completed"]);
        assert.ok(!JSON.stringify(payload).includes("Private feedback")); assert.ok(!JSON.stringify(payload).includes("synthetic-schedule-token"));
        const afterGet = await store.one("CoachScheduleAccessLog", { coachId: id, yearMonth: month }); assert.ok(afterGet); assert.equal(afterGet.lastEditedAt, null);
        const saved = await selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules: [entry, entry] }), monthContext());
        assert.deepEqual(await saved.json(), { ok: true, count: 1 });
        const createdChanges = await store.scan("ActivityChange", { targetType: "coach_schedules", action: "create" });
        assert.equal(createdChanges.length, 1);
        const scheduleChanges = createdChanges[0].changes as Record<string, unknown>;
        assert.deepEqual(scheduleChanges.date, { before: null, after: entry.date });
        assert.deepEqual(scheduleChanges.start_time, { before: null, after: entry.startTime });
        assert.deepEqual(scheduleChanges.end_time, { before: null, after: entry.endTime });
        const deletedChanges = await store.scan("ActivityChange", { targetType: "coach_schedules", action: "delete" });
        assert.equal(deletedChanges.length, 1);
        assert.deepEqual((deletedChanges[0].changes as Record<string, unknown>).date, { before: "2099-12-01", after: null });
        const afterPut = await store.one("CoachScheduleAccessLog", { coachId: id, yearMonth: month }); assert.ok(afterPut);
        assert.deepEqual(afterPut.accessedAt, afterGet.accessedAt); assert.ok(afterPut.lastEditedAt instanceof Date);
        const secondGet = await selfRoute.GET(selfRequest("synthetic-schedule-token"), monthContext());
        assert.equal((await secondGet.json()).lastSavedAt, (afterPut.lastEditedAt as Date).toISOString());
        const afterSecondGet = await store.one("CoachScheduleAccessLog", { coachId: id, yearMonth: month }); assert.ok(afterSecondGet);
        assert.deepEqual(afterSecondGet.lastEditedAt, afterPut.lastEditedAt);
        const managerResponse = await actors.run(managerA, () => managerRoute.GET(managerRequest(id), coachContext(id)));
        assert.equal(managerResponse.status, 200);
        const managerPayload = await managerResponse.json();
        assert.equal(managerPayload.schedules.length, 1); assert.equal(managerPayload.schedules[0].date, entry.date);
        assert.deepEqual(managerPayload.engagementSchedules, payload.engagementSchedules);
        assert.deepEqual(managerPayload.accessLog, { yearMonth: month, accessedAt: (afterSecondGet.accessedAt as Date).toISOString(), lastEditedAt: (afterPut.lastEditedAt as Date).toISOString() });
        assert.deepEqual(await store.one("CoachScheduleAccessLog", { coachId: id, yearMonth: month }), afterSecondGet, "Manager read must not alter coach access timestamps");
        assert.ok(await store.collection("CoachSchedule").findOne({ _id: sibling.id as string }));
        assert.equal(await store.collection("CoachSchedule").countDocuments({ coachId: id, date: new Date("2100-01-01") }), 1);
      });
    });

    await suite.test("concurrent whole-month replacements serialize even with an existing access log and no prior schedules", async () => {
      const { scope, store, seed, id } = await fixture();
      const prior = new Date("2099-01-01T00:00:00.000Z");
      await seed("CoachScheduleAccessLog", { coachId: id, yearMonth: month, accessedAt: prior, lastEditedAt: prior });
      const first = [{ ...entry, date: "2099-12-11" }, { ...entry, date: "2099-12-12" }];
      const second = [{ ...entry, date: "2099-12-21" }, { ...entry, date: "2099-12-22" }];
      await runWithDataRepositories(scope, async () => {
        const frozenClock = mock.method(Date, "now", () => prior.getTime());
        try {
          const responses = await Promise.all([first, second].map(schedules => selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules }), monthContext())));
          for (const response of responses) assert.equal(response.status, 200);
        } finally { frozenClock.mock.restore(); }
        const schedules = await store.scan("CoachSchedule", { coachId: id });
        const dates = schedules.map(row => (row.date as Date).toISOString().slice(0, 10)).sort();
        assert.ok(JSON.stringify(dates) === JSON.stringify(first.map(row => row.date)) || JSON.stringify(dates) === JSON.stringify(second.map(row => row.date)), "A month replacement must be one complete payload, never their union");
        const log = await store.one("CoachScheduleAccessLog", { coachId: id, yearMonth: month }); assert.ok(log);
        assert.deepEqual(log.accessedAt, prior); assert.ok(log.lastEditedAt instanceof Date);
        assert.equal(log.lastEditedAt.getTime(), prior.getTime() + 2, "Every committed replacement must advance the lock even at the same wall-clock millisecond");
      });
    });

    await suite.test("empty versus nonempty concurrent replacement preserves a whole payload and other coach/month rows", async () => {
      const { scope, store, seed, id, other } = await fixture();
      const fixed = new Date("2099-01-01T00:00:00.000Z");
      await seed("CoachScheduleAccessLog", { coachId: id, yearMonth: month, accessedAt: fixed, lastEditedAt: fixed });
      const others = [
        await seed("CoachSchedule", { coachId: other.id, date: new Date(entry.date), startTime: entry.startTime, endTime: entry.endTime }),
        await seed("CoachSchedule", { coachId: id, date: new Date("2100-01-01"), startTime: entry.startTime, endTime: entry.endTime })
      ];
      await runWithDataRepositories(scope, async () => {
        const frozenClock = mock.method(Date, "now", () => fixed.getTime());
        try {
          const responses = await Promise.all([[], [entry]].map(schedules => selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules }), monthContext())));
          for (const response of responses) assert.equal(response.status, 200);
        } finally { frozenClock.mock.restore(); }
        const final = (await store.scan("CoachSchedule", { coachId: id, date: { $gte: new Date("2099-12-01"), $lte: new Date("2099-12-31") } })).map(row => ({ date: (row.date as Date).toISOString().slice(0, 10), startTime: row.startTime, endTime: row.endTime }));
        assert.ok(JSON.stringify(final) === "[]" || JSON.stringify(final) === JSON.stringify([entry]));
        const log = await store.one("CoachScheduleAccessLog", { coachId: id, yearMonth: month }); assert.ok(log);
        assert.equal((log.lastEditedAt as Date).getTime(), fixed.getTime() + 2);
        for (const row of others) assert.deepEqual(await store.one("CoachSchedule", { _id: row.id as string }), row);
      });
    });

    await suite.test("same-date concurrent managers get one committed winner; only its owner can cancel, and history survives re-reservation", async () => {
      const { scope, store, id } = await fixture();
      await runWithDataRepositories(scope, async () => {
        const responses = await Promise.all([managerA, managerB].map(actor => actors.run(actor, () => reservationRoute.POST(reservationRequest(id, "POST", [entry.date]), coachContext(id)))));
        for (const response of responses) assert.equal(response.status, 200);
        const payloads = await Promise.all(responses.map(response => response.json()));
        assert.deepEqual(payloads[0].results, payloads[1].results);
        const winnerEmail = payloads[0].results[0].reservedByEmail as string;
        assert.ok([managerA.user.email, managerB.user.email].includes(winnerEmail));
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id, cancelledAt: null }), 1);
        const winnerStored = await store.one("CoachDayReservation", { coachId: id, date: new Date(entry.date), cancelledAt: null }); assert.ok(winnerStored);
        assert.equal(winnerStored.reservedByEmail, winnerEmail);
        assert.equal(winnerStored.reservedByName, payloads[0].results[0].reservedByName);
        const winner = winnerEmail === managerA.user.email ? managerA : managerB;
        const loser = winner === managerA ? managerB : managerA;
        const denied = await actors.run(loser, () => reservationRoute.DELETE(reservationRequest(id, "DELETE", [entry.date]), coachContext(id)));
        assert.deepEqual(await denied.json(), { ok: true, cancelledDates: [] });
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id, cancelledAt: null }), 1);
        const cancelled = await actors.run(winner, () => reservationRoute.DELETE(reservationRequest(id, "DELETE", [entry.date]), coachContext(id)));
        assert.deepEqual(await cancelled.json(), { ok: true, cancelledDates: [entry.date] });
        const next = await actors.run(loser, () => reservationRoute.POST(reservationRequest(id, "POST", [entry.date]), coachContext(id)));
        assert.equal((await next.json()).results[0].reservedByEmail, loser.user.email);
        const history = await store.scan("CoachDayReservation", { coachId: id });
        assert.equal(history.length, 2); assert.equal(history.filter(row => row.cancelledAt !== null).length, 1);
        const raw = await store.collection("CoachDayReservation").find({ coachId: id }).toArray();
        assert.ok(raw.every(row => isEncrypted(row.reservedByEmail) && isEncrypted(row.reservedByName)));
        for (const actor of [managerA, managerB]) { assert.ok(!JSON.stringify(raw).includes(actor.user.email)); assert.ok(!JSON.stringify(raw).includes(actor.user.name)); }
        const rawChanges = await store.collection("ActivityChange").find({ targetType: "coach_day_reservations" }).toArray();
        assert.ok(rawChanges.every(row => isEncrypted(row.changes?.$json?.__pii)));
        for (const actor of [managerA, managerB]) { assert.ok(!JSON.stringify(rawChanges).includes(actor.user.email)); assert.ok(!JSON.stringify(rawChanges).includes(actor.user.name)); }
        const changes = await store.scan("ActivityChange", { targetType: "coach_day_reservations" });
        assert.ok(changes.length >= 3);
        const createAudit = changes.find(row => row.targetId === winnerStored.id && row.action === "create"); assert.ok(createAudit);
        assert.deepEqual((createAudit.changes as Record<string, unknown>).date, { before: null, after: entry.date });
        const cancelAudit = changes.find(row => row.targetId === winnerStored.id && row.action === "update"); assert.ok(cancelAudit);
        const cancelledRow = history.find(row => row.id === winnerStored.id); assert.ok(cancelledRow?.cancelledAt instanceof Date);
        assert.deepEqual((cancelAudit.changes as Record<string, unknown>).cancelled_at, { before: null, after: cancelledRow.cancelledAt.toISOString() });
        const plaintextChanges = JSON.stringify(changes.map(row => row.changes));
        for (const actor of [managerA, managerB]) { assert.ok(!plaintextChanges.includes(actor.user.email)); assert.ok(!plaintextChanges.includes(actor.user.name)); }
      });
    });

    await suite.test("partly overlapping multi-day reservations keep one winner per shared date and preserve confirmed history", async () => {
      const { scope, store, seed, id } = await fixture();
      const engagement = await seed("CoachEngagement", { coachId: id, courseName: "Synthetic confirmed course", status: "SCHEDULED", source: "MANUAL", startDate: new Date("2099-12-18"), endDate: new Date("2099-12-18") });
      const historical = await seed("CoachDayReservation", { coachId: id, date: new Date("2099-12-18"), reservedByName: managerA.user.name, reservedByEmail: managerA.user.email, cancelledAt: new Date("2099-01-01"), confirmedEngagementId: engagement.id });
      const historicalRaw = await store.collection("CoachDayReservation").findOne({ _id: historical.id as string });
      await runWithDataRepositories(scope, async () => {
        const requested = [["2099-12-18", "2099-12-19"], ["2099-12-19", "2099-12-20"]];
        const responses = await Promise.all([managerA, managerB].map((actor, i) => actors.run(actor, () => reservationRoute.POST(reservationRequest(id, "POST", requested[i]), coachContext(id)))));
        for (const response of responses) assert.equal(response.status, 200);
        const payloads = await Promise.all(responses.map(response => response.json()));
        const shared = payloads.map(payload => payload.results.find((row: { date: string }) => row.date === "2099-12-19"));
        assert.deepEqual(shared[0], shared[1]);
        assert.equal(payloads[0].results[0].reservedByEmail, managerA.user.email);
        assert.equal(payloads[1].results[1].reservedByEmail, managerB.user.email);
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id, cancelledAt: null }), 3);
        await actors.run(managerA, () => reservationRoute.DELETE(reservationRequest(id, "DELETE", ["2099-12-18"]), coachContext(id)));
        assert.deepEqual(await store.collection("CoachDayReservation").findOne({ _id: historical.id as string }), historicalRaw);
        const history = await store.scan("CoachDayReservation", { coachId: id, date: new Date("2099-12-18") });
        assert.equal(history.length, 2); assert.ok(history.every(row => row.cancelledAt instanceof Date));
        assert.equal(history.find(row => row.id === historical.id)?.confirmedEngagementId, engagement.id);
      });
    });

    await suite.test("missing or wrong active reservation indexes block open; duplicate setup fails without deleting existing rows", async () => {
      const { options, store, seed, id } = await fixture();
      const collection = store.collection("CoachDayReservation");
      await collection.dropIndex("runtime_active_reservation");
      await assert.rejects(MongoCoachScheduleRepository.open(options), /ACTIVE_RESERVATION_INDEX_NOT_READY/);
      await collection.createIndex({ coachId: 1, date: 1 }, { name: "runtime_active_reservation", partialFilterExpression: { cancelledAt: null } });
      await assert.rejects(MongoCoachScheduleRepository.open(options), /ACTIVE_RESERVATION_INDEX_NOT_READY/);
      await collection.dropIndex("runtime_active_reservation");
      for (const actor of [managerA, managerB]) await seed("CoachDayReservation", { coachId: id, date: new Date(entry.date), reservedByName: actor.user.name, reservedByEmail: actor.user.email });
      const before = await collection.find({}).sort({ _id: 1 }).toArray();
      await assert.rejects(prepareMongoCoachScheduleStore(options));
      assert.deepEqual(await collection.find({}).sort({ _id: 1 }).toArray(), before);
      assert.equal(before.length, 2);
      await assert.rejects(MongoCoachScheduleRepository.open(options), /ACTIVE_RESERVATION_INDEX_NOT_READY/);
    });

    for (const failure of ["schedule-create-audit", "access-log-write"] as const) {
      await suite.test(`${failure} rejection rolls back preceding schedule deletes, inserts and audits`, async () => {
        const { scope, store, id } = await fixture();
        await runWithDataRepositories(scope, async () => {
          assert.equal((await selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules: [entry] }), monthContext())).status, 200);
          const beforeSchedules = await store.collection("CoachSchedule").find({ coachId: id }).sort({ _id: 1 }).toArray();
          const beforeLog = await store.collection("CoachScheduleAccessLog").findOne({ coachId: id, yearMonth: month });
          const changes = store.collection("ActivityChange"), beforeAudit = await changes.countDocuments();
          // Encrypted audit changes cannot be queried by date. Reject the first new-row audit
          // after old schedules and their delete audits have already been written in the transaction.
          const model = failure === "schedule-create-audit" ? "ActivityChange" : "CoachScheduleAccessLog";
          const rejected = store.collection(model);
          const condition = failure === "schedule-create-audit" ? { $nor: [{ targetType: "coach_schedules", action: "create" }] } : { yearMonth: { $ne: month } };
          await store.db.command({ collMod: rejected.collectionName, validator: { $and: [operationMongoValidator(model), condition] } });
          await assert.rejects(selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules: [{ ...entry, date: "2099-12-20" }, { ...entry, date: "2099-12-21" }] }), monthContext()), /COACH_SCHEDULE_WRITE_FAILED/);
          assert.deepEqual(await store.collection("CoachSchedule").find({ coachId: id }).sort({ _id: 1 }).toArray(), beforeSchedules);
          assert.deepEqual(await store.collection("CoachScheduleAccessLog").findOne({ coachId: id, yearMonth: month }), beforeLog);
          assert.equal(await changes.countDocuments(), beforeAudit);
          assert.equal(await changes.countDocuments({ targetType: "coach_schedule_access_logs" }), 0, "Access logs remain excluded from global change auditing");
          const lastRequest = await store.scan("ActivityRequest", { route: "/api/coach/schedule/[yearMonth]", status: 500 });
          assert.equal(lastRequest.length, 1, "Actual handler failure still records request activity separately");
          await store.db.command({ collMod: rejected.collectionName, validator: operationMongoValidator(model) });
        });
      });
    }

    await suite.test("direct mutations without request activity context fail before changing schedules or reservations", async () => {
      const { scope, store, id } = await fixture();
      await assert.rejects(scope.coachSchedule.replaceCoachMonth(id, month, [entry]), /ACTIVITY_CONTEXT_REQUIRED/);
      await assert.rejects(scope.coachSchedule.reserveDates(id, [entry.date], { name: managerA.user.name, email: managerA.user.email }), /ACTIVITY_CONTEXT_REQUIRED/);
      await assert.rejects(scope.coachSchedule.cancelDates(id, [entry.date], managerA.user.email), /ACTIVITY_CONTEXT_REQUIRED/);
      assert.equal(await store.collection("CoachSchedule").countDocuments(), 0);
      assert.equal(await store.collection("CoachScheduleAccessLog").countDocuments(), 0);
      assert.equal(await store.collection("CoachDayReservation").countDocuments(), 0);
      assert.equal(await store.collection("ActivityChange").countDocuments(), 0);
    });

    await suite.test("multi-day reservations and their audits roll back on audit rejection", async () => {
      const { scope, store, id } = await fixture();
      await runWithDataRepositories(scope, () => actors.run(managerA, async () => {
        const changes = store.collection("ActivityChange");
        const before = await changes.countDocuments();
        await store.db.command({ collMod: changes.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { targetType: { $ne: "coach_day_reservations" } }] } });
        await assert.rejects(reservationRoute.POST(reservationRequest(id, "POST", ["2099-12-21", "2099-12-22"]), coachContext(id)));
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id }), 0);
        assert.equal(await changes.countDocuments(), before);
        await store.db.command({ collMod: changes.collectionName, validator: operationMongoValidator("ActivityChange") });
        const retried = await reservationRoute.POST(reservationRequest(id, "POST", ["2099-12-21", "2099-12-22"]), coachContext(id));
        assert.equal(retried.status, 200); assert.equal((await retried.json()).results.length, 2);
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id, cancelledAt: null }), 2);
      }));
    });

    await suite.test("cancellation audit failure rolls back cancellation dates and preserves prior history", async () => {
      const { scope, store, id } = await fixture();
      await runWithDataRepositories(scope, () => actors.run(managerA, async () => {
        const dates = ["2099-12-23", "2099-12-24"];
        assert.equal((await reservationRoute.POST(reservationRequest(id, "POST", dates), coachContext(id))).status, 200);
        const before = await store.collection("CoachDayReservation").find({ coachId: id }).sort({ _id: 1 }).toArray();
        const changes = store.collection("ActivityChange"), count = await changes.countDocuments();
        const cancellationOrder = await store.collection("CoachDayReservation").find({ coachId: id, date: { $in: dates.map(value => new Date(`${value}T00:00:00.000Z`)) }, cancelledAt: null }, { collation: { locale: "simple" } }).toArray();
        assert.equal(cancellationOrder.length, 2);
        const rejectedId = cancellationOrder[1]._id;
        await store.db.command({ collMod: changes.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { $nor: [{ targetType: "coach_day_reservations", action: "update", targetId: rejectedId }] }] } });
        const auditAttempts: string[] = [];
        const observe = (event: CommandStartedEvent) => {
          if (event.commandName === "insert" && event.command.insert === changes.collectionName) {
            for (const document of event.command.documents ?? []) if (document.targetType === "coach_day_reservations" && document.action === "update") auditAttempts.push(document.targetId);
          }
        };
        client.on("commandStarted", observe);
        try { await assert.rejects(reservationRoute.DELETE(reservationRequest(id, "DELETE", dates), coachContext(id)), /COACH_SCHEDULE_WRITE_FAILED/); }
        finally { client.off("commandStarted", observe); }
        assert.deepEqual(auditAttempts, cancellationOrder.map(row => row._id), "The first cancellation and audit must execute before the second audit is rejected");
        assert.deepEqual(await store.collection("CoachDayReservation").find({ coachId: id }).sort({ _id: 1 }).toArray(), before);
        assert.equal(await changes.countDocuments(), count);
        const requestLogs = await store.scan("ActivityRequest", { route: "/api/coaches/[id]/reservations", method: "DELETE", status: 500 });
        assert.equal(requestLogs.length, 1); assert.equal(requestLogs[0].actorEmail, managerA.user.email);
        await store.db.command({ collMod: changes.collectionName, validator: operationMongoValidator("ActivityChange") });
        const retried = await reservationRoute.DELETE(reservationRequest(id, "DELETE", dates), coachContext(id));
        assert.deepEqual((await retried.json()).cancelledDates.sort(), dates);
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id, cancelledAt: null }), 0);
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id }), 2);
      }));
    });

    await suite.test("missing scoped schedule/token/audit fails before writes; real successful requests use encrypted request activity", async () => {
      const { scope, store, id } = await fixture();
      await assert.rejects(runWithDataRepositories({ coachToken: scope.coachToken, requestActivity: scope.requestActivity }, () => selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules: [entry] }), monthContext())), /DATA_REPOSITORY_NOT_CONFIGURED/);
      await assert.rejects(runWithDataRepositories({ coachSchedule: scope.coachSchedule, requestActivity: scope.requestActivity }, () => selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules: [entry] }), monthContext())), /DATA_REPOSITORY_NOT_CONFIGURED/);
      await assert.rejects(runWithDataRepositories({ coachSchedule: scope.coachSchedule, coachToken: scope.coachToken }, () => selfRoute.PUT(selfRequest("synthetic-schedule-token", "PUT", { schedules: [entry] }), monthContext())), /DATA_REPOSITORY_NOT_CONFIGURED/);
      await actors.run(managerA, async () => {
        await assert.rejects(runWithDataRepositories({ coachSchedule: scope.coachSchedule }, () => reservationRoute.POST(reservationRequest(id, "POST", [entry.date]), coachContext(id))), /DATA_REPOSITORY_NOT_CONFIGURED/);
      });
      assert.equal(await store.collection("CoachSchedule").countDocuments(), 0); assert.equal(await store.collection("CoachDayReservation").countDocuments(), 0);
      await runWithDataRepositories(scope, async () => {
        const self = await selfRoute.GET(selfRequest("synthetic-schedule-token"), monthContext());
        const manager = await actors.run(managerA, () => managerRoute.GET(managerRequest(id), coachContext(id)));
        for (const [response, actorType, actorEmail] of [[self, "token_request", null], [manager, "user", managerA.user.email]] as const) {
          const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
          const raw = await store.collection("ActivityRequest").findOne({ _id: requestId }); assert.ok(raw);
          const decoded = decodeMongoRuntimeDocument("ActivityRequest", raw);
          assert.equal(decoded.status, 200); assert.equal(decoded.actorType, actorType); assert.equal(decoded.actorEmail, actorEmail);
          assert.ok(!JSON.stringify(raw).includes("synthetic-schedule-token")); assert.ok(!JSON.stringify(raw).includes(managerA.user.email));
        }
        const rawCoach = await store.collection("Coach").findOne({ _id: id }); assert.ok(rawCoach);
        assert.ok(isEncrypted(rawCoach.name)); assert.ok(!JSON.stringify(rawCoach).includes("Synthetic Schedule Coach"));
      });
    });
  } finally {
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_schedule_test_[a-f0-9]{24}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
