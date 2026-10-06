import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoDeletedOperationRepository, prepareMongoDeletedOperationStore, DELETED_OPERATION_MODELS } from "./mongoDeletedOperationRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { runWithDataRepositories } from "./dataRepositoryContext";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "restore-admin@day1company.co.kr", name: "Synthetic restore administrator" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PG access"); } } });
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const route = await import("../../app/api/admin/deleted-operations/route");
hook.deregister();
const uri = process.env.MONGODB_DELETED_OPERATION_TEST_URI;
const request = (value: unknown) => new Request("https://example.invalid/api/admin/deleted-operations", { method: "PUT", body: JSON.stringify(value), headers: { "content-type": "application/json" } });

test("deleted operations actual handlers retain admin access, input semantics and request audit on native Mongo", { skip: !uri, timeout: 120_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL", "ADMIN_EMAILS", "DEV_AUTH_BYPASS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email });
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const options = { client, databaseName: `hub_om_shadow_deleted_handlers_${randomBytes(8).toString("hex")}`, namespace: "shadow_handlers", allowShadowWrites: true as const };
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("External source forbidden"); });
  let connected = false;
  try {
    await client.connect(); connected = true;
    await prepareMongoDeletedOperationStore(options); await prepareMongoRequestAuditStore(options);
    const store = new MongoOperationStore(options, [...new Set([...DELETED_OPERATION_MODELS, ...REQUEST_AUDIT_MODELS])]);
    const scope = { deletedOperations: await MongoDeletedOperationRepository.open(options), requestActivity: await MongoRequestAuditRepository.open(options) };
    const run = <T>(work: () => Promise<T>, actor: Session | null = admin) => runWithDataRepositories(scope, () => actors.run(actor, work));
    const seed = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
    };
    const company = await seed("Company", { name: "Synthetic company", normalizedName: "synthetic-company" });
    const course = await seed("Course", { companyId: company.id, name: "Synthetic restore course", processSeq: 533 });
    const deletedAt = new Date("2099-02-01T12:34:56.789Z");
    const rows: MongoRow[] = [];
    for (const operationId of ["", " ", "SyntheticCase", "syntheticcase"]) rows.push(await seed("OperationSession", {
      courseRecordId: course.id, operationId, deletedAt, deletedBy: "synthetic-deleter@example.invalid", roundNo: null,
      startDate: new Date("2099-01-01"), endDate: new Date("2099-01-02"), specialNotes: "Synthetic confidential restore note"
    }));
    const initial = await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray();
    await suite.test("real admin guard rejects anonymous, outsiders and workspace non-admins with no business writes", async () => {
      for (const actor of [null, { user: { email: "outside@example.invalid", name: "Synthetic outsider" }, expires: "" }, { user: { email: "ordinary@day1company.co.kr", name: "Synthetic member" }, expires: "" }]) {
        await assert.rejects(run(() => route.GET(), actor), /admin 권한/);
        await assert.rejects(run(() => route.PUT(request({ operationId: "" })), actor), /admin 권한/);
      }
      assert.deepEqual(await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), initial);
    });
    await suite.test("8-field list DTO decrypts deletedBy only for the authorized response", async () => {
      const response = await run(() => route.GET()); assert.equal(response.status, 200);
      const data = await response.json(); assert.equal(data.ok, true); assert.equal(data.operations.length, 4);
      for (const operation of data.operations) assert.deepEqual(operation, {
        operationId: operation.operationId, companyName: "Synthetic company", courseName: "Synthetic restore course", roundNo: null,
        startDate: "2099-01-01", endDate: "2099-01-02", deletedAt: deletedAt.toISOString(), deletedBy: "synthetic-deleter@example.invalid"
      });
      assert.deepEqual(new Set(data.operations.map((row: { operationId: string }) => row.operationId)), new Set(["", " ", "SyntheticCase", "syntheticcase"]));
    });
    await suite.test("malformed JSON and non-string ID retain 400; JSON null and missing ID retain exceptions", async () => {
      const malformed = new Request("https://example.invalid/api/admin/deleted-operations", { method: "PUT", body: "{" });
      assert.equal((await run(() => route.PUT(malformed))).status, 400);
      for (const value of [{}, { operationId: null }, { operationId: 1 }, { operationId: [] }, [], true]) {
        const response = await run(() => route.PUT(request(value))); assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { ok: false, error: "운영 차수 ID가 필요합니다." });
      }
      await assert.rejects(run(() => route.PUT(request(null))), TypeError);
      await assert.rejects(run(() => route.PUT(request({ operationId: "missing-synthetic-id" }))));
      assert.deepEqual(await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), initial);
    });
    await suite.test("scope omissions and failed business audit cannot fall back or commit a partial restoration", async () => {
      await assert.rejects(runWithDataRepositories({ deletedOperations: scope.deletedOperations }, () => actors.run(admin, () => route.PUT(request({ operationId: "" })))), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
      await assert.rejects(runWithDataRepositories({ requestActivity: scope.requestActivity }, () => actors.run(admin, () => route.GET())), /DATA_REPOSITORY_NOT_CONFIGURED: deletedOperations/);
      const audit = store.collection("ActivityChange");
      await store.db.command({ collMod: audit.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { action: { $ne: "restore" } }] } });
      try { await assert.rejects(run(() => route.PUT(request({ operationId: "" })))); }
      finally { await store.db.command({ collMod: audit.collectionName, validator: operationMongoValidator("ActivityChange") }); }
      assert.deepEqual(await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), initial);
      assert.equal(await audit.countDocuments(), 0); assert.equal(pgCalls, 0);
    });
    await suite.test("exact empty/space/case IDs restore independently, return the original DTO and replay without extra change audit", async () => {
      for (const [index, row] of rows.entries()) {
        const operationId = row.operationId as string;
        const response = await run(() => route.PUT(request({ operationId })));
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, operation: { operationId } });
        const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
        const changes = await store.scan("ActivityChange", { requestId });
        assert.equal(changes.length, 1); assert.equal(changes[0].action, "restore"); assert.equal(changes[0].targetId, row.id);
        assert.equal((await store.one("ActivityRequest", { _id: requestId }))?.status, 200);
        const logical = await store.one("OperationSession", { _id: row.id as string });
        assert.equal(logical?.deletedAt, null); assert.equal(logical?.deletedBy, null);
        assert.equal((await (await run(() => route.GET())).json()).operations.length, 3 - index);
        assert.deepEqual(await (await run(() => route.PUT(request({ operationId })))).json(), { ok: true, operation: { operationId } });
        assert.equal(await store.collection("ActivityChange").countDocuments(), index + 1);
      }
    });
    await suite.test("request logging failure preserves successful restoration and exposes only fixed log text", async () => {
      const messages: unknown[][] = [], logger = mock.method(console, "error", (...args: unknown[]) => { messages.push(args); });
      try {
        const response = await runWithDataRepositories({ ...scope, requestActivity: { recordRequest: async () => { throw new Error("Synthetic private request failure"); } } }, () => actors.run(admin, () => route.PUT(request({ operationId: "" }))));
        assert.equal(response.status, 200); assert.deepEqual(messages, [["[activity] API request log write failed"]]);
      } finally { logger.mock.restore(); }
    });
    const raw = JSON.stringify(await Promise.all(store.models.map(model => store.collection(model).find({}).toArray())));
    for (const marker of [admin.user.email, admin.user.name, "synthetic-deleter@example.invalid", "Synthetic confidential restore note"]) assert.ok(!raw.includes(marker));
    assert.equal(pgCalls, 0); assert.equal(external.mock.callCount(), 0);
  } finally {
    if (connected) await client.db(options.databaseName).dropDatabase(); await client.close(); external.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
