import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoCoachTokenRepository, COACH_TOKEN_MODELS, prepareMongoCoachTokenStore } from "./mongoCoachTokenRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { mongoCoachFixtures, coachFixtureRow } from "./mongoCoachFixtures";
import { runWithDataRepositories } from "./dataRepositoryContext";
mock.module("@/auth", { namedExports: { auth: async () => { throw new Error("Token routes must not consume workspace auth"); } } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("Unexpected PostgreSQL access"); } } });
const hook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const { GET } = await import("../../app/api/coach/me/route"); hook.deregister();
const { validateCoachToken } = await import("../coaches/coachTokenAuth");
const uri = process.env.MONGODB_COACH_ACCESS_TEST_URI;

test("Coach token native: blind-index auth, own archive DTO, real handler/request audit, revocation and read isolation", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const databaseName = `hub_om_shadow_coach_token_${randomBytes(8).toString("hex")}`, options = { client, databaseName, namespace: `shadow_access_${randomBytes(8).toString("hex")}` };
  let connected = false, monitoring = false; const commands: { command: string; body: Record<string, unknown> }[] = [];
  client.on("commandStarted", event => { if (monitoring) commands.push({ command: event.commandName, body: event.command }); });
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"], saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  try {
    await client.connect(); connected = true;
    await assert.rejects(MongoCoachTokenRepository.open(options), /VALIDATOR_NOT_READY/);
    await prepareMongoCoachTokenStore({ ...options, allowShadowWrites: true });
    await prepareMongoRequestAuditStore({ ...options, allowShadowWrites: true });
    const store = new MongoOperationStore(options, COACH_TOKEN_MODELS), auditStore = new MongoOperationStore(options, REQUEST_AUDIT_MODELS), fixture = mongoCoachFixtures();
    Object.assign(fixture.a, { availabilityDetail: "Must not use live fallback" });
    Object.assign(fixture.b, { accessToken: "synthetic-inactive", status: "INACTIVE", isActive: false });
    fixture.deleted.accessToken = "synthetic-deleted-token";
    fixture.data.get("Coach")!.push(coachFixtureRow("Coach", { name: "Synthetic pending", normalizedName: "synthetic pending", status: "PENDING", isActive: false, accessToken: "synthetic-pending" }));
    for (const row of fixture.data.get("CoachdbArchiveRow")!) row.rowData = { availability_detail: `Archive ${(row.rowData as Record<string, unknown>).status_note}`, private_extra: "archive-private@example.invalid" };
    for (const model of COACH_TOKEN_MODELS) { const rows = fixture.data.get(model) ?? []; if (rows.length) await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row))); }
    monitoring = true;
    const repository = await MongoCoachTokenRepository.open(options);
    assert.equal((await repository.findByToken("synthetic-token"))?.id, fixture.a.id);
    const own = await repository.getOwnProfile("synthetic-token"); assert.equal(own?.availabilityDetail, "Archive latest"); assert.equal(own?.fields[0].name, "Synthetic field"); assert.equal(own?.curriculums[0].name, "Synthetic curriculum");
    assert.equal((await repository.getOwnProfile("synthetic-inactive"))?.status, "inactive"); assert.equal((await repository.getOwnProfile("synthetic-pending"))?.status, "pending");
    assert.equal(await repository.findByToken("SYNTHETIC-TOKEN"), null); assert.equal(await repository.findByToken("synthetic-deleted-token"), null); assert.equal(await repository.getOwnProfile("missing"), null);
    monitoring = false;
    assert.ok(commands.some(event => event.command === "find" && event.body.filter && "accessTokenPiiIndex" in (event.body.filter as object)));
    assert.ok(!commands.some(event => ["insert", "update", "delete", "create", "collMod", "createIndexes", "findAndModify"].includes(event.command)));
    assert.ok(!JSON.stringify(commands).includes("synthetic-token"), "Mongo predicates must not carry the raw token");
    const audit = await MongoRequestAuditRepository.open({ ...options, allowShadowWrites: true });
    const request = (token: string) => new Request(`https://example.invalid/api/coach/me?token=${token}`);
    await runWithDataRepositories({ coachToken: repository, requestActivity: audit }, async () => {
      assert.equal((await validateCoachToken("synthetic-token"))?.id, fixture.a.id);
      const response = await GET(request("synthetic-token")); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.ok(response.headers.get("X-Request-Id"));
      const payload = await response.json(); assert.deepEqual(payload, { ok: true, coach: own });
      for (const forbidden of ["accessToken", "synthetic-token", "sourceCoachId", "archive-private@example.invalid"]) assert.ok(!JSON.stringify(payload).includes(forbidden));
      const denied = await GET(request("synthetic-deleted-token")); assert.equal(denied.status, 401); assert.equal(denied.headers.get("Cache-Control"), "private, no-store"); assert.equal((await GET(request("unknown"))).status, 401);
      assert.equal((await GET(new Request("https://example.invalid/api/coach/me?token=unknown", { headers: { authorization: "Bearer synthetic-token" } }))).status, 401);
      assert.equal((await GET(new Request("https://example.invalid/api/coach/me", { headers: { authorization: "Bearer synthetic-inactive" } }))).status, 200);
    });
    const logs = await auditStore.scan("ActivityRequest"); assert.deepEqual(logs.map(row => row.status).sort(), [200, 200, 401, 401, 401]); assert.ok(logs.every(row => row.actorType === "token_request")); assert.ok(!JSON.stringify(logs).includes("synthetic-token"));
    const secondOptions = { ...options, namespace: `shadow_other_${randomBytes(8).toString("hex")}` }; await prepareMongoCoachTokenStore({ ...secondOptions, allowShadowWrites: true });
    assert.equal(await (await MongoCoachTokenRepository.open(secondOptions)).findByToken("synthetic-token"), null);
    // Simulate a completed rotation with the actual encrypted row; the separate rotation
    // repository suite tests its write authorization/atomicity against this lookup.
    await store.collection("Coach").replaceOne({ _id: fixture.a.id as string }, encodeMongoRuntimeDocument("Coach", { ...fixture.a, accessToken: "synthetic-rotated" }));
    assert.equal(await repository.findByToken("synthetic-token"), null); assert.equal((await repository.getOwnProfile("synthetic-rotated"))?.id, fixture.a.id);
    const original = await store.collection("Coach").findOne({ _id: fixture.a.id as string }); assert.ok(original);
    const parts = (original.accessToken as string).split(":"); parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
    await store.collection("Coach").updateOne({ _id: fixture.a.id as string }, { $set: { accessToken: parts.join(":") } });
    await assert.rejects(repository.getOwnProfile("synthetic-rotated"), /COACH_TOKEN_READ_FAILED/);
    await store.collection("Coach").replaceOne({ _id: fixture.a.id as string }, original);
    await store.collection("Coach").replaceOne({ _id: fixture.a.id as string }, encodeMongoRuntimeDocument("Coach", { ...fixture.a, accessToken: "synthetic-rotated", deletedAt: new Date() }));
    assert.equal(await repository.getOwnProfile("synthetic-rotated"), null);
  } finally {
    monitoring = false;
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally { try { await client.close(); } finally { for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
