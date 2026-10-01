import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MONGO_COACH_OPERATIONS_RUNTIME_MODELS, prepareMongoCoachOperationsRuntime } from "./mongoCoachOperationsRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const actor = { user: { email: "coach-operations-review@day1company.co.kr", name: "Synthetic operations manager" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actor } });
mock.module("../auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => actor } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("COACH_OPERATIONS_PG_TRIPWIRE"); } } });
const hook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const scheduleRoute = await import("../../app/api/coaches/[id]/schedules/route");
const reservationRoute = await import("../../app/api/coaches/[id]/reservations/route");
const engagementRoute = await import("../../app/api/coaches/[id]/engagements/route");
const engagementItemRoute = await import("../../app/api/engagements/[id]/route");
hook.deregister();

const uri = process.env.MONGODB_COACH_OPERATIONS_COMPOSITION_TEST_URI;
const request = (path: string, method: string, body?: unknown) => new Request(`https://example.invalid${path}`, { method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
async function snapshot(client: MongoClient, databaseName: string, prefix: string) {
  const output: Record<string, unknown> = {};
  for (const info of (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).filter(item => item.name.startsWith(prefix)).sort((a,b)=>a.name.localeCompare(b.name))) {
    const collection = client.db(databaseName).collection(info.name);
    output[info.name] = { info, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return output;
}

test("coach operation routes use one selected Mongo scope with real request audit", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.protocol, "mongodb:"); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_co_${randomBytes(8).toString("hex")}`;
  const namespace = `shadow_${randomBytes(8).toString("hex")}`;
  const names = ["DATABASE_URL", "COACH_OPERATIONS_BACKEND", "MONGODB_URI", "MONGODB_SHADOW_DATABASE", "MONGODB_SHADOW_NAMESPACE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  let connected = false;
  try {
    delete process.env.DATABASE_URL;
    Object.assign(process.env, { COACH_OPERATIONS_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace,
      PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
      PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
    await client.connect(); connected = true;
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoCoachOperationsRuntime(options);
    const store = new MongoOperationStore(options, MONGO_COACH_OPERATIONS_RUNTIME_MODELS);
    const coach = coachFixtureRow("Coach", { name: "Synthetic operations coach", normalizedName: "synthetic operations coach", status: "ACTIVE", isActive: true });
    await store.collection("Coach").insertOne(encodeMongoRuntimeDocument("Coach", coach));
    const coachId = coach.id as string, coachContext = context(coachId), reservationDate = "2099-12-08";

    assert.equal((await scheduleRoute.GET(request(`/api/coaches/${coachId}/schedules?yearMonth=2099-12`, "GET"), coachContext)).status, 200);
    assert.equal((await reservationRoute.POST(request(`/api/coaches/${coachId}/reservations`, "POST", { dates: [reservationDate] }), coachContext)).status, 200);
    const created = await engagementRoute.POST(request(`/api/coaches/${coachId}/engagements`, "POST", {
      courseName: "Synthetic private course", startDate: "2099-12-10", endDate: "2099-12-14", rating: null
    }), coachContext);
    assert.equal(created.status, 201); const engagementId = (await created.json()).engagement.id as string;
    assert.equal((await engagementRoute.GET(request(`/api/coaches/${coachId}/engagements`, "GET"), coachContext)).status, 200);
    assert.equal((await engagementItemRoute.PUT(request(`/api/engagements/${engagementId}`, "PUT", { status: "in_progress" }), context(engagementId))).status, 200);
    assert.equal((await reservationRoute.DELETE(request(`/api/coaches/${coachId}/reservations`, "DELETE", { dates: [reservationDate] }), coachContext)).status, 200);

    const audits = await store.scan("ActivityRequest"); assert.equal(audits.length, 6);
    assert.deepEqual(audits.map(row => `${row.route}|${row.method}|${row.status}`).sort(), [
      ["/api/coaches/[id]/schedules", "GET", 200], ["/api/coaches/[id]/reservations", "POST", 200],
      ["/api/coaches/[id]/engagements", "POST", 201], ["/api/coaches/[id]/engagements", "GET", 200],
      ["/api/engagements/[id]", "PUT", 200], ["/api/coaches/[id]/reservations", "DELETE", 200]
    ].map(row => row.join("|")).sort());
    const raw = JSON.stringify(await Promise.all(MONGO_COACH_OPERATIONS_RUNTIME_MODELS.map(model => store.collection(model).find({}).toArray())));
    for (const privateValue of [actor.user.email, actor.user.name, "Synthetic operations coach"]) assert.equal(raw.includes(privateValue), false);

    const partial = `shadow_partial_${randomBytes(6).toString("hex")}`, prefix = `${partial}_`;
    await client.db(databaseName).createCollection(`${partial}_LegacyOnly`, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    await client.db(databaseName).collection(`${partial}_LegacyOnly`).createIndex({ marker: 1 }, { unique: true, name: "marker_unique" });
    await client.db(databaseName).collection(`${partial}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName, prefix); process.env.MONGODB_SHADOW_NAMESPACE = partial;
    await assert.rejects(scheduleRoute.GET(request(`/api/coaches/${coachId}/schedules?yearMonth=2099-12`, "GET"), coachContext), /COACH_OPERATIONS_COMPOSITION_FAILED/);
    assert.deepEqual(await snapshot(client, databaseName, prefix), before);
  } finally {
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally { try { await client.close(); } finally { for (const name of names) { const value=saved.get(name); if(value===undefined) delete process.env[name]; else process.env[name]=value; } } }
  }
});
