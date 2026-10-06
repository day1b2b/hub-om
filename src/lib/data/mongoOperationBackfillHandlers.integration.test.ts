import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoOperationBackfillRepository, prepareMongoOperationBackfillStore, OPERATION_BACKFILL_MODELS } from "./mongoOperationBackfillRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { runWithDataRepositories } from "./dataRepositoryContext";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "backfill-admin@day1company.co.kr", name: "Synthetic backfill administrator" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PG access"); } } });
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const onsite = await import("../../app/api/admin/onsite-required-backfill/route");
const om = await import("../../app/api/admin/om-assignment-status-backfill/route");
hook.deregister();
const uri = process.env.MONGODB_OPERATION_BACKFILL_TEST_URI;
// Both original POST handlers ignore their arguments, including malformed bodies.
const post = (route: typeof onsite, body = "{"): Promise<Response> => Reflect.apply(route.POST, undefined, [
  new Request("https://example.invalid/api/admin/synthetic-backfill", { method: "POST", body })
]);

test("operation backfill actual handlers preserve authorization, response, ignored bodies and safe logging on native Mongo", { skip: !uri, timeout: 120_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL", "ADMIN_EMAILS", "DEV_AUTH_BYPASS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email });
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const options = { client, databaseName: `hub_om_shadow_backfill_handlers_${randomBytes(8).toString("hex")}`, namespace: "shadow_handlers", allowShadowWrites: true as const };
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("External source forbidden"); });
  const info: unknown[][] = [];
  const logger = mock.method(console, "info", (...args: unknown[]) => { info.push(args); });
  let connected = false;
  try {
    await client.connect(); connected = true;
    await prepareMongoOperationBackfillStore(options); await prepareMongoRequestAuditStore(options);
    const store = new MongoOperationStore(options, [...new Set([...OPERATION_BACKFILL_MODELS, ...REQUEST_AUDIT_MODELS])]);
    const scope = { operationBackfill: await MongoOperationBackfillRepository.open(options), requestActivity: await MongoRequestAuditRepository.open(options) };
    const run = <T>(work: () => Promise<T>, actor: Session | null = admin) => runWithDataRepositories(scope, () => actors.run(actor, work));
    const seed = async (values: MongoRow) => {
      const row = coachFixtureRow("OperationSession", { onsiteRequired: "N", operationStatus: "ASSIGNMENT_NEEDED", omName: "Synthetic private handler owner", onsiteText: "Synthetic private onsite text", ...values });
      await store.collection("OperationSession").insertOne(encodeMongoRuntimeDocument("OperationSession", row)); return row;
    };
    const first = await seed({});
    await seed({ deletedAt: new Date("2099-01-01"), deletedBy: "synthetic-deleter@example.invalid" });
    const initial = await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray();
    await suite.test("real guard rejects anonymous, outsiders and workspace non-admins before business writes", async () => {
      for (const actor of [null, { user: { email: "outside@example.invalid", name: "Synthetic outsider" }, expires: "" }, { user: { email: "ordinary@day1company.co.kr", name: "Synthetic member" }, expires: "" }]) {
        for (const route of [onsite, om]) {
          await assert.rejects(run(() => route.GET(), actor), /admin 권한/);
          await assert.rejects(run(() => post(route), actor), /admin 권한/);
        }
      }
      assert.deepEqual(await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), initial);
      assert.equal(info.length, 0);
    });
    await suite.test("count is read only and retains the two-field response", async () => {
      for (const route of [onsite, om]) {
        const response = await run(() => route.GET()); assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, targetCount: 1 });
      }
      assert.deepEqual(await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), initial);
      assert.equal(await store.collection("ActivityChange").countDocuments(), 0);
    });
    await suite.test("missing scopes and actual audit validator failure cannot fall back or partially commit", async () => {
      for (const route of [onsite, om]) {
        await assert.rejects(runWithDataRepositories({ operationBackfill: scope.operationBackfill }, () => actors.run(admin, () => post(route))), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
        await assert.rejects(runWithDataRepositories({ requestActivity: scope.requestActivity }, () => actors.run(admin, () => route.GET())), /DATA_REPOSITORY_NOT_CONFIGURED: operationBackfill/);
      }
      const audit = store.collection("ActivityChange");
      await store.db.command({ collMod: audit.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { action: { $ne: "update" } }] } });
      try { for (const route of [onsite, om]) await assert.rejects(run(() => post(route)), error => {
        assert.ok(error instanceof Error); assert.match(error.message, /^Mongo operation failed: [A-Z_]+$/); return true;
      }); }
      finally { await store.db.command({ collMod: audit.collectionName, validator: operationMongoValidator("ActivityChange") }); }
      assert.deepEqual(await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), initial);
      assert.equal(await audit.countDocuments(), 0); assert.equal(info.length, 0); assert.equal(pgCalls, 0);
    });
    await suite.test("each POST ignores malformed body, updates its field and records encrypted actor under the response request ID", async () => {
      for (const [route, field, expected] of [[onsite, "onsiteRequired", "Y"], [om, "operationStatus", "ASSIGNMENT_PLANNED"]] as const) {
        const before = await store.collection("OperationSession").findOne({ _id: first.id as string }); assert.ok(before);
        const response = await run(() => post(route)); assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, updatedCount: 1 });
        const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
        const changes = await store.scan("ActivityChange", { requestId });
        assert.equal(changes.length, 1); assert.equal(changes[0].action, "update"); assert.equal(changes[0].actorEmail, admin.user.email); assert.equal(changes[0].actorName, admin.user.name);
        assert.equal(changes[0].targetId, first.id); assert.equal((await store.one("ActivityRequest", { _id: requestId }))?.status, 200);
        const after = await store.collection("OperationSession").findOne({ _id: first.id as string }); assert.ok(after);
        assert.equal(after[field], expected);
        for (const key of Object.keys(before)) if (key !== field && key !== "updatedAt") assert.deepEqual(after[key], before[key]);
        const snapshot = await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray();
        const audits = await store.collection("ActivityChange").find({}).sort({ _id: 1 }).toArray();
        for (const body of ["null", "{}", "[]", ""]) assert.deepEqual(await (await run(() => post(route, body))).json(), { ok: true, updatedCount: 0 });
        assert.deepEqual(await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), snapshot);
        assert.deepEqual(await store.collection("ActivityChange").find({}).sort({ _id: 1 }).toArray(), audits);
        assert.deepEqual(await (await run(() => route.GET())).json(), { ok: true, targetCount: 0 });
      }
      for (const line of info) { assert.equal(line.length, 1); assert.match(String(line[0]), /^\[(onsite-required-backfill|om-assignment-status-backfill)\] updated=[01]$/); }
    });
    await suite.test("GET is not a reservation and failed request logging preserves successful correction", async () => {
      assert.deepEqual(await (await run(() => onsite.GET())).json(), { ok: true, targetCount: 0 });
      const later = await seed({});
      const errors: unknown[][] = [], errorLog = mock.method(console, "error", (...args: unknown[]) => { errors.push(args); });
      try {
        const response = await runWithDataRepositories({ ...scope, requestActivity: { recordRequest: async () => { throw new Error("Synthetic confidential logging failure"); } } }, () => actors.run(admin, () => post(onsite)));
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, updatedCount: 1 });
        assert.equal((await store.one("OperationSession", { _id: later.id as string }))?.onsiteRequired, "Y");
        assert.deepEqual(errors, [["[activity] API request log write failed"]]);
      } finally { errorLog.mock.restore(); }
    });
    const raw = JSON.stringify(await Promise.all(store.models.map(model => store.collection(model).find({}).toArray())));
    for (const marker of [admin.user.email, admin.user.name, "Synthetic private handler owner", "Synthetic private onsite text", "synthetic-deleter@example.invalid"]) assert.ok(!raw.includes(marker));
    assert.equal(pgCalls, 0); assert.equal(external.mock.callCount(), 0);
  } finally {
    if (connected) await client.db(options.databaseName).dropDatabase(); await client.close(); external.mock.restore(); logger.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
