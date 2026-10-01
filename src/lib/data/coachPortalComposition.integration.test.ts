/** Opt-in actual Mongo validation for the token-authenticated coach portal composition. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MONGO_COACH_PORTAL_RUNTIME_MODELS, prepareMongoCoachPortalRuntime } from "./mongoCoachPortalRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

mock.module("@/auth", { namedExports: { auth: async () => null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("PG_FORBIDDEN"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(["next/server", "next/navigation"].includes(specifier) ? `${specifier}.js` : specifier, context); } });
const me = await import("../../app/api/coach/me/route");
const schedule = await import("../../app/api/coach/schedule/[yearMonth]/route");
hooks.deregister();

const uri = process.env.MONGODB_COACH_PORTAL_COMPOSITION_TEST_URI;
const request = (path: string, method = "GET", token?: string, body?: unknown) => new Request(`https://synthetic.invalid${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function snapshot(client: MongoClient, databaseName: string) { const output: Record<string, unknown> = {}; for (const info of (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).sort((a,b) => a.name.localeCompare(b.name))) { const collection = client.db(databaseName).collection(info.name); output[info.name] = { info, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() }; } return output; }

test("coach portal APIs use one prepared Mongo composition", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const databaseName = `hub_om_shadow_coach_portal_comp_${randomBytes(6).toString("hex")}`, namespace = `shadow_coach_portal_${randomBytes(6).toString("hex")}`;
  const environment = { COACH_PORTAL_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", DEV_AUTH_BYPASS: "false" };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]])); Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoCoachPortalRuntime(options); const store = new MongoOperationStore(options, MONGO_COACH_PORTAL_RUNTIME_MODELS);
    const coach = coachFixtureRow("Coach", { name: "Synthetic private portal coach", normalizedName: "synthetic private portal coach", sourceCoachId: "synthetic:portal", status: "ACTIVE", isActive: true, accessToken: "synthetic-portal-token" });
    await store.collection("Coach").insertOne(encodeMongoRuntimeDocument("Coach", coach));
    const context = { params: Promise.resolve({ yearMonth: "2026-10" }) }, responses: Response[] = [];
    responses.push(await me.GET(request("/api/coach/me", "GET", "synthetic-portal-token"))); assert.equal(responses.at(-1)!.status, 200); assert.equal(responses.at(-1)!.headers.get("cache-control"), "private, no-store");
    responses.push(await schedule.GET(request("/api/coach/schedule/2026-10", "GET", "synthetic-portal-token"), context)); assert.equal(responses.at(-1)!.status, 200);
    const changed = await schedule.PUT(request("/api/coach/schedule/2026-10", "PUT", "synthetic-portal-token", { schedules: [{ date: "2026-10-07", startTime: "09:00", endTime: "12:00" }] }), context); responses.push(changed); assert.deepEqual(await changed.clone().json(), { ok: true, count: 1 });
    const month = await schedule.GET(request("/api/coach/schedule/2026-10", "GET", "synthetic-portal-token"), context); responses.push(month); assert.equal((await month.clone().json() as { schedules: unknown[] }).schedules.length, 1);
    const denied = await schedule.GET(request("/api/coach/schedule/2026-10"), context); responses.push(denied); assert.equal(denied.status, 401);
    for (const response of responses) { const id = response.headers.get("X-Request-Id"); assert.ok(id); const row = await store.one("ActivityRequest", { _id: id }); assert.equal(row?.status, response.status); assert.equal(row?.actorType, "token_request"); assert.equal(row?.actorEmail, null); }
    assert.equal(await store.collection("CoachSchedule").countDocuments(), 1); const changedRequestId = changed.headers.get("X-Request-Id"); assert.ok(changedRequestId); assert.ok(await store.one("ActivityChange", { requestId: changedRequestId }));
    const raw = JSON.stringify(await Promise.all(MONGO_COACH_PORTAL_RUNTIME_MODELS.map(model => store.collection(model).find({}).toArray()))); for (const marker of ["Synthetic private portal coach", "synthetic-portal-token", "synthetic:portal"]) assert.ok(!raw.includes(marker));
    assert.equal(pgCalls, 0);

    const partial = `shadow_coach_portal_partial_${randomBytes(6).toString("hex")}`; process.env.MONGODB_SHADOW_NAMESPACE = partial;
    const legacy = client.db(databaseName).collection(`${partial}_LegacyOnly`); await client.db(databaseName).createCollection(legacy.collectionName, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" }); await legacy.insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName); await assert.rejects(me.GET(request("/api/coach/me", "GET", "synthetic-portal-token")), /COACH_PORTAL_COMPOSITION_FAILED/); assert.deepEqual(await snapshot(client, databaseName), before); assert.equal(pgCalls, 0);
  } finally { try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
