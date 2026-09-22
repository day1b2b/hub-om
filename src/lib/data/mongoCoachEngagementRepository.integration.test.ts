import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { Collection, MongoClient, MongoServerError, type CommandStartedEvent } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MongoCoachEngagementRepository, prepareMongoCoachEngagementStore, COACH_ENGAGEMENT_MODELS } from "./mongoCoachEngagementRepository";
import { MongoCoachScheduleRepository, prepareMongoCoachScheduleStore, COACH_SCHEDULE_MODELS } from "./mongoCoachScheduleRepository";
import { MongoCoachTokenRepository, prepareMongoCoachTokenStore, COACH_TOKEN_MODELS } from "./mongoCoachTokenRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { isEncrypted } from "../privacy/crypto";
import { activityContext } from "../activity/context";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const managerA: Session = { user: { email: "engagement-a@day1company.co.kr", name: "Synthetic Engagement Manager A" }, expires: "" };
const managerB: Session = { user: { email: "engagement-b@day1company.co.kr", name: "Synthetic Engagement Manager B" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("Unexpected PostgreSQL access"); } } });
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const collectionRoute = await import("../../app/api/coaches/[id]/engagements/route");
const itemRoute = await import("../../app/api/engagements/[id]/route");
const reviewRoute = await import("../../app/api/engagements/[id]/review/route");
const reservationRoute = await import("../../app/api/coaches/[id]/reservations/route");
hook.deregister();

