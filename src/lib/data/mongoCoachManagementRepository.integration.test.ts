import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoCoachManagementRepository, prepareMongoCoachManagementStore, COACH_MANAGEMENT_MODELS } from "./mongoCoachManagementRepository";
import { MongoOperationStore } from "./mongoOperationStore";
import { activityContext } from "../activity/context";
import { runWithDataRepositories } from "./dataRepositoryContext";
let authorized = true;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("Unexpected PostgreSQL access in Mongo API request"); } } });
mock.module("../auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => { if (!authorized) throw new Error("synthetic unauthorized"); return { user: { email: "synthetic-manager@example.invalid", name: "Synthetic manager" } }; } } });
mock.module("../activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
const hook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const collectionRoute = await import("../../app/api/coaches/route"), detailRoute = await import("../../app/api/coaches/[id]/route");
hook.deregister();
const uri = process.env.MONGODB_COACH_WRITE_TEST_URI;

test("Coach management real HTTP handlers use native Mongo boundary, keep auth and HTTP DTOs, and never touch PG", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_coach_api_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName, namespace: `shadow_api_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"], saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  let connected = false;
  try {
    await client.connect(); connected = true; await prepareMongoCoachManagementStore(options);
    const repository = await MongoCoachManagementRepository.open(options), store = new MongoOperationStore(options, COACH_MANAGEMENT_MODELS);
    const request = (body: unknown = {}) => new Request("https://example.invalid/api/coaches", { method: "POST", body: JSON.stringify(body) });
    await runWithDataRepositories({ coachManagement: repository }, () => activityContext.run({ requestId: randomUUID(), route: "/api/coaches", method: "POST", actorType: "user", actorEmail: "synthetic-manager@example.invalid", actorName: "Synthetic manager" }, async () => {
      assert.equal((await collectionRoute.POST(request({ name: " " }))).status, 400);
      authorized = false; await assert.rejects(collectionRoute.POST(request({ name: "Denied" })), /synthetic unauthorized/); authorized = true;
      assert.equal(await store.collection("Coach").countDocuments(), 0);
      const created = await collectionRoute.POST(request({ name: "Synthetic API", email: "private-api@example.invalid", fields: ["Synthetic API field"], status: "pending" }));
      assert.equal(created.status, 201); const payload = await created.json(), id = payload.coach.id as string;
      assert.deepEqual(Object.keys(payload.coach).sort(), ["id", "name"]);
      const context = { params: Promise.resolve({ id }) };
      assert.equal((await collectionRoute.GET(new Request("https://example.invalid/api/coaches"))).status, 200);
      assert.equal((await (await collectionRoute.GET(new Request("https://example.invalid/api/coaches"))).json()).total, 0);
      const pending = await (await collectionRoute.GET(new Request("https://example.invalid/api/coaches?status=pending&search=API&field=Synthetic%20API%20field"))).json();
      assert.equal(pending.total, 1); assert.equal(pending.coaches[0].fields[0].name, "Synthetic API field");
      const detail = await (await detailRoute.GET(request(), context)).json();
      assert.equal(detail.coach.returnDate, null); assert.equal(detail.coach.engagementCount, 0); assert.equal(detail.coach.scheduleCount, 0);
      assert.ok(!JSON.stringify(detail).includes("private-api@example.invalid"));
      assert.equal((await detailRoute.PATCH(request({ status: "pending" }), context)).status, 400);
      const status = await (await detailRoute.PATCH(request({ status: "active" }), context)).json(); assert.deepEqual(status.coach, { id, status: "active", isActive: true });
      assert.equal((await detailRoute.PUT(request({ name: "Updated API", returnDate: "2100-01-02", fields: [], email: null }), context)).status, 200);
      const updated = await (await detailRoute.GET(request(), context)).json(); assert.equal(updated.coach.returnDate, "2100-01-02"); assert.deepEqual(updated.coach.fields, []);
      assert.equal((await store.one("CoachPrivateProfile", { _id: id }))?.email, null);
      const audit = await store.scan("ActivityChange");
      assert.ok(audit.some(row => row.targetType === "coaches" && row.action === "create"));
      assert.ok(audit.some(row => row.targetType === "coach_private_profiles" && row.targetId === id));
      assert.ok(audit.some(row => row.targetType === "coach_fields" && row.action === "delete"));
      assert.ok(!audit.some(row => row.targetType === "coach_content_entries"));
      assert.equal((await detailRoute.DELETE(request(), context)).status, 200);
      assert.equal((await detailRoute.GET(request(), context)).status, 404);
      assert.equal((await detailRoute.PUT(request({ name: "Must not restore" }), context)).status, 404);
      assert.equal((await detailRoute.DELETE(request(), context)).status, 404);
      assert.equal(await store.collection("CoachPrivateProfile").countDocuments({ _id: id }), 1);
    }));
  } finally {
    authorized = true;
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally { try { await client.close(); } finally { for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
