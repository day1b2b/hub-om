import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS, prepareMongoAdminMaintenanceRuntime } from "./mongoAdminMaintenanceRuntime";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_ADMIN_MAINTENANCE_COMPOSITION_TEST_URI;
const admin = { user: { email: "synthetic.maintenance.admin@day1company.co.kr", name: "Synthetic Admin" }, expires: "" };
let actor: typeof admin | null = admin;
let pgCalls = 0;
mock.module("@/auth", { namedExports: { auth: async () => actor } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("PG_FORBIDDEN"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(["next/server", "next/navigation"].includes(specifier) ? `${specifier}.js` : specifier, context); } });
const lookup = await import("../../app/api/admin/courses/lookup/route");
const course = await import("../../app/api/admin/courses/[courseId]/route");
const deleted = await import("../../app/api/admin/deleted-operations/route");
const onsite = await import("../../app/api/admin/onsite-required-backfill/route");
const om = await import("../../app/api/admin/om-assignment-status-backfill/route");
hooks.deregister();
const request = (path: string, method = "GET", body?: unknown) => new Request(`https://synthetic.invalid${path}`, {
  method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});
async function snapshot(client: MongoClient, databaseName: string) {
  const output: Record<string, unknown> = {};
  for (const info of (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = client.db(databaseName).collection(info.name);
    output[info.name] = { info, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return output;
}

test("admin maintenance APIs use prepared Mongo composition", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const databaseName = `hub_om_shadow_maintenance_comp_${randomBytes(6).toString("hex")}`;
  const namespace = `shadow_admin_maintenance_${randomBytes(6).toString("hex")}`;
  const environment = {
    ADMIN_MAINTENANCE_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email,
    DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", DEV_AUTH_BYPASS: "false",
  };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]])); Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoAdminMaintenanceRuntime(options);
    const store = new MongoOperationStore(options, MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS);
    const seed = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, { id: randomUUID(), ...values });
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row));
      return row;
    };
    const company = await seed("Company", { name: "Synthetic company", normalizedName: "synthetic company" });
    const courseRow = await seed("Course", { companyId: company.id, name: "Synthetic course", processSeq: 913 });
    const operation = await seed("OperationSession", { courseRecordId: courseRow.id, operationId: "synthetic-maintenance-composition", onsiteRequired: "N", operationStatus: "ASSIGNMENT_NEEDED", omName: "Synthetic owner" });

    const responses: Response[] = [];
    responses.push(await lookup.GET(request("/api/admin/courses/lookup?processId=PRC-000913")));
    assert.equal(responses.at(-1)?.status, 200);
    const courseDeleteResponse = await course.DELETE(request("/api/admin/courses/x", "DELETE"), { params: Promise.resolve({ courseId: String(courseRow.id) }) });
    responses.push(courseDeleteResponse);
    assert.deepEqual(await courseDeleteResponse.clone().json(), { ok: true, deletedCount: 1 });
    responses.push(await deleted.GET());
    assert.equal((await responses.at(-1)!.clone().json()).operations.length, 1);
    const restoreResponse = await deleted.PUT(request("/api/admin/deleted-operations", "PUT", { operationId: operation.operationId }));
    responses.push(restoreResponse); assert.equal(restoreResponse.status, 200);
    const onsiteCountResponse = await onsite.GET();
    responses.push(onsiteCountResponse); assert.deepEqual(await onsiteCountResponse.clone().json(), { ok: true, targetCount: 1 });
    const onsiteResponse = await onsite.POST();
    responses.push(onsiteResponse); assert.deepEqual(await onsiteResponse.clone().json(), { ok: true, updatedCount: 1 });
    const omCountResponse = await om.GET();
    responses.push(omCountResponse); assert.deepEqual(await omCountResponse.clone().json(), { ok: true, targetCount: 1 });
    const omResponse = await om.POST();
    responses.push(omResponse); assert.deepEqual(await omResponse.clone().json(), { ok: true, updatedCount: 1 });
    for (const response of responses) {
      const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
      assert.equal((await store.one("ActivityRequest", { _id: requestId }))?.status, response.status);
    }
    const restored = await store.one("OperationSession", { _id: String(operation.id) });
    assert.equal(restored?.deletedAt, null); assert.equal(restored?.onsiteRequired, "Y"); assert.equal(restored?.operationStatus, "ASSIGNMENT_PLANNED");
    const expectedChanges = [
      [courseDeleteResponse, "delete", { deleted_at: { redacted: true } }],
      [restoreResponse, "restore", { deleted_at: { redacted: true } }],
      [onsiteResponse, "update", { onsite_required: { before: "N", after: "Y" } }],
      [omResponse, "update", { operation_status: { before: "assignment_needed", after: "assignment_planned" } }],
    ] as const;
    for (const [response, action, changes] of expectedChanges) {
      const rows = await store.scan("ActivityChange", { requestId: response.headers.get("X-Request-Id")! });
      assert.equal(rows.length, 1); assert.equal(rows[0].targetId, operation.id); assert.equal(rows[0].action, action); assert.deepEqual(rows[0].changes, changes);
    }
    assert.equal(pgCalls, 0);

    actor = null;
    await assert.rejects(deleted.GET(), /^Error: ADMIN_MAINTENANCE_COMPOSITION_FAILED$/);
    actor = admin;
    const partial = `shadow_admin_maintenance_partial_${randomBytes(6).toString("hex")}`;
    process.env.MONGODB_SHADOW_NAMESPACE = partial;
    const legacy = client.db(databaseName).collection(`${partial}_LegacyOnly`);
    await client.db(databaseName).createCollection(legacy.collectionName, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    await legacy.insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName);
    await assert.rejects(deleted.GET(), /ADMIN_MAINTENANCE_COMPOSITION_FAILED/);
    assert.deepEqual(await snapshot(client, databaseName), before);
    assert.equal(pgCalls, 0);
  } finally {
    actor = admin;
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close();
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
