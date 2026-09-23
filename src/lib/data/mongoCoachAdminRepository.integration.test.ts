import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { Collection, MongoClient } from "mongodb";
import { MongoCoachAdminRepository, prepareMongoCoachAdminStore, COACH_ADMIN_MODELS } from "./mongoCoachAdminRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore } from "./mongoRequestAuditRepository";
import { MongoOperationStore } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { coachAdminPurgeExpected, coachAdminPurgeRows, PURGE_IDS, PURGE_PRIVATE_NAME } from "./coachAdminPurgeFixture";
import { activityContext } from "../activity/context";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { isEncrypted } from "../privacy/crypto";

let workspace = true, admin = true;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("Unexpected PostgreSQL access in Mongo API request"); } } });
mock.module("../auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => { if (!workspace) throw new Error("synthetic unauthorized"); return { user: { email: "synthetic-manager@example.invalid", name: "Synthetic manager" } }; } } });
mock.module("../auth/requireAdminSession", { namedExports: { assertAdminSession: async () => { if (!admin) throw new Error("synthetic admin required"); return { user: { email: "synthetic-admin@example.invalid", name: "Synthetic admin" } }; } } });
mock.module("../activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
const hook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const fieldsRoute = await import("../../app/api/master/fields/route"), curriculumsRoute = await import("../../app/api/master/curriculums/route"), deletedRoute = await import("../../app/api/admin/deleted-coaches/route");
hook.deregister();
const uri = process.env.MONGODB_COACH_ADMIN_TEST_URI;
const json = (method: string, body?: unknown) => new Request("https://example.invalid/api/test", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const actor = () => ({ requestId: randomUUID(), route: "/api/admin/deleted-coaches", method: "DELETE", actorType: "user" as const, actorEmail: "synthetic-admin@example.invalid", actorName: "Synthetic admin" });

test("coach tag-master and deleted-coach admin handlers on an isolated Mongo replica set", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_coach_admin_${randomBytes(8).toString("hex")}`;
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"], saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  let connected = false;
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_admin_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoCoachAdminStore(options); await prepareMongoRequestAuditStore(options);
    const store = new MongoOperationStore(options, COACH_ADMIN_MODELS);
    for (const [model, rows] of coachAdminPurgeRows) for (const row of rows) await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, coachFixtureRow(model, row)));
    const scope = { coachAdmin: await MongoCoachAdminRepository.open(options) };
    const run = <T>(work: () => Promise<T>) => runWithDataRepositories(scope, () => activityContext.run(actor(), work));
    return { options, store, scope, run, audit: await MongoRequestAuditRepository.open(options) };
  }
  const counts = async (store: MongoOperationStore) => Object.fromEntries(await Promise.all(Object.keys(coachAdminPurgeExpected).map(async model => [model, await store.collection(model).countDocuments()])));
  try {
    await client.connect(); connected = true;

    await suite.test("permanent delete matches the schema Cascade/SetNull graph, audits like PG triggers and refuses live or missing coaches", async () => {
      const f = await fixture(), before = await counts(f.store);
      await f.run(async () => {
        assert.equal((await deletedRoute.DELETE(json("DELETE", { id: PURGE_IDS.live }))).status, 400);
        assert.equal((await deletedRoute.DELETE(json("DELETE", { id: randomUUID() }))).status, 400);
        assert.equal((await deletedRoute.DELETE(json("DELETE", {}))).status, 400);
        admin = false; await assert.rejects(deletedRoute.DELETE(json("DELETE", { id: PURGE_IDS.deleted })), /synthetic admin required/); admin = true;
        assert.deepEqual(await counts(f.store), before);
        const response = await deletedRoute.DELETE(json("DELETE", { id: PURGE_IDS.deleted.toUpperCase() }));
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
      });
      assert.deepEqual(await counts(f.store), coachAdminPurgeExpected);
      assert.equal((await f.store.one("CoachDayReservation", { _id: PURGE_IDS.crossReservation }))?.confirmedEngagementId, null, "SetNull keeps the other coach's reservation");
      assert.equal(await f.store.collection("CoachFieldMaster").countDocuments({ _id: PURGE_IDS.field }), 1);
      const audit = await f.store.scan("ActivityChange", {});
      for (const table of ["coaches", "coach_private_profiles", "coach_fields", "coach_curriculums", "coach_content_entries", "coach_schedules", "coach_day_reservations", "coach_engagements", "coach_engagement_schedules"])
        assert.ok(audit.some(row => row.targetType === table && row.action === "delete"), `${table} delete audit`);
      assert.ok(audit.some(row => row.targetType === "coach_day_reservations" && row.targetId === PURGE_IDS.crossReservation && row.action === "update"));
      assert.ok(!audit.some(row => ["coach_schedule_access_logs", "coach_private_access_logs"].includes(row.targetType as string)));
      const raw = JSON.stringify(await f.store.collection("ActivityChange").find({}).toArray());
      assert.ok(!raw.includes(PURGE_PRIVATE_NAME) && !raw.includes("purge-private@example.invalid"));
      await f.run(async () => assert.equal((await deletedRoute.DELETE(json("DELETE", { id: PURGE_IDS.deleted }))).status, 400));
    });

    await suite.test("deleted list and restore keep the previous DTOs and decrypt only for the admin response", async () => {
      const f = await fixture();
      await f.run(async () => {
        const listed = await (await deletedRoute.GET()).json();
        assert.deepEqual(listed.coaches.map((row: { id: string }) => row.id), [PURGE_IDS.restorable, PURGE_IDS.deleted]);
        assert.deepEqual(Object.keys(listed.coaches[0]).sort(), ["deletedAt", "deletedBy", "id", "name", "status", "workType"]);
        assert.equal(listed.coaches[1].name, PURGE_PRIVATE_NAME); assert.equal(listed.coaches[1].deletedBy, "purge-admin@example.invalid");
        assert.equal(listed.coaches[0].deletedAt, "2099-01-03T00:00:00.000Z"); assert.equal(listed.coaches[0].status, listed.coaches[0].status.toLowerCase());
        assert.equal((await deletedRoute.PUT(json("PUT", {}))).status, 400);
        await assert.rejects(deletedRoute.PUT(json("PUT", { id: randomUUID() })));
        const restored = await deletedRoute.PUT(json("PUT", { id: PURGE_IDS.restorable.toUpperCase() }));
        assert.equal(restored.status, 200); assert.deepEqual(await restored.json(), { ok: true, coach: { id: PURGE_IDS.restorable, name: "가상복원코치" } });
        assert.deepEqual((await (await deletedRoute.GET()).json()).coaches.map((row: { id: string }) => row.id), [PURGE_IDS.deleted]);
      });
      const coach = await f.store.one("Coach", { _id: PURGE_IDS.restorable }); assert.equal(coach?.deletedAt, null); assert.equal(coach?.deletedBy, null);
      const raw = await f.store.collection("Coach").findOne({ _id: PURGE_IDS.deleted }); assert.ok(raw && isEncrypted(raw.name) && isEncrypted(raw.deletedBy));
      assert.ok((await f.store.scan("ActivityChange", {})).some(row => row.targetType === "coaches" && row.targetId === PURGE_IDS.restorable && row.action === "restore"));
    });

    await suite.test("tag masters list by name, upsert idempotently and converge on one row under concurrent first inserts", async () => {
      const f = await fixture();
      await f.run(async () => {
        assert.deepEqual((await (await fieldsRoute.GET()).json()).fields.map((row: { name: string }) => row.name), ["가 분야", "나 분야"]);
        assert.deepEqual(Object.keys((await (await fieldsRoute.GET()).json()).fields[0]).sort(), ["id", "name"]);
        assert.equal((await fieldsRoute.POST(json("POST", { name: " " }))).status, 400);
        workspace = false; await assert.rejects(curriculumsRoute.GET(), /synthetic unauthorized/); workspace = true;
        const existing = await (await fieldsRoute.POST(json("POST", { name: " 나 분야 " }))).json(); assert.deepEqual(existing.field, { id: PURGE_IDS.field, name: "나 분야" });
        const responses = await Promise.all([1, 2, 3].map(() => curriculumsRoute.POST(json("POST", { name: "다 커리큘럼" }))));
        assert.deepEqual(responses.map(row => row.status), [201, 201, 201]);
        const created = await Promise.all(responses.map(row => row.json()));
        assert.equal(new Set(created.map(row => row.curriculum.id)).size, 1);
        assert.deepEqual((await (await curriculumsRoute.GET()).json()).curriculums.map((row: { name: string }) => row.name), ["가 커리큘럼", "다 커리큘럼"]);
      });
      assert.equal(await f.store.collection("CoachCurriculumMaster").countDocuments({ name: "다 커리큘럼" }), 1);
      assert.equal(await f.store.collection("CoachFieldMaster").countDocuments(), 2);
    });

    await suite.test("a private-access log held mid-transaction serializes with permanent delete and leaves no orphan", async () => {
      const f = await fixture();
      const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
      const held = deferred(), release = deferred(), original = Collection.prototype.insertOne, logs = `${f.options.namespace}_CoachPrivateAccessLog`;
      let holds = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        if (this.collectionName === logs && holds++ === 0) { held.resolve(); await release.promise; }
        return original.apply(this, args);
      });
      try {
        const access = f.audit.recordAccess(PURGE_IDS.deleted, "reader@example.invalid", "coach_detail"); void access.catch(() => {});
        await held.promise;
        let settled = false;
        const purge = f.run(() => deletedRoute.DELETE(json("DELETE", { id: PURGE_IDS.deleted }))); void purge.finally(() => { settled = true; });
        await new Promise(done => setTimeout(done, 300));
        assert.equal(settled, false, "the purge must be blocked by the held access-log transaction's guard write");
        release.resolve();
        await access; assert.equal((await purge).status, 200);
      } finally { release.resolve(); held.resolve(); patch.mock.restore(); }
      assert.equal(await f.store.collection("CoachPrivateAccessLog").countDocuments(), 0, "the committed access log was removed by the retried purge");
      assert.equal(await f.store.collection("Coach").countDocuments({ _id: PURGE_IDS.deleted }), 0);
      await assert.rejects(f.audit.recordAccess(PURGE_IDS.deleted, "reader@example.invalid", "coach_detail"), (error: unknown) => (error as { code?: string }).code === "AUDIT_COACH_NOT_FOUND");
    });
  } finally {
    workspace = true; admin = true;
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_coach_admin_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
