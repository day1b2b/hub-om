import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoOperationStore } from "./mongoOperationStore";
import { MONGO_COACH_MANAGEMENT_RUNTIME_MODELS, prepareMongoCoachManagementRuntime } from "./mongoCoachManagementRuntime";

const actor = { user: { email: "coach-management-review@day1company.co.kr", name: "Synthetic manager" }, expires: "" };
let authFailure: Error | undefined;
mock.module("@/auth", { namedExports: { auth: async () => actor } });
mock.module("../auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => { if (authFailure) throw authFailure; return actor; } } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("COACH_MANAGEMENT_PG_TRIPWIRE"); } } });
const hook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const collectionRoute = await import("../../app/api/coaches/route");
const detailRoute = await import("../../app/api/coaches/[id]/route");
hook.deregister();

const uri = process.env.MONGODB_COACH_MANAGEMENT_COMPOSITION_TEST_URI;
test("coach management routes use one selected Mongo scope with real request audit", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_cm_${randomBytes(8).toString("hex")}`;
  const namespace = `shadow_${randomBytes(8).toString("hex")}`;
  const names = ["DATABASE_URL", "COACH_MANAGEMENT_BACKEND", "MONGODB_URI", "MONGODB_SHADOW_DATABASE", "MONGODB_SHADOW_NAMESPACE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  let connected = false;
  try {
    delete process.env.DATABASE_URL;
    Object.assign(process.env, { COACH_MANAGEMENT_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace,
      PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
      PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
    await client.connect(); connected = true;
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoCoachManagementRuntime(options);
    const request = (path: string, method: string, body?: unknown) => new Request(`https://example.invalid${path}`, { method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
    const created = await collectionRoute.POST(request("/api/coaches", "POST", { name: "Synthetic composed", email: "private-composed@example.invalid", status: "pending" }));
    assert.equal(created.status, 201); const id = (await created.json()).coach.id as string, context = { params: Promise.resolve({ id }) };
    assert.equal((await collectionRoute.GET(request("/api/coaches?status=pending", "GET"))).status, 200);
    assert.equal((await detailRoute.GET(request(`/api/coaches/${id}`, "GET"), context)).status, 200);
    assert.equal((await detailRoute.PATCH(request(`/api/coaches/${id}`, "PATCH", { status: "active" }), context)).status, 200);
    assert.equal((await detailRoute.PUT(request(`/api/coaches/${id}`, "PUT", { name: "Synthetic composed updated" }), context)).status, 200);
    assert.equal((await detailRoute.DELETE(request(`/api/coaches/${id}`, "DELETE"), context)).status, 200);

    const store = new MongoOperationStore(options, MONGO_COACH_MANAGEMENT_RUNTIME_MODELS);
    const audits = await store.scan("ActivityRequest");
    assert.equal(audits.length, 6);
    const auditKeys = audits.map(row => `${row.route}|${row.method}|${row.status}`).sort();
    assert.deepEqual(auditKeys, [
      ["/api/coaches", "POST", 201], ["/api/coaches", "GET", 200], ["/api/coaches/[id]", "GET", 200],
      ["/api/coaches/[id]", "PATCH", 200], ["/api/coaches/[id]", "PUT", 200], ["/api/coaches/[id]", "DELETE", 200]
    ].map(row => row.join("|")).sort());
    const raw = JSON.stringify(await store.collection("ActivityRequest").find({}).toArray());
    for (const privateValue of [actor.user.email, actor.user.name, "private-composed@example.invalid"]) assert.equal(raw.includes(privateValue), false);

    const redirect = Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT;replace;/sign-in;307;" });
    authFailure = redirect;
    await assert.rejects(collectionRoute.GET(request("/api/coaches", "GET")), error => error === redirect);
    authFailure = undefined;
    assert.equal(await store.collection("ActivityRequest").countDocuments(), 7);
  } finally {
    authFailure = undefined;
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally { try { await client.close(); } finally { for (const name of names) { const value=saved.get(name); if(value===undefined) delete process.env[name]; else process.env[name]=value; } } }
  }
});
