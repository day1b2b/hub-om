import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { registerHooks } from "node:module";
import { MongoServerError, type MongoClient } from "mongodb";
import * as readStore from "./mongoReadStore";
import { decodeMongoRuntimeDocument, type MongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoOperationError, type MongoRow } from "./mongoOperationStore";

mock.module("./mongoReadStore", { namedExports: { ...readStore, assertMongoReadStoreReady: async () => {} } });
const { MongoCoachWriteRepository, COACH_WRITE_MODELS } = await import("./mongoCoachWriteRepository");
const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
function fakeClient() {
  let records = new Map<string, MongoRuntimeDocument[]>();
  let failModel = "", duplicateMasterOnce = false, ended = 0, attempts = 0;
  const matches = (row: MongoRuntimeDocument, filter: MongoRow) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const modelOf = (name: string) => COACH_WRITE_MODELS.find(model => name.endsWith(`_${model}`))!;
  const collection = (collectionName: string) => {
    const model = modelOf(collectionName);
    return {
      findOne: async (filter: MongoRow) => records.get(model)?.find(row => matches(row, filter)) ?? null,
      insertOne: async (row: MongoRuntimeDocument) => {
        if (model === failModel) throw new Error("synthetic-private-value-should-not-escape");
        if (model === "CoachFieldMaster" && duplicateMasterOnce) { duplicateMasterOnce = false; throw new MongoServerError({ code: 11000, message: "synthetic collision" }); }
        const existing = records.get(model) ?? [];
        assert.ok(!existing.some(previous => previous._id === row._id));
        records.set(model, [...existing, row]);
      },
      replaceOne: async (filter: MongoRow, row: MongoRuntimeDocument) => {
        const current = records.get(model) ?? [], index = current.findIndex(value => matches(value, filter));
        if (index < 0) return { matchedCount: 0 };
        current[index] = row; return { matchedCount: 1 };
      },
      deleteMany: async (filter: MongoRow) => { records.set(model, (records.get(model) ?? []).filter(row => !matches(row, filter))); }
    };
  };
  const client = { db: () => ({ command: async () => ({ setName: "synthetic", logicalSessionTimeoutMinutes: 30 }), collection }), startSession: () => ({
    withTransaction: async (work: () => Promise<unknown>, options: unknown) => {
      attempts++;
      assert.deepEqual(options, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
      // Encoded documents are immutable between replacements, so array copies retain BSON types.
      const snapshot = new Map([...records].map(([key, rows]) => [key, [...rows]]));
      try { return await work(); } catch (error) { records = snapshot; throw error; }
    }, endSession: async () => { ended++; }
  }) } as unknown as MongoClient;
  return { client, rows: (model: string) => records.get(model) ?? [], plain: (model: string) => (records.get(model) ?? []).map(row => decodeMongoRuntimeDocument(model, row)), fail: (model: string) => { failModel = model; }, collide: () => { duplicateMasterOnce = true; }, counts: () => ({ ended, attempts }) };
}

// Exercise the actual existing route with mocked Prisma delegates, not a second copy of its parser.
let pgRows: Record<string, MongoRow[]> = {};
const savePg = (model: string, data: MongoRow) => { const row = { id: randomUUID(), isActive: true, deletedAt: null, ...data }; (pgRows[model] ??= []).push(row); return row; };
const delegates = {
  coach: { create: async ({ data }: { data: MongoRow }) => savePg("Coach", data), findUnique: async ({ where }: { where: MongoRow }) => pgRows.Coach?.find(row => row.id === where.id), update: async ({ where, data }: { where: MongoRow; data: MongoRow }) => { const row = pgRows.Coach.find(row => row.id === where.id)!; Object.assign(row, data); return { id: row.id, name: row.name, status: row.status, isActive: row.isActive }; } },
  coachPrivateProfile: { create: async ({ data }: { data: MongoRow }) => savePg("CoachPrivateProfile", data), upsert: async ({ where, create, update }: { where: MongoRow; create: MongoRow; update: MongoRow }) => { const row = pgRows.CoachPrivateProfile.find(row => row.coachId === where.coachId); return row ? Object.assign(row, update) : savePg("CoachPrivateProfile", create); } },
  coachFieldMaster: { upsert: async ({ create }: { create: MongoRow }) => pgRows.CoachFieldMaster?.find(row => row.name === create.name) ?? savePg("CoachFieldMaster", create) },
  coachCurriculumMaster: { upsert: async ({ create }: { create: MongoRow }) => pgRows.CoachCurriculumMaster?.find(row => row.name === create.name) ?? savePg("CoachCurriculumMaster", create) },
  coachField: { create: async ({ data }: { data: MongoRow }) => savePg("CoachField", data), deleteMany: async ({ where }: { where: MongoRow }) => { pgRows.CoachField = (pgRows.CoachField ?? []).filter(row => row.coachId !== where.coachId); } },
  coachCurriculum: { create: async ({ data }: { data: MongoRow }) => savePg("CoachCurriculum", data), deleteMany: async ({ where }: { where: MongoRow }) => { pgRows.CoachCurriculum = (pgRows.CoachCurriculum ?? []).filter(row => row.coachId !== where.coachId); } },
  coachContentEntry: { create: async ({ data }: { data: MongoRow }) => savePg("CoachContentEntry", data) }
};
mock.module("./prisma", { namedExports: { getPrismaClient: () => ({ ...delegates, $transaction: async (work: (tx: typeof delegates) => unknown) => work(delegates) }) } });
mock.module("../auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => ({ user: { name: "Synthetic manager", email: "manager@example.invalid" } }) } });
mock.module("../activity/request", { namedExports: { withActivity: (_route: string, _verb: string, handler: unknown) => handler } });
const nextHook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const createRoute = await import("../../app/api/coaches/route");
const editRoute = await import("../../app/api/coaches/[id]/route");
nextHook.deregister();
function request(body: unknown) { return new Request("https://example.invalid/api/coaches", { method: "POST", body: JSON.stringify(body) }); }

test("Mongo coach writes match existing POST/PUT/PATCH/DELETE contracts, preserve omissions and protect storage", async () => {
  const saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const fake = fakeClient(), options = { client: fake.client, databaseName: "hub_om_shadow_coach_writes", namespace: "shadow_unit", allowShadowWrites: true as const };
  pgRows = {};
  try {
    const repository = await MongoCoachWriteRepository.open(options);
    const body = { name: "  Synthetic   Coach  ", workType: "  remote ", status: "pending", phone: "010-0000-0000", email: "coach@example.invalid", birthDate: "2000-01-02", fields: ["Tag", " Tag ", "", null], curriculums: ["Curriculum"], employeeId: "ignored-on-create", isActive: false };
    const created = await repository.createCoach(body), pgResponse = await createRoute.POST(request(body));
    assert.equal(pgResponse.status, 201); const pg = pgRows.Coach[0], coachId = created.id;
    const context = { params: Promise.resolve({ id: pg.id as string }) };
    const compare = () => {
      const mongo = fake.plain("Coach")[0];
      for (const key of ["name", "normalizedName", "workType", "status", "isActive", "statusNote", "managerNote", "dxTag", "returnDate", "selfNote", "portfolioUrl", "availabilityDetail"]) assert.deepEqual(mongo[key] ?? null, pg[key] ?? null, key);
      const priv = fake.plain("CoachPrivateProfile")[0], pgPriv = pgRows.CoachPrivateProfile[0];
      for (const key of ["employeeId", "phone", "email", "birthDate", "affiliation"]) assert.deepEqual(priv[key] ?? null, pgPriv[key] ?? null, key);
      for (const key of ["CoachField", "CoachCurriculum"]) assert.equal(fake.rows(key).length, pgRows[key]?.length ?? 0);
    };
    compare(); assert.deepEqual(Object.keys(created).sort(), ["id", "name"]); assert.equal(created.name, "Synthetic   Coach");
    assert.match(fake.plain("Coach")[0].accessToken as string, /^[a-f0-9]{64}$/);
    assert.equal(fake.rows("CoachFieldMaster").length, 1); assert.equal(fake.rows("CoachField").length, 1);
    const author = { name: "Synthetic manager", email: "manager@example.invalid" };
    const patch = { name: "New Name", status: "invalid-default-active", phone: null, managerNote: "Synthetic private note", fields: [], dxTag: "DX", isActive: false };
    await repository.updateCoach(coachId, patch, author); assert.equal((await editRoute.PUT(request(patch), context)).status, 200); compare();
    const audit = fake.plain("CoachContentEntry")[0], pgAudit = pgRows.CoachContentEntry[0];
    for (const key of ["kind", "content", "sourceField", "authorEmail", "authorName"]) assert.equal(audit[key], pgAudit[key]);
    assert.equal(fake.plain("CoachPrivateProfile")[0].email, "coach@example.invalid");
    await repository.updateCoach(coachId, { affiliation: "Only private" }, author); await editRoute.PUT(request({ affiliation: "Only private" }), context); compare();
    assert.equal(fake.rows("CoachContentEntry").length, 1, "Match existing private-only audit policy");
    const result = await repository.updateCoachStatus(coachId, "inactive"); await editRoute.PATCH(request({ status: "inactive" }), context); compare();
    assert.deepEqual(result, { id: coachId, status: "inactive", isActive: false });
    await assert.rejects(repository.updateCoachStatus(coachId, "pending"), /INVALID_COACH_STATUS/);
    await assert.rejects(repository.updateCoach(coachId, { name: " " }, author), /COACH_NAME_REQUIRED/);
    assert.equal((await editRoute.PUT(request({ name: " " }), context)).status, 400);
    const raw = JSON.stringify([...COACH_WRITE_MODELS].flatMap(model => fake.rows(model)));
    for (const secret of ["New Name", "coach@example.invalid", "Synthetic private note", "manager@example.invalid", "Only private"]) assert.ok(!raw.includes(secret), secret);
    await repository.deleteCoach(coachId, author.email); await editRoute.DELETE(request({}), context);
    assert.ok(fake.plain("Coach")[0].deletedAt instanceof Date); assert.equal(fake.plain("Coach")[0].deletedBy, pg.deletedBy);
    assert.equal(fake.rows("CoachPrivateProfile").length, 1, "Soft delete retains related data");
    await assert.rejects(repository.updateCoach(coachId, {}, author), /COACH_NOT_FOUND/); await assert.rejects(repository.deleteCoach(coachId, null), /COACH_NOT_FOUND/);
    assert.equal(fake.counts().attempts, fake.counts().ended);
  } finally { for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});

test("Mongo coach transaction rolls back profile, private fields, tags and audit and retries duplicate tag races", async () => {
  const saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const fake = fakeClient(), options = { client: fake.client, databaseName: "hub_om_shadow_coach_writes", namespace: "shadow_unit", allowShadowWrites: true as const };
  try {
    await assert.rejects(MongoCoachWriteRepository.open({ ...options, allowShadowWrites: false as unknown as true }), /SHADOW_WRITE_GATE/);
    await assert.rejects(MongoCoachWriteRepository.open({ ...options, databaseName: "production" }), /SHADOW_DATABASE_REQUIRED/);
    const repository = await MongoCoachWriteRepository.open(options);
    fake.fail("CoachPrivateProfile"); await assert.rejects(repository.createCoach({ name: "Synthetic" }), /COACH_WRITE_FAILED/); assert.equal(fake.rows("Coach").length, 0);
    fake.fail(""); fake.collide(); const created = await repository.createCoach({ name: "Synthetic", fields: ["Shared"] });
    assert.equal(fake.rows("Coach").length, 1); assert.equal(fake.rows("CoachFieldMaster").length, 1); assert.equal(fake.counts().attempts, 3);
    const before = JSON.stringify(COACH_WRITE_MODELS.map(model => fake.rows(model)));
    fake.fail("CoachContentEntry"); await assert.rejects(repository.updateCoach(created.id, { name: "Must rollback", phone: "rollback", fields: ["new tag"] }, { email: "a@example.invalid", name: "Synthetic" }), error => error instanceof MongoOperationError && error.code === "COACH_WRITE_FAILED" && !error.message.includes("private-value"));
    assert.equal(JSON.stringify(COACH_WRITE_MODELS.map(model => fake.rows(model))), before);
    fake.fail(""); const current = fake.rows("Coach")[0]; current.name = "broken-envelope";
    await assert.rejects(repository.updateCoachStatus(created.id, "active"), /COACH_WRITE_FAILED/);
    assert.equal(fake.counts().ended, fake.counts().attempts);
  } finally { for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
