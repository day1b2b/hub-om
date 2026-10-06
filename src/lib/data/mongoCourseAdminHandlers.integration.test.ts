import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoCourseAdminRepository, prepareMongoCourseAdminStore, COURSE_ADMIN_MODELS } from "./mongoCourseAdminRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { runWithDataRepositories } from "./dataRepositoryContext";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "course-admin@day1company.co.kr", name: "Synthetic course administrator" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PG access"); } } });
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const lookup = await import("../../app/api/admin/courses/lookup/route");
const removal = await import("../../app/api/admin/courses/[courseId]/route");
hook.deregister();
const uri = process.env.MONGODB_COURSE_ADMIN_TEST_URI;
const get = (processId: string) => new Request(`https://example.invalid/api/admin/courses/lookup?processId=${encodeURIComponent(processId)}`);
const del = () => new Request("https://example.invalid/api/admin/courses/synthetic", { method: "DELETE" });
const params = (courseId: string) => ({ params: Promise.resolve({ courseId }) });

test("course admin actual handlers retain authorization, DTO and audit boundaries on native Mongo", { skip: !uri, timeout: 120_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  const env = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL", "ADMIN_EMAILS", "DEV_AUTH_BYPASS"];
  const saved = new Map(env.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email });
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const options = { client, databaseName: `hub_om_shadow_course_handlers_${randomBytes(8).toString("hex")}`, namespace: "shadow_handlers", allowShadowWrites: true as const };
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("External source forbidden"); });
  let connected = false;
  try {
    await client.connect(); connected = true;
    await prepareMongoCourseAdminStore(options); await prepareMongoRequestAuditStore(options);
    const store = new MongoOperationStore(options, [...new Set([...COURSE_ADMIN_MODELS, ...REQUEST_AUDIT_MODELS])]);
    const scope = { courseAdmin: await MongoCourseAdminRepository.open(options), requestActivity: await MongoRequestAuditRepository.open(options) };
    const run = <T>(work: () => Promise<T>, actor: Session | null = admin) => runWithDataRepositories(scope, () => actors.run(actor, work));
    const seed = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
    };
    const company = await seed("Company", { name: "Synthetic company", normalizedName: "synthetic-company" });
    const course = await seed("Course", { companyId: company.id, name: "Synthetic course", processSeq: 533 });
    const id = course.id as string;
    const active = await seed("OperationSession", { courseRecordId: id, specialNotes: "Synthetic confidential course note" });
    const alreadyDeleted = await seed("OperationSession", { courseRecordId: id, deletedAt: new Date("2099-01-01"), deletedBy: "previous@example.invalid" });
    const beforeDeleted = await store.collection("OperationSession").findOne({ _id: alreadyDeleted.id as string });

    await suite.test("real admin guard rejects anonymous, external and workspace non-admin before business calls", async () => {
      for (const actor of [null, { user: { email: "external@example.invalid", name: "Synthetic external" }, expires: "" }, { user: { email: "nonadmin@day1company.co.kr", name: "Synthetic nonadmin" }, expires: "" }]) {
        await assert.rejects(run(() => lookup.GET(get("PRC-000533")), actor), /admin 권한/);
        await assert.rejects(run(() => removal.DELETE(del(), params(id)), actor), /admin 권한/);
      }
      assert.equal(await store.collection("OperationSession").countDocuments({ deletedAt: null }), 1);
      assert.equal(await store.collection("ActivityChange").countDocuments(), 0);
    });
    await suite.test("unchanged process parsing, DTO keys and 400/404 responses", async () => {
      for (const invalid of ["", "533", "PRC--1", "PRC-1.2", `PRC-${"9".repeat(400)}`]) {
        const response = await run(() => lookup.GET(get(invalid)));
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { ok: false, error: "과정ID 형식이 올바르지 않습니다. 예: PRC-000533" });
      }
      for (const absent of ["PRC-0", "PRC-534"]) assert.equal((await run(() => lookup.GET(get(absent)))).status, 404);
      const response = await run(() => lookup.GET(get("  prc-000533  ")));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, course: { courseRecordId: id, processId: "PRC-000533", companyName: "Synthetic company", courseName: "Synthetic course", activeSessionCount: 1 } });
      assert.equal((await run(() => removal.DELETE(del(), params(randomUUID())))).status, 404);
    });
    await suite.test("incomplete scope fails before writes, business errors never fall back", async () => {
      await assert.rejects(runWithDataRepositories({ courseAdmin: scope.courseAdmin }, () => actors.run(admin, () => removal.DELETE(del(), params(id)))), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
      await assert.rejects(runWithDataRepositories({ requestActivity: scope.requestActivity }, () => actors.run(admin, () => removal.DELETE(del(), params(id)))), /DATA_REPOSITORY_NOT_CONFIGURED: courseAdmin/);
      const changes = store.collection("ActivityChange");
      await store.db.command({ collMod: changes.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { targetType: { $ne: "operation_sessions" } }] } });
      try { await assert.rejects(run(() => removal.DELETE(del(), params(id)))); }
      finally { await store.db.command({ collMod: changes.collectionName, validator: operationMongoValidator("ActivityChange") }); }
      assert.equal(await store.collection("OperationSession").countDocuments({ deletedAt: null }), 1);
      assert.equal(await changes.countDocuments(), 0); assert.equal(pgCalls, 0);
    });
    await suite.test("DELETE records encrypted actor and atomic change, preserves course and prior deletion, repeats with zero", async () => {
      const response = await run(() => removal.DELETE(del(), params(id.toUpperCase())));
      assert.deepEqual(await response.json(), { ok: true, deletedCount: 1 });
      const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
      const changes = await store.scan("ActivityChange", { requestId });
      assert.equal(changes.length, 1); assert.equal(changes[0].action, "delete"); assert.equal(changes[0].targetId, active.id);
      const request = await store.one("ActivityRequest", { _id: requestId });
      assert.equal(request?.actorEmail, admin.user.email); assert.equal(request?.status, 200);
      const row = await store.one("OperationSession", { _id: active.id as string });
      assert.ok(row?.deletedAt); assert.equal(row?.deletedBy, admin.user.email);
      assert.equal(await store.collection("Course").countDocuments({ _id: id }), 1);
      assert.deepEqual(await store.collection("OperationSession").findOne({ _id: alreadyDeleted.id as string }), beforeDeleted);
      assert.deepEqual(await (await run(() => removal.DELETE(del(), params(id)))).json(), { ok: true, deletedCount: 0 });
      assert.equal(await store.collection("ActivityChange").countDocuments(), 1);
      assert.equal((await (await run(() => lookup.GET(get("PRC-533")))).json()).course.activeSessionCount, 0);
    });
    await suite.test("request audit failure remains best effort and logs only fixed text", async () => {
      const messages: unknown[][] = [], logger = mock.method(console, "error", (...args: unknown[]) => { messages.push(args); });
      try {
        const response = await runWithDataRepositories({ ...scope, requestActivity: { recordRequest: async () => { throw new Error("Synthetic private failure"); } } }, () => actors.run(admin, () => removal.DELETE(del(), params(id))));
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, deletedCount: 0 });
        assert.deepEqual(messages, [["[activity] API request log write failed"]]);
      } finally { logger.mock.restore(); }
    });
    const raw = JSON.stringify(await Promise.all(store.models.map(model => store.collection(model).find({}).toArray())));
    for (const marker of [admin.user.email, admin.user.name, "Synthetic confidential course note", "previous@example.invalid"]) assert.ok(!raw.includes(marker));
    assert.equal(pgCalls, 0); assert.equal(external.mock.callCount(), 0);
  } finally {
    if (connected) await client.db(options.databaseName).dropDatabase(); await client.close(); external.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
