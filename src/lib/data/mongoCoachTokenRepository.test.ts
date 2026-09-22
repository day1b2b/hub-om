import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import type { MongoClient } from "mongodb";
import * as readStore from "./mongoReadStore";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, decodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { mongoCoachFixtures, coachFixtureRow } from "./mongoCoachFixtures";
import { runWithDataRepositories } from "./dataRepositoryContext";
const fixture = mongoCoachFixtures();
Object.assign(fixture.a, { availabilityDetail: "Must not use live fallback" });
Object.assign(fixture.b, { accessToken: "synthetic-inactive", status: "INACTIVE", isActive: false });
fixture.deleted.accessToken = "synthetic-deleted-token";
fixture.data.get("Coach")!.push(coachFixtureRow("Coach", { name: "Synthetic pending", normalizedName: "synthetic pending", status: "PENDING", isActive: false, accessToken: "synthetic-pending" }));
for (const row of fixture.data.get("CoachdbArchiveRow")!) row.rowData = { availability_detail: `Archive ${(row.rowData as MongoRow).status_note}`, private_extra: "must-not-leak@example.invalid" };
const rows = (model: string) => fixture.data.get(model) ?? [];
const matches = (row: MongoRow, where: MongoRow) => Object.entries(where).every(([key, value]) => value && typeof value === "object" && "$in" in value ? (value.$in as unknown[]).includes(row[key]) : row[key] === value);
const tags = (id: unknown, curriculum: boolean) => rows(curriculum ? "CoachCurriculum" : "CoachField").filter(row => row.coachId === id).map(link => ({ tag: rows(curriculum ? "CoachCurriculumMaster" : "CoachFieldMaster").find(row => row.id === link.tagId)! }));
let pgCalls = 0, failReady = false;
const pgClient = {
  coach: {
    findFirst: async ({ where }: { where: MongoRow }) => { const row = rows("Coach").find(row => matches(row, where)); return row ? Object.fromEntries(["id", "sourceCoachId", "name", "workType", "status", "accessToken"].map(key => [key, row[key]])) : null; },
    findUnique: async ({ where }: { where: MongoRow }) => rows("Coach").some(row => row.id === where.id) ? { fields: tags(where.id, false), curriculums: tags(where.id, true) } : null
  },
  coachdbArchiveRow: { findMany: async ({ where }: { where: MongoRow }) => rows("CoachdbArchiveRow").filter(row => matches(row, Object.fromEntries(Object.entries(where).filter(([key]) => key !== "snapshot")))).map(row => ({ ...row, snapshot: rows("CoachdbArchiveSnapshot").find(snapshot => snapshot.id === row.snapshotId)! })).filter(row => row.snapshot.status === "completed").sort((a, b) => (b.snapshot.startedAt as Date).getTime() - (a.snapshot.startedAt as Date).getTime()).slice(0, 1) }
};
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; return pgClient; } } });
mock.module("./mongoReadStore", { namedExports: { ...readStore, assertMongoReadStoreReady: async () => { if (failReady) throw new Error("synthetic-secret-token in driver error"); } } });
mock.module("../activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
const { MongoCoachTokenRepository } = await import("./mongoCoachTokenRepository");
const { PrismaCoachTokenRepository } = await import("./prismaCoachTokenRepository");
const { extractCoachToken, validateCoachToken } = await import("../coaches/coachTokenAuth");
const hook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const { GET } = await import("../../app/api/coach/me/route"); hook.deregister();
const request = (query = "", authorization?: string) => new Request(`https://example.invalid/api/coach/me${query}`, { headers: authorization ? { authorization } : {} });

test("Coach token extraction preserves query precedence, exact Bearer scheme and whitespace handling", () => {
  assert.equal(extractCoachToken(request("?token=%20query%20", "Bearer header")), "query");
  assert.equal(extractCoachToken(request("?token=%20", "Bearer header ")), "header");
  assert.equal(extractCoachToken(request("", "Bearer  header  ")), "header");
  assert.equal(extractCoachToken(request("", "bearer header")), null);
  assert.equal(extractCoachToken(request("", "Bearer ")), null);
  assert.equal(extractCoachToken(request()), null);
});

test("Mongo coach token lookup and own DTO match PG, use blind equality, preserve statuses and route failure isolation", async () => {
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"], saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const encoded = new Map([...fixture.data].map(([model, data]) => [model, data.map(row => encodeMongoRuntimeDocument(model, row))]));
  const queries: [string, MongoRow][] = [];
  const scan = mock.method(MongoOperationStore.prototype, "scan", async (model: string, filter: MongoRow = {}) => { queries.push([model, filter]); return (encoded.get(model) ?? []).filter(row => matches(row, filter)).map(row => decodeMongoRuntimeDocument(model, row)); });
  const client = { db: () => ({ command: async () => ({ setName: "synthetic", logicalSessionTimeoutMinutes: 30 }) }), startSession: () => ({ withTransaction: async (work: () => Promise<unknown>, options: unknown) => { assert.deepEqual(options, { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: 30_000 }); return work(); }, endSession: async () => {} }) } as unknown as MongoClient;
  const options = { client, databaseName: "hub_om_shadow_token_unit", namespace: "shadow_unit" };
  try {
    failReady = true; await assert.rejects(MongoCoachTokenRepository.open(options), error => error instanceof Error && error.message.includes("COACH_TOKEN_OPEN_FAILED") && !error.message.includes("synthetic-secret-token")); failReady = false;
    const mongo = await MongoCoachTokenRepository.open(options), pg = new PrismaCoachTokenRepository();
    for (const token of ["synthetic-token", "synthetic-inactive", "synthetic-pending", "synthetic-deleted-token", "SYNTHETIC-TOKEN", "missing", ""]) {
      assert.deepEqual(await mongo.findByToken(token), await pg.findByToken(token));
      assert.deepEqual(await mongo.getOwnProfile(token), await pg.getOwnProfile(token));
    }
    const profile = await mongo.getOwnProfile("synthetic-token"); assert.equal(profile?.availabilityDetail, "Archive latest");
    assert.equal((await mongo.getOwnProfile("synthetic-inactive"))?.availabilityDetail, null);
    assert.ok(queries.some(([model, filter]) => model === "Coach" && /^[a-f0-9]{64}$/.test(String(filter.accessTokenPiiIndex))));
    assert.ok(queries.some(([model, filter]) => model === "CoachdbArchiveRow" && /^[a-f0-9]{64}$/.test(String(filter.rowKeyPiiIndex))));
    assert.ok(!JSON.stringify(queries).includes("synthetic-token"));
    const previousCalls = pgCalls;
    await runWithDataRepositories({ coachToken: mongo }, async () => {
      assert.equal(await validateCoachToken(null), null); assert.equal((await validateCoachToken("synthetic-token"))?.id, fixture.a.id);
      const response = await GET(request("?token=synthetic-token")); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store"); const body = await response.json();
      assert.deepEqual(body.coach, profile);
      const json = JSON.stringify(body);
      for (const secret of ["synthetic-token", "accessToken", "sourceCoachId", "must-not-leak@example.invalid", "synthetic-profile@example.invalid"]) assert.ok(!json.includes(secret));
      for (const input of [request(), request("?token=missing", "Bearer synthetic-token"), request("?token=synthetic-deleted-token")]) { const denied = await GET(input); assert.equal(denied.status, 401); assert.equal(denied.headers.get("Cache-Control"), "private, no-store"); }
      assert.equal((await GET(request("", "Bearer synthetic-inactive"))).status, 200);
      assert.equal((await GET(request("?token=synthetic-pending"))).status, 200);
    });
    assert.equal(pgCalls, previousCalls);
    await assert.rejects(runWithDataRepositories({}, () => validateCoachToken("synthetic-token")), /DATA_REPOSITORY_NOT_CONFIGURED/);
    assert.equal(pgCalls, previousCalls);
    const document = encoded.get("Coach")!.find(row => row._id === fixture.a.id)!;
    document.accessToken = "broken-token-envelope";
    await assert.rejects(mongo.getOwnProfile("synthetic-token"), /COACH_TOKEN_READ_FAILED/);
    scan.mock.mockImplementation(async () => { throw new Error("synthetic-secret-token raw error"); });
    await assert.rejects(mongo.findByToken("synthetic-token"), error => error instanceof Error && error.message.includes("COACH_TOKEN_READ_FAILED") && !error.message.includes("synthetic-secret-token"));
  } finally { failReady = false; scan.mock.restore(); for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