const uri = process.env.MONGODB_COACH_ENGAGEMENT_TEST_URI;
const firstDay = "2099-12-10"; // Thursday, followed by Friday and a weekend.
const lastDay = "2099-12-14";
const basic = { courseName: "Synthetic native engagement", startDate: firstDay, endDate: lastDay, rating: null };
const privateFeedback = "Synthetic private feedback 4c861d";
const hiredBy = "Synthetic private hiring manager 98e6a1";
function request(path: string, method: string, body?: unknown) {
  return new Request(`https://example.invalid${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const list = (id: string) => collectionRoute.GET(request(`/api/coaches/${id}/engagements`, "GET"), context(id));
const create = (id: string, body: unknown = basic) => collectionRoute.POST(request(`/api/coaches/${id}/engagements`, "POST", body), context(id));
const update = (id: string, body: unknown) => itemRoute.PUT(request(`/api/engagements/${id}`, "PUT", body), context(id));
const review = (id: string, body: unknown) => reviewRoute.PATCH(request(`/api/engagements/${id}/review`, "PATCH", body), context(id));
const reserve = (id: string, dates: string[]) => reservationRoute.POST(request(`/api/coaches/${id}/reservations`, "POST", { dates }), context(id));
const cancel = (id: string, dates: string[]) => reservationRoute.DELETE(request(`/api/coaches/${id}/reservations`, "DELETE", { dates }), context(id));
const utcDay = (value: unknown) => (value as Date).toISOString().slice(0, 10);

/** Only an explicit loopback URI, synthetic keys and a generated disposable database are permitted. */
test("actual engagement and review handlers against an isolated Mongo replica set", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const databaseName = `hub_om_shadow_engagement_test_${randomBytes(12).toString("hex")}`;
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL", "DEV_AUTH_BYPASS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ACTIVE_KEY_ID = "engagement_fixture";
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ engagement_fixture: randomBytes(32).toString("base64") });
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  let connected = false;
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_engagement_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoCoachTokenStore(options); await prepareMongoCoachScheduleStore(options);
    await prepareMongoCoachEngagementStore(options); await prepareMongoRequestAuditStore(options);
    const coachEngagement = await MongoCoachEngagementRepository.open(options);
    const coachSchedule = await MongoCoachScheduleRepository.open(options);
    const coachToken = await MongoCoachTokenRepository.open(options);
    const requestActivity = await MongoRequestAuditRepository.open(options);
    const store = new MongoOperationStore(options, [...new Set([...COACH_ENGAGEMENT_MODELS, ...COACH_SCHEDULE_MODELS, ...COACH_TOKEN_MODELS, ...REQUEST_AUDIT_MODELS])]);
    const seed = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    const coach = await seed("Coach", { name: "Synthetic Engagement Coach", normalizedName: "synthetic engagement coach", status: "ACTIVE", isActive: true });
    const other = await seed("Coach", { name: "Synthetic Other Coach", normalizedName: "synthetic other coach", status: "ACTIVE", isActive: true });
    const deleted = await seed("Coach", { name: "Synthetic Deleted Coach", normalizedName: "synthetic deleted coach", status: "ACTIVE", isActive: true, deletedAt: new Date("2099-01-01") });
    return { options, store, seed, id: coach.id as string, otherId: other.id as string, deletedId: deleted.id as string, scope: { coachEngagement, coachSchedule, coachToken, requestActivity } };
  }
  const snapshot = async (store: MongoOperationStore) => Promise.all(["CoachEngagement", "CoachEngagementSchedule", "CoachDayReservation", "CoachContentEntry", "ActivityChange"].map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray()));
  // Instrument only this test's collections; every call still reaches the real driver.
  async function forceGuardOrder(f: Awaited<ReturnType<typeof fixture>>, firstCall: () => Promise<Response>, secondCall: () => Promise<Response>) {
    const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
    const held = deferred(), collided = deferred(), release = deferred();
    async function bounded(promise: Promise<unknown>, label: string) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 8000); })]); }
      finally { clearTimeout(timer); }
    }
    const guardName = `${f.options.namespace}_CoachSchedulingGuard`, engagementName = f.store.collection("CoachEngagement").collectionName;
    const originalUpdate = Collection.prototype.updateOne, originalFind = Collection.prototype.findOne;
    let firstHeld = false, collisions = 0, secondAttempts = 0, firstUpserted = 0;
    const secondReads: Array<Record<string, unknown>> = [];
    const updatePatch = mock.method(Collection.prototype, "updateOne", async function(this: Collection, ...args: Parameters<Collection["updateOne"]>) {
      const relevant = this.collectionName === guardName && String(args[0]._id) === f.id;
      const actor = activityContext.getStore()?.actorEmail;
      if (relevant && actor === managerB.user.email) secondAttempts++;
      try {
        const result = await originalUpdate.apply(this, args);
        if (relevant && actor === managerA.user.email && !firstHeld) {
          firstHeld = true; firstUpserted = result.upsertedCount; held.resolve(); await release.promise;
        }
        return result;
      } catch (error) {
        if (relevant && actor === managerB.user.email && error instanceof MongoServerError && (error.code === 112 || error.code === 11000)) { collisions++; collided.resolve(); }
        throw error; // Real driver transaction retry must reread and reacquire the guard.
      }
    });
    const findPatch = mock.method(Collection.prototype, "findOne", async function(this: Collection, ...args: Parameters<Collection["findOne"]>) {
      const row = await originalFind.apply(this, args);
      if (this.collectionName === engagementName && activityContext.getStore()?.actorEmail === managerB.user.email && row) secondReads.push({ ...row });
      return row;
    });
    const requests: Array<Promise<Response>> = [];
    try {
      const first = runWithDataRepositories(f.scope, () => actors.run(managerA, firstCall)); requests.push(first); void first.catch(() => {});
      await bounded(Promise.race([held.promise, first.then(() => { throw new Error("First writer did not acquire guard"); })]), "First writer guard deadline");
      const second = runWithDataRepositories(f.scope, () => actors.run(managerB, secondCall)); requests.push(second); void second.catch(() => {});
      await bounded(Promise.race([collided.promise, second.then(() => { throw new Error("Second writer did not collide"); })]), "Second writer collision deadline");
      release.resolve();
      const responses = await Promise.all(requests);
      assert.ok(collisions >= 1, "Second writer must receive a real Mongo WriteConflict or duplicate upsert error");
      assert.ok(secondAttempts >= 2, "Driver must retry the conflicting transaction");
      return { responses, secondReads, firstUpserted };
    } finally {
      release.resolve(); held.resolve(); collided.resolve();
      await Promise.allSettled(requests);
      findPatch.mock.restore(); updatePatch.mock.restore();
    }
  }
  try {
    await client.connect(); connected = true;
    await suite.test("real authentication, missing targets and preserved POST validation", async () => {
      const { scope, store, id, deletedId } = await fixture();
      await runWithDataRepositories(scope, async () => {
        for (const actor of [null, { user: { email: "outside@example.invalid", name: "Outside" }, expires: "" }]) await actors.run(actor, async () => {
          for (const call of [() => list(id), () => create(id), () => update(randomUUID(), {}), () => review(randomUUID(), {})]) await assert.rejects(call(), /NEXT_REDIRECT/);
        });
        await actors.run(managerA, async () => {
          for (const target of [deletedId, randomUUID()]) { assert.equal((await list(target)).status, 404); assert.equal((await create(target)).status, 404); }
          assert.equal((await update(randomUUID(), {})).status, 404);
          await assert.rejects(review(randomUUID(), { toggleFlag: true }));
          for (const body of [null, {}, { ...basic, courseName: " " }, { ...basic, startDate: "invalid" }, { ...basic, rating: 0 }, { ...basic, rating: 2.5 }, { ...basic, rating: 6 }, { courseName: basic.courseName, startDate: firstDay, endDate: lastDay }]) assert.equal((await create(id, body)).status, 400);
          assert.equal((await create(id, { ...basic, status: "unknown" })).status, 201);
          const [row] = await store.scan("CoachEngagement", { coachId: id }); assert.equal(row.status, "SCHEDULED");
        });
      });
    });

    await suite.test("weekday creation cancels only matching active reservations and preserves response, audit and encryption", async () => {
      const { scope, store, seed, id, otherId } = await fixture();
      const history = await seed("CoachDayReservation", { coachId: id, date: new Date(firstDay), reservedByEmail: managerB.user.email, reservedByName: managerB.user.name, cancelledAt: new Date("2099-01-01") });
      await runWithDataRepositories(scope, () => actors.run(managerA, async () => {
        await reserve(id, [firstDay, "2099-12-11", "2099-12-12", "2099-12-15"]); await reserve(otherId, [firstDay]);
        const response = await create(id, { ...basic, feedback: privateFeedback, hiredBy, rehire: true }); assert.equal(response.status, 201);
        const { engagement } = await response.json();
        assert.equal(engagement.status, "SCHEDULED"); assert.equal(engagement.source, "MANUAL"); assert.equal(engagement.startDate, `${firstDay}T00:00:00.000Z`);
        assert.equal(engagement.feedback, privateFeedback); assert.equal(engagement.hiredByText, hiredBy);
        assert.ok(!Object.keys(engagement).some(key => key.endsWith("PiiIndex")));
        const slots = (await store.scan("CoachEngagementSchedule", { engagementId: engagement.id })).sort((a,b) => utcDay(a.date).localeCompare(utcDay(b.date)));
        assert.deepEqual(slots.map(row => [utcDay(row.date), row.startTime, row.endTime]), [[firstDay,"09:00","18:00"],["2099-12-11","09:00","18:00"],[lastDay,"09:00","18:00"]]);
        const reservations = await store.scan("CoachDayReservation", { coachId: id });
        for (const row of reservations.filter(row => row.id !== history.id)) {
          if ([firstDay,"2099-12-11"].includes(utcDay(row.date))) { assert.ok(row.cancelledAt instanceof Date); assert.equal(row.confirmedEngagementId, engagement.id); }
          else { assert.equal(row.cancelledAt, null); assert.equal(row.confirmedEngagementId, null); }
        }
        assert.equal((await store.one("CoachDayReservation", { _id: history.id as string }))?.confirmedEngagementId, null);
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: otherId, cancelledAt: null }), 1);
        const listed = await (await list(id)).json(); assert.equal(listed.engagements[0].status, "scheduled"); assert.equal(listed.engagements[0].source, "manual"); assert.equal(listed.engagements[0].startDate, firstDay);
        const raw = await store.collection("CoachEngagement").findOne({ _id: engagement.id }); assert.ok(raw); assert.ok(isEncrypted(raw.feedback)); assert.ok(isEncrypted(raw.hiredByText));
        const changes = await store.scan("ActivityChange", { requestId: response.headers.get("X-Request-Id") });
        assert.ok(changes.some(row => row.targetType === "coach_engagements")); assert.equal(changes.filter(row => row.targetType === "coach_engagement_schedules").length, 3); assert.equal(changes.filter(row => row.targetType === "coach_day_reservations").length, 2);
        const engagementChange = changes.find(row => row.targetType === "coach_engagements")!.changes as Record<string, unknown>;
        assert.deepEqual(engagementChange.status, { before: null, after: "scheduled" });
        assert.deepEqual(engagementChange.start_date, { before: null, after: firstDay });
        assert.deepEqual(engagementChange.feedback, { redacted: true }); assert.deepEqual(engagementChange.hired_by_text, { redacted: true });
        for (const change of changes.filter(row => row.targetType === "coach_engagement_schedules")) {
          const diff = change.changes as Record<string, { before: unknown; after: unknown }>;
          assert.deepEqual(diff.start_time, { before: null, after: "09:00" }); assert.deepEqual(diff.end_time, { before: null, after: "18:00" });
          assert.ok([firstDay,"2099-12-11",lastDay].includes(diff.date.after as string));
        }
        for (const change of changes.filter(row => row.targetType === "coach_day_reservations")) {
          const diff = change.changes as Record<string, { before: unknown; after: unknown }>;
          assert.deepEqual(diff.confirmed_engagement_id, { before: null, after: engagement.id });
          assert.equal(diff.cancelled_at.before, null); assert.match(diff.cancelled_at.after as string, /^\d{4}-\d{2}-\d{2}T/);
        }
        for (const model of ["CoachEngagement", "CoachDayReservation", "ActivityChange", "ActivityRequest"]) {
          const serialized = JSON.stringify(await store.collection(model).find({}).toArray());
          for (const secret of [privateFeedback, hiredBy, managerA.user.email, managerA.user.name]) assert.ok(!serialized.includes(secret), `${model} leaks fixture PII`);
        }
        const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
        const requestRow = await store.one("ActivityRequest", { _id: requestId }); assert.equal(requestRow?.status, 201); assert.equal(requestRow?.actorEmail, managerA.user.email);
      }));
    });

    await suite.test("status-only PUT preserves slots; cancelled creation and date PUT still regenerate and cancel reservations", async () => {
      const { scope, store, id } = await fixture();
      await runWithDataRepositories(scope, () => actors.run(managerA, async () => {
        const first = await (await create(id)).json(), engagementId = first.engagement.id;
        const before = await store.collection("CoachEngagementSchedule").find({ engagementId }).sort({ _id: 1 }).toArray();
        await reserve(id, [firstDay]); assert.equal((await update(engagementId, { status: "cancelled" })).status, 200);
        assert.deepEqual(await store.collection("CoachEngagementSchedule").find({ engagementId }).sort({ _id: 1 }).toArray(), before);
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id, cancelledAt: null }), 1);
        assert.equal((await update(engagementId, { startDate: firstDay, endDate: firstDay, startTime: "11:00", endTime: "13:00" })).status, 200);
        const after = await store.scan("CoachEngagementSchedule", { engagementId }); assert.equal(after.length, 1); assert.equal(after[0].startTime, "11:00"); assert.equal(after[0].endTime, "13:00"); assert.ok(!before.some(row => row._id === after[0].id));
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id, cancelledAt: null }), 0);
        await reserve(id, ["2099-12-11"]);
        const cancelled = await (await create(id, { ...basic, status: "cancelled" })).json(); assert.equal(cancelled.engagement.status, "CANCELLED");
        assert.equal(await store.collection("CoachEngagementSchedule").countDocuments({ engagementId: cancelled.engagement.id }), 3);
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id, cancelledAt: null }), 0);
      }));
    });

    await suite.test("366 calendar-day generation cap is preserved", async () => {
      const { scope, store, id } = await fixture();
      await runWithDataRepositories(scope, () => actors.run(managerA, async () => {
        const response = await create(id, { ...basic, startDate: "2099-01-01", endDate: "2101-01-01" }); assert.equal(response.status, 201);
        const { engagement } = await response.json(), rows = await store.scan("CoachEngagementSchedule", { engagementId: engagement.id });
        const expected: string[] = [];
        for (let offset = 0; offset < 366; offset++) { const date = new Date(Date.UTC(2099,0,1 + offset)); if (date.getUTCDay() >= 1 && date.getUTCDay() <= 5) expected.push(utcDay(date)); }
        assert.deepEqual(rows.map(row => utcDay(row.date)).sort(), expected);
      }));
    });

    await suite.test("review edit, flag, delete and rehire-only preserve history contract and encrypted values", async () => {
      const { scope, store, id } = await fixture();
      await runWithDataRepositories(scope, () => actors.run(managerA, async () => {
        const { engagement } = await (await create(id)).json();
        const edited = await review(engagement.id, { rating: 5, feedback: privateFeedback, rehire: true }); assert.equal(edited.status, 200);
        assert.deepEqual((await edited.json()).engagement, { id: engagement.id, coachId: id, rating: 5, feedback: privateFeedback, rehire: true });
        const flagged = await (await review(engagement.id, { toggleFlag: true })).json(); assert.ok(flagged.engagement.reviewFlaggedAt);
        assert.equal((await (await review(engagement.id, { toggleFlag: true })).json()).engagement.reviewFlaggedAt, null);
        const deleted = await (await review(engagement.id, { deleteReview: true })).json(); assert.equal(deleted.engagement.feedback, null); assert.equal(deleted.engagement.rating, null); assert.equal(deleted.engagement.rehire, true);
        await review(engagement.id, { rehire: false }); await review(engagement.id, {});
        const logs = await store.scan("CoachContentEntry", { coachId: id });
        assert.deepEqual(logs.map(row => row.content).sort(), ["리뷰 수정","리뷰 경고 설정","리뷰 경고 해제","리뷰 삭제"].sort());
        assert.ok(logs.every(row => row.kind === "EDIT_HISTORY" && row.sourceField === `coach_engagements.review:${engagement.id}` && row.authorEmail === managerA.user.email));
        assert.equal(await store.collection("ActivityChange").countDocuments({ targetType: "coach_content_entries" }), 0);
        const rawLogs = await store.collection("CoachContentEntry").find({}).toArray(); assert.ok(rawLogs.every(row => isEncrypted(row.content) && isEncrypted(row.authorEmail) && isEncrypted(row.authorName)));
        assert.ok(!JSON.stringify(rawLogs).includes(managerA.user.email));
        const before = await snapshot(store); assert.equal((await review(engagement.id, { rating: 6 })).status, 400); assert.deepEqual(await snapshot(store), before);
      }));
    });

    await suite.test("review history tail failure rolls back edited engagement and preceding change audit", async () => {
      const { scope, store, id } = await fixture();
      await runWithDataRepositories(scope, () => actors.run(managerA, async () => {
        const { engagement } = await (await create(id)).json(); const before = await snapshot(store);
        await store.db.command({ collMod: store.collection("CoachContentEntry").collectionName, validator: { $and: [operationMongoValidator("CoachContentEntry"), { sourceField: { $ne: `coach_engagements.review:${engagement.id}` } }] } });
        for (const body of [{ rating: 5, feedback: privateFeedback }, { toggleFlag: true }, { deleteReview: true }]) {
          await assert.rejects(review(engagement.id, body), /COACH_ENGAGEMENT_WRITE_FAILED/); assert.deepEqual(await snapshot(store), before);
        }
        const failed = await store.scan("ActivityRequest", { route: "/api/engagements/[id]/review", status: 500 }); assert.equal(failed.length, 3);
      }));
    });

    await suite.test("late slot business failure rolls back engagement creation, slots and audit", async () => {
      const { scope, store, id } = await fixture();
      await runWithDataRepositories(scope, () => actors.run(managerA, async () => {
        await reserve(id, [firstDay]); const before = await snapshot(store);
        await store.db.command({ collMod: store.collection("CoachEngagementSchedule").collectionName, validator: { $and: [operationMongoValidator("CoachEngagementSchedule"), { date: { $ne: new Date("2099-12-11") } }] } });
        await assert.rejects(create(id), /COACH_ENGAGEMENT_WRITE_FAILED/); assert.deepEqual(await snapshot(store), before);
      }));
    });

    await suite.test("second reservation audit failure rolls back regenerated slots, engagement and every reservation", async () => {
      const { scope, store, id } = await fixture();
      await runWithDataRepositories(scope, () => actors.run(managerA, async () => {
        const { engagement } = await (await create(id)).json(); await reserve(id, [firstDay, "2099-12-11"]);
        const ordered = await store.collection("CoachDayReservation").find({ coachId: id, cancelledAt: null }).toArray(); assert.equal(ordered.length, 2);
        const before = await snapshot(store), changes = store.collection("ActivityChange");
        await store.db.command({ collMod: changes.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { $nor: [{ targetType: "coach_day_reservations", targetId: ordered[1]._id, action: "update" }] }] } });
        const attempts: string[] = [], observe = (event: CommandStartedEvent) => { if (event.command.insert === changes.collectionName) for (const document of event.command.documents ?? []) if (document.targetType === "coach_day_reservations") attempts.push(document.targetId); };
        client.on("commandStarted", observe);
        try { await assert.rejects(update(engagement.id, { startTime: "10:00" }), /COACH_ENGAGEMENT_WRITE_FAILED/); } finally { client.off("commandStarted", observe); }
        assert.deepEqual(attempts, ordered.map(row => row._id)); assert.deepEqual(await snapshot(store), before);
      }));
    });

    await suite.test("both serial reserve-confirm orders remain allowed and cancellation history retains confirmation", async () => {
      const { scope, store, id } = await fixture();
      await runWithDataRepositories(scope, () => actors.run(managerA, async () => {
        await reserve(id, [firstDay]); const { engagement } = await (await create(id, { ...basic, endDate: firstDay })).json();
        const confirmed = await store.one("CoachDayReservation", { coachId: id }); assert.ok(confirmed?.cancelledAt); assert.equal(confirmed.confirmedEngagementId, engagement.id);
        const later = await reserve(id, [firstDay]); assert.equal(later.status, 200); assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id, cancelledAt: null }), 1);
        await cancel(id, [firstDay]); assert.equal((await store.one("CoachDayReservation", { _id: confirmed.id as string }))?.confirmedEngagementId, engagement.id);
        assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id }), 2);
      }));
    });

    for (const firstWriter of ["reserve", "confirm"] as const) await suite.test(`concurrent ${firstWriter} first forces the opposite writer to retry before committing`, async () => {
      const f = await fixture(), { store, id, options } = f;
      await store.db.collection<{ _id: string; nonce: string }>(`${options.namespace}_CoachSchedulingGuard`).insertOne({ _id: id, nonce: randomUUID() });
      assert.equal(await store.collection("CoachDayReservation").countDocuments({ coachId: id }), 0);
      assert.equal(await store.collection("CoachEngagementSchedule").countDocuments({ coachId: id }), 0);
      const doReserve = () => reserve(id, [firstDay]), doConfirm = () => create(id, { ...basic, endDate: firstDay });
      const result = await forceGuardOrder(f, firstWriter === "reserve" ? doReserve : doConfirm, firstWriter === "reserve" ? doConfirm : doReserve);
      assert.deepEqual(result.responses.map(row => row.status), firstWriter === "reserve" ? [200,201] : [201,200]);
      const engagement = await store.one("CoachEngagement", { coachId: id }); assert.ok(engagement);
      const rows = await store.scan("CoachDayReservation", { coachId: id }); assert.equal(rows.length, 1);
      if (firstWriter === "reserve") { assert.ok(rows[0].cancelledAt instanceof Date); assert.equal(rows[0].confirmedEngagementId, engagement.id); }
      else { assert.equal(rows[0].cancelledAt, null); assert.equal(rows[0].confirmedEngagementId, null); }
      assert.equal(await store.collection("CoachEngagementSchedule").countDocuments({ engagementId: engagement.id }), 1);
      assert.equal(await store.collection("ActivityRequest").countDocuments({ status: { $in: [200,201] } }), 2);
    });

    await suite.test("absent guard concurrent upserts retry and preserve both business transactions", async () => {
      const f = await fixture(), { store, id, options } = f;
      const guards = store.db.collection(`${options.namespace}_CoachSchedulingGuard`);
      assert.equal(await guards.countDocuments(), 0);
      const result = await forceGuardOrder(f, () => reserve(id, [firstDay]), () => create(id, { ...basic, endDate: firstDay }));
      assert.equal(result.firstUpserted, 1, "The first guard is inserted inside the held uncommitted transaction");
      assert.deepEqual(result.responses.map(row => row.status), [200,201]); assert.equal(await guards.countDocuments(), 1);
      const engagement = await store.one("CoachEngagement", { coachId: id }); assert.ok(engagement);
      const rows = await store.scan("CoachDayReservation", { coachId: id }); assert.equal(rows.length, 1);
      assert.ok(rows[0].cancelledAt instanceof Date); assert.equal(rows[0].confirmedEngagementId, engagement.id);
      assert.equal(await store.collection("CoachEngagementSchedule").countDocuments({ engagementId: engagement.id }), 1);
    });

    await suite.test("concurrent review toggles reread after a guard conflict and return to the original flag", async () => {
      const f = await fixture(), { store, id, scope } = f;
      const { engagement } = await runWithDataRepositories(scope, () => actors.run(managerA, async () => (await create(id)).json()));
      const result = await forceGuardOrder(f, () => review(engagement.id, { toggleFlag: true }), () => review(engagement.id, { toggleFlag: true }));
      assert.deepEqual(result.responses.map(row => row.status), [200,200]);
      assert.ok((await result.responses[0].json()).engagement.reviewFlaggedAt);
      assert.equal((await result.responses[1].json()).engagement.reviewFlaggedAt, null);
      assert.ok(result.secondReads.length >= 3, "Conflicting initial read and both retried reads must reach Mongo");
      assert.equal(result.secondReads[0].reviewFlaggedAt, null);
      assert.ok(result.secondReads.slice(-2).every(row => row.reviewFlaggedAt instanceof Date), "Retry must reread the first writer's committed flag");
      assert.equal((await store.one("CoachEngagement", { _id: engagement.id }))?.reviewFlaggedAt, null);
      const logs = await store.scan("CoachContentEntry", { sourceField: `coach_engagements.review:${engagement.id}` });
      assert.deepEqual(logs.map(row => row.content).sort(), ["리뷰 경고 설정", "리뷰 경고 해제"].sort());
      const changes = await store.scan("ActivityChange", { targetId: engagement.id, action: "update" }); assert.equal(changes.length, 2);
    });

    await suite.test("concurrent partial PUTs reread after conflict and retain both independently changed fields", async () => {
      const f = await fixture(), { store, id, scope } = f;
      const { engagement } = await runWithDataRepositories(scope, () => actors.run(managerA, async () => (await create(id)).json()));
      const courseName = "Concurrent renamed course";
      const result = await forceGuardOrder(f, () => update(engagement.id, { courseName }), () => update(engagement.id, { status: "completed" }));
      assert.deepEqual(result.responses.map(row => row.status), [200,200]);
      assert.ok(result.secondReads.length >= 3);
      assert.equal(result.secondReads[0].courseName, basic.courseName);
      assert.ok(result.secondReads.slice(-2).every(row => row.courseName === courseName), "Retry must reread the first writer's committed course name");
      const row = await store.one("CoachEngagement", { _id: engagement.id }); assert.equal(row?.courseName, courseName); assert.equal(row?.status, "COMPLETED");
      const secondBody = await result.responses[1].json(); assert.equal(secondBody.engagement.courseName, courseName); assert.equal(secondBody.engagement.status, "COMPLETED");
      const changes = await store.scan("ActivityChange", { targetId: engagement.id, action: "update" }); assert.equal(changes.length, 2);
    });

    await suite.test("direct mutations require request activity before writes and guard readiness fails closed", async () => {
      const { scope, store, options, id } = await fixture();
      const before = await snapshot(store);
      await assert.rejects(scope.coachEngagement.createForCoach(id, { courseName: basic.courseName, status: "SCHEDULED", startDate: new Date(firstDay), endDate: new Date(lastDay), startTime: null, endTime: null, rating: null, feedback: null, rehire: null, hiredByText: null }), /ACTIVITY_CONTEXT_REQUIRED/);
      await assert.rejects(scope.coachEngagement.update(randomUUID(), {}), /ACTIVITY_CONTEXT_REQUIRED/);
      await assert.rejects(scope.coachEngagement.updateReview(randomUUID(), { action: "toggleFlag" }, managerA.user), /ACTIVITY_CONTEXT_REQUIRED/);
      assert.deepEqual(await snapshot(store), before);
      const guards = store.db.collection(`${options.namespace}_CoachSchedulingGuard`);
      await store.db.command({ collMod: guards.collectionName, validationLevel: "off" });
      await assert.rejects(MongoCoachEngagementRepository.open(options), /COACH_SCHEDULING_GUARD_NOT_READY/);
      await assert.rejects(MongoCoachScheduleRepository.open(options), /COACH_SCHEDULING_GUARD_NOT_READY/);
      await guards.drop();
      await assert.rejects(MongoCoachEngagementRepository.open(options), /COACH_SCHEDULING_GUARD_NOT_READY/);
      await assert.rejects(MongoCoachScheduleRepository.open(options), /COACH_SCHEDULING_GUARD_NOT_READY/);
      await assert.rejects(MongoCoachEngagementRepository.open({ ...options, allowShadowWrites: false as never }), /SHADOW_WRITE_GATE/);
    });

    await suite.test("missing scoped engagement or request audit fails before business writes", async () => {
      const { scope, store, id } = await fixture();
      await actors.run(managerA, async () => {
        await assert.rejects(runWithDataRepositories({ requestActivity: scope.requestActivity }, () => create(id)), /DATA_REPOSITORY_NOT_CONFIGURED/);
        await assert.rejects(runWithDataRepositories({ coachEngagement: scope.coachEngagement }, () => create(id)), /DATA_REPOSITORY_NOT_CONFIGURED/);
      });
      assert.equal(await store.collection("CoachEngagement").countDocuments(), 0); assert.equal(await store.collection("CoachEngagementSchedule").countDocuments(), 0);
    });
  } finally {
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_engagement_test_[a-f0-9]{24}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
