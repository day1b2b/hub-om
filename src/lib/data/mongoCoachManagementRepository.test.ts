import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import type { MongoClient } from "mongodb";
import * as readStore from "./mongoReadStore";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, decodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { mongoCoachFixtures, coachFixtureRow } from "./mongoCoachFixtures";
import { MongoCoachWriteRepository } from "./mongoCoachWriteRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";
const fixture = mongoCoachFixtures();
fixture.data.get("Coach")!.push(coachFixtureRow("Coach", { name: "Synthetic pending", normalizedName: "synthetic pending", status: "PENDING", isActive: true }));
let authorized = true, pgCalls = 0, failReadiness = false;
const rows = (model: string) => fixture.data.get(model) ?? [];
const equals = (row: MongoRow, filter: MongoRow = {}): boolean => Object.entries(filter).every(([key, value]) => {
  const actual = key === "_id" ? row.id ?? row.coachId : row[key];
  if (value && typeof value === "object") {
    const op = value as MongoRow;
    if ("$in" in op) return (op.$in as unknown[]).includes(actual);
    if ("not" in op) return actual !== op.not;
  }
  return actual === value;
});
const tags = (id: unknown, curriculum: boolean) => rows(curriculum ? "CoachCurriculum" : "CoachField").filter(row => row.coachId === id).map(link => ({ tag: rows(curriculum ? "CoachCurriculumMaster" : "CoachFieldMaster").find(tag => tag.id === link.tagId)! }));
function selected(where: MongoRow = {}) {
  return rows("Coach").filter(row => equals(row, Object.fromEntries(Object.entries(where).filter(([key]) => key !== "OR" && key !== "fields"))))
    .filter(row => !where.OR || (where.OR as MongoRow[]).some(rule => Object.entries(rule).some(([key, term]) => String(row[key] ?? "").toLowerCase().includes(String((term as MongoRow).contains).toLowerCase()))))
    .filter(row => !where.fields || tags(row.id, false).some(item => item.tag.name === (((where.fields as MongoRow).some as MongoRow).tag as MongoRow).name))
    .sort((a, b) => ["PENDING", "ACTIVE", "INACTIVE"].indexOf(a.status as string) - ["PENDING", "ACTIVE", "INACTIVE"].indexOf(b.status as string) || String(a.normalizedName).localeCompare(String(b.normalizedName), "ko"));
}
function hydrate(row: MongoRow) {
  const engagements = rows("CoachEngagement").filter(item => item.coachId === row.id).sort((a, b) => (b.endDate as Date).getTime() - (a.endDate as Date).getTime());
  return { ...row, fields: tags(row.id, false), curriculums: tags(row.id, true), engagements: engagements.slice(0, 1), _count: { engagements: engagements.length, schedules: rows("CoachSchedule").filter(item => item.coachId === row.id).length } };
}
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; return { coach: {
  findMany: async ({ where, skip, take }: { where: MongoRow; skip: number; take: number }) => selected(where).slice(skip, skip + take).map(hydrate),
  count: async ({ where }: { where: MongoRow }) => selected(where).length,
  findFirst: async ({ where }: { where: MongoRow }) => { const row = selected(where)[0]; return row ? hydrate(row) : null; }
} }; } } });
mock.module("./mongoReadStore", { namedExports: { ...readStore, assertMongoReadStoreReady: async () => { if (failReadiness) throw new Error("secret-address@example.invalid in driver details"); } } });
mock.module("../auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => { if (!authorized) throw new Error("synthetic unauthorized"); return { user: { email: "actor@example.invalid", name: "Synthetic actor" } }; } } });
mock.module("../activity/request", { namedExports: { withActivity: (_route: string, _verb: string, handler: unknown) => handler } });
const { MongoCoachManagementRepository } = await import("./mongoCoachManagementRepository");
const { PrismaCoachManagementRepository } = await import("./prismaCoachManagementRepository");
const hook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const collectionRoute = await import("../../app/api/coaches/route"), detailRoute = await import("../../app/api/coaches/[id]/route");
hook.deregister();

test("Coach management API Mongo override matches Prisma GET DTO/filter/page contract and never falls back", async () => {
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const encoded = new Map([...fixture.data].map(([model, data]) => [model, data.map(row => encodeMongoRuntimeDocument(model, row))]));
  const decoded = (model: string) => (encoded.get(model) ?? []).map(row => decodeMongoRuntimeDocument(model, row));
  const patches = [mock.method(MongoOperationStore.prototype, "scan", async (model: string, filter: MongoRow = {}) => decoded(model).filter(row => equals(row, filter))), mock.method(MongoOperationStore.prototype, "one", async (model: string, filter: MongoRow) => decoded(model).find(row => equals(row, filter)) ?? null)];
  const writes: unknown[] = [];
  const fakeWrites = { createCoach: async (body: unknown) => { writes.push(body); return { id: "synthetic-id", name: "Created" }; }, updateCoach: async (id: string, body: unknown, author: unknown) => { writes.push([id, body, author]); return { id, name: "Updated" }; }, updateCoachStatus: async (id: string, value: unknown) => { writes.push([id, value]); return { id, status: "inactive", isActive: true }; }, deleteCoach: async (id: string, by: unknown) => { writes.push([id, by]); } } as unknown as MongoCoachWriteRepository;
  const openPatch = mock.method(MongoCoachWriteRepository, "open", async () => fakeWrites);
  const client = { db: () => ({}), startSession: () => ({ withTransaction: async (work: () => Promise<unknown>) => work(), endSession: async () => {} }) } as unknown as MongoClient;
  try {
    failReadiness = true;
    await assert.rejects(MongoCoachManagementRepository.open({ client, databaseName: "hub_om_shadow_management_mock", namespace: "shadow_management", allowShadowWrites: true }), error => error instanceof Error && error.message.includes("COACH_MANAGEMENT_OPEN_FAILED") && !error.message.includes("secret-address"));
    failReadiness = false;
    const mongo = await MongoCoachManagementRepository.open({ client, databaseName: "hub_om_shadow_management_mock", namespace: "shadow_management", allowShadowWrites: true });
    const pg = new PrismaCoachManagementRepository();
    for (const query of [{ page: 1, limit: 100 }, { page: 1, limit: 1 }, { page: 2, limit: 1 }, { page: 50, limit: 1 }, { page: 1, limit: 100, search: "가상" }, { page: 1, limit: 100, field: "Synthetic field" }, { page: 1, limit: 100, field: "missing" }, { page: 1, limit: 100, status: "pending" }, { page: 1, limit: 100, status: "inactive" }, { page: 1, limit: 100, status: "invalid" }]) assert.deepEqual(await mongo.listCoaches(query), await pg.listCoaches(query));
    const id = fixture.a.id as string;
    for (const coachId of [id, fixture.deleted.id as string, "missing"]) assert.deepEqual(await mongo.getCoach(coachId), await pg.getCoach(coachId));
    assert.equal((await mongo.getCoach(id))?.statusNote, null, "Management does not apply archive fallback");
    const callsBefore = pgCalls;
    await runWithDataRepositories({ coachManagement: mongo }, async () => {
      const list = await collectionRoute.GET(new Request("https://example.invalid/api/coaches?field=Synthetic%20field&limit=1"));
      assert.equal(list.status, 200); assert.equal((await list.json()).total, 1);
      const context = { params: Promise.resolve({ id }) }, request = () => new Request("https://example.invalid/api/coaches", { method: "POST", body: JSON.stringify({ name: "Body" }) });
      const detail = await detailRoute.GET(request(), context); assert.equal(detail.status, 200); const payload = await detail.json();
      assert.equal(payload.coach.id, id); assert.equal(payload.coach.returnDate, null); assert.ok(!JSON.stringify(payload).includes("synthetic-profile@example.invalid"));
      assert.equal((await collectionRoute.POST(request())).status, 201);
      assert.equal((await detailRoute.PUT(request(), context)).status, 200);
      assert.equal((await detailRoute.PATCH(request(), context)).status, 200);
      assert.equal((await detailRoute.DELETE(request(), context)).status, 200);
      assert.equal(writes.length, 4); assert.deepEqual((writes[1] as unknown[])[2], { email: "actor@example.invalid", name: "Synthetic actor" });
      assert.equal((await detailRoute.GET(request(), { params: Promise.resolve({ id: "missing" }) })).status, 404);
      authorized = false;
      for (const invoke of [() => collectionRoute.GET(request()), () => collectionRoute.POST(request()), () => detailRoute.GET(request(), context), () => detailRoute.PUT(request(), context), () => detailRoute.PATCH(request(), context), () => detailRoute.DELETE(request(), context)]) await assert.rejects(invoke(), /synthetic unauthorized/);
      assert.equal(writes.length, 4); authorized = true;
    });
    assert.equal(pgCalls, callsBefore, "Mongo request must not access Prisma");
    await assert.rejects(runWithDataRepositories({}, () => collectionRoute.GET(new Request("https://example.invalid/api/coaches"))));
    assert.equal(pgCalls, callsBefore, "Missing scoped adapter must never silently fall back");
  } finally { failReadiness = false; authorized = true; openPatch.mock.restore(); for (const patch of patches) patch.mock.restore(); for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
