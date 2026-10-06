import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoCourseNameRestoreRepository, prepareMongoCourseNameRestoreStore, COURSE_NAME_RESTORE_MODELS } from "./mongoCourseNameRestoreRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { runWithDataRepositories } from "./dataRepositoryContext";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "course-restore-admin@day1company.co.kr", name: "Synthetic course restorer" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PG access"); } } });
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const route = await import("../../app/api/admin/course-name-restore/route");
hook.deregister();
const uri = process.env.MONGODB_COURSE_NAME_RESTORE_TEST_URI;
const get = (courseId = "123") => route.GET(new Request(`https://example.invalid/api/admin/course-name-restore?courseId=${encodeURIComponent(courseId)}`));
const post = (value: unknown) => route.POST(new Request("https://example.invalid/api/admin/course-name-restore", { method: "POST", body: JSON.stringify(value) }));

test("course name restore actual handlers retain admin, bounded inputs, conflict responses and encrypted activity on Mongo", { skip: !uri, timeout: 120_000 }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL", "ADMIN_EMAILS", "DEV_AUTH_BYPASS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email });
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const options = { client, databaseName: `hub_om_shadow_course_restore_handlers_${randomBytes(6).toString("hex")}`, namespace: "shadow_handlers", allowShadowWrites: true as const };
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("External source forbidden"); });
  let connected = false;
  try {
    await client.connect(); connected = true;
    await prepareMongoCourseNameRestoreStore({ ...options, processSequenceHighWater: 1000 }); await prepareMongoRequestAuditStore(options);
    const store = new MongoOperationStore(options, [...new Set([...COURSE_NAME_RESTORE_MODELS, ...REQUEST_AUDIT_MODELS])]);
    const scope = { courseNameRestore: await MongoCourseNameRestoreRepository.open(options), requestActivity: await MongoRequestAuditRepository.open(options) };
    const run = <T>(work: () => Promise<T>, actor: Session | null = admin) => runWithDataRepositories(scope, () => actors.run(actor, work));
    const seed = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
    };
    const company = await seed("Company", { name: "Synthetic restore company", normalizedName: "synthetic-restore-company" });
    const course = await seed("Course", { companyId: company.id, courseId: "123\u200b", processSeq: 10, name: "Synthetic merged course", tools: "Synthetic tools", revenue: "123.45" });
    const sessions: MongoRow[] = [];
    for (const operationId of ["SYNTHETIC-RESTORE-A", " SYNTHETIC-RESTORE-B "]) {
      const session = await seed("OperationSession", { courseRecordId: course.id, operationId, deletedAt: null, updatedBy: "synthetic-prior-editor@example.invalid", specialNotes: "Synthetic private retained note" });
      sessions.push(session);
      await seed("OperationSourceRecord", { operationSessionId: session.id, mappedFields: { courseName: " Synthetic restored course ", privateMarker: "Synthetic private mapped marker" }, rowSnapshot: { note: "Synthetic private source snapshot" } });
    }
    // Snapshot all business collections plus internal coordination/counter, omitting request logs.
    const raw = async () => {
      const collections = await store.db.listCollections({}, { nameOnly: true }).toArray();
      const result: Record<string, unknown> = {};
      for (const entry of collections.sort((a, b) => a.name.localeCompare(b.name))) if (!entry.name.endsWith("_ActivityRequest")) result[entry.name] = await store.db.collection(entry.name).find({}).sort({ _id: 1 }).toArray();
      return result;
    };
    const initial = await raw();
    await suite.test("actual admin guard returns 403 without business changes", async () => {
      for (const actor of [null, { user: { email: "outside@example.invalid", name: "Synthetic outsider" }, expires: "" }, { user: { email: "ordinary@day1company.co.kr", name: "Synthetic member" }, expires: "" }]) {
        assert.equal((await run(() => get(), actor)).status, 403);
        assert.equal((await run(() => post({}), actor)).status, 403);
      }
      assert.deepEqual(await raw(), initial);
    });
    let snapshot = "";
    await suite.test("GET normalizes the course ID and returns a stable, read-only plan", async () => {
      const response = await run(() => get(" 123.0\u200b ")); assert.equal(response.status, 200);
      const body = await response.json(); assert.equal(body.ok, true); assert.equal(body.plan.courseId, "123");
      assert.equal(body.plan.rows.length, 2); assert.ok(body.plan.rows.every((row: { restorable: boolean }) => row.restorable));
      assert.ok(body.plan.rows.every((row: { updatedBy: string }) => row.updatedBy === "synthetic-prior-editor@example.invalid"));
      snapshot = body.plan.snapshot; assert.match(snapshot, /^[a-f0-9]{64}$/);
      assert.equal((await (await run(() => get())).json()).plan.snapshot, snapshot);
      assert.deepEqual(await raw(), initial);
    });
    const valid = () => ({ courseId: "123", operationIds: [sessions[0].operationId], snapshot });
    await suite.test("400/413 validation remains before business access, and whitespace operation IDs are not normalized", async () => {
      for (const id of ["", "\u200b", "x".repeat(201)]) assert.equal((await run(() => get(id))).status, 400);
      for (const body of [null, [], {}, { ...valid(), courseId: 1 }, { ...valid(), operationIds: [] }, { ...valid(), operationIds: [null] },
        { ...valid(), operationIds: [" "] }, { ...valid(), operationIds: ["x".repeat(201)] }, { ...valid(), operationIds: ["same", "same"] },
        { ...valid(), operationIds: Array.from({ length: 101 }, (_, n) => String(n)) }, { ...valid(), snapshot: "A".repeat(64) }]) assert.equal((await run(() => post(body))).status, 400);
      assert.equal((await run(() => route.POST(new Request("https://example.invalid/test", { method: "POST", body: "{" })))).status, 400);
      assert.equal((await run(() => post({ ...valid(), extra: "x".repeat(33_000) }))).status, 413);
      assert.equal((await run(() => post({ ...valid(), operationIds: [String(sessions[1].operationId).trim()] }))).status, 409);
      assert.deepEqual(await raw(), initial);
    });
    await suite.test("missing scoped repositories cannot use PG, and real audit failure rolls back new course/counter/guard/session", async () => {
      await assert.rejects(runWithDataRepositories({ courseNameRestore: scope.courseNameRestore }, () => actors.run(admin, () => post(valid()))), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
      const response = await runWithDataRepositories({ requestActivity: scope.requestActivity }, () => actors.run(admin, () => get()));
      assert.equal(response.status, 500); assert.ok(!(await response.text()).includes("DATA_REPOSITORY"));
      const audit = store.collection("ActivityChange");
      await store.db.command({ collMod: audit.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { targetType: { $ne: "operation_sessions" } }] } });
      try {
        const failed = await run(() => post(valid())); assert.equal(failed.status, 500);
        assert.deepEqual(await failed.json(), { ok: false, error: "복구하지 못해 전체 작업을 취소했습니다. 다시 조회해 주세요." });
      } finally { await store.db.command({ collMod: audit.collectionName, validator: operationMongoValidator("ActivityChange") }); }
      assert.deepEqual(await raw(), initial); assert.equal(pgCalls, 0);
    });
    await suite.test("valid selection creates one target, preserves other data, audits under request ID and refuses stale replay", async () => {
      const response = await run(() => post(valid())); assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, result: { moved: [{ operationId: sessions[0].operationId, from: "Synthetic merged course", to: "Synthetic restored course" }], skipped: [] } });
      const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
      const audits = await store.scan("ActivityChange", { requestId }); assert.equal(audits.length, 2);
      assert.ok(audits.every(row => row.actorEmail === admin.user.email && row.actorName === admin.user.name));
      assert.equal((await store.one("ActivityRequest", { _id: requestId }))?.status, 200);
      const moved = await store.one("OperationSession", { _id: sessions[0].id as string }); assert.equal(moved?.updatedBy, admin.user.email);
      assert.equal(moved?.specialNotes, "Synthetic private retained note");
      assert.equal((await store.one("OperationSession", { _id: sessions[1].id as string }))?.courseRecordId, course.id);
      const after = await raw(); assert.equal((await run(() => post(valid()))).status, 409); assert.deepEqual(await raw(), after);
    });
    await suite.test("fresh plan reuses the target, retains exact padded ID and request audit failure does not undo success", async () => {
      const plan = (await (await run(() => get())).json()).plan;
      const errors: unknown[][] = [], logger = mock.method(console, "error", (...args: unknown[]) => { errors.push(args); });
      try {
        const response = await runWithDataRepositories({ ...scope, requestActivity: { recordRequest: async () => { throw new Error("Synthetic private request failure"); } } }, () => actors.run(admin, () => post({ courseId: "123", operationIds: [sessions[1].operationId], snapshot: plan.snapshot })));
        assert.equal(response.status, 200); assert.equal((await response.json()).result.moved[0].operationId, sessions[1].operationId);
        assert.equal(await store.collection("Course").countDocuments(), 2); assert.equal(await store.collection("ActivityChange").countDocuments(), 3);
        assert.deepEqual(errors, [["[activity] API request log write failed"]]);
      } finally { logger.mock.restore(); }
    });
    const stored = JSON.stringify(await raw());
    for (const marker of [admin.user.email, admin.user.name, "synthetic-prior-editor@example.invalid", "Synthetic private retained note", "Synthetic private mapped marker", "Synthetic private source snapshot"]) assert.ok(!stored.includes(marker));
    assert.equal(pgCalls, 0); assert.equal(external.mock.callCount(), 0);
  } finally {
    if (connected) await client.db(options.databaseName).dropDatabase(); await client.close(); external.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
