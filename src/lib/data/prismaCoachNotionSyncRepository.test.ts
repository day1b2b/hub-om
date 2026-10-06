/** Mock-only PostgreSQL contract checks; no real lock/server behavior is claimed. */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { CoachNotionSyncRepository } from "./coachNotionSyncRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";
let client: unknown;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { assert.ok(client, "Unexpected production client access"); return client; } } });
const { PrismaCoachNotionSyncRepository } = await import("./prismaCoachNotionSyncRepository");
const { getCoachNotionSyncRepository } = await import("./coachNotionSyncRepositoryFactory");
const { readNotionCoachPages, syncNotionCoaches } = await import("../coaches/notionCoachSync");
const id = "aaaaaaaa-0000-4000-8000-000000000001";

test("Prisma matching includes deleted coaches and orders name candidates by oldest creation", async () => {
  const row = { id, name: "Synthetic", normalizedName: "synthetic", createdAt: new Date("2000-01-01"), deletedAt: new Date(), accessToken: "synthetic-private-token", employeeNo: null, notionNo: 1, notionPageId: null, workType: null, portfolioUrl: null, selfNote: null, availabilityDetail: null, privateProfile: null, fields: [{ tag: { name: "Synthetic tag" } }], curriculums: [] };
  client = { coach: {
    async findFirst(args: { where: unknown }) { assert.deepEqual(args.where, { notionNo: 1 }); return row; },
    async findMany(args: { where: unknown; orderBy: unknown }) { assert.deepEqual(args.where, { normalizedName: "synthetic" }); assert.deepEqual(args.orderBy, { createdAt: "asc" }); return [row]; }
  } };
  const repository = new PrismaCoachNotionSyncRepository();
  const found = await repository.findByNotionNo(1);
  assert.equal(found?.id, id); assert.equal(JSON.stringify(found).includes(row.accessToken), false);
  assert.deepEqual((await repository.listByNormalizedName("synthetic"))[0].fields, ["Synthetic tag"]);
});

test("Prisma row transaction takes catalog then coach locks; updates do not reactivate or rename", async () => {
  const events: string[] = [], keys: bigint[] = []; let profile: unknown;
  client = { async $transaction(work: (tx: unknown) => Promise<unknown>) {
    const tx = {
      async $queryRaw(sql: TemplateStringsArray, key: bigint) { assert.match(sql.join("?"), /pg_advisory_xact_lock\(\?::bigint\)/); keys.push(key); events.push("lock"); },
      coach: { async update(args: { data: unknown }) { assert.equal(keys.length, 2); assert.deepEqual(args.data, { workType: "Synthetic" }); events.push("update"); } },
      coachPrivateProfile: { async upsert(args: unknown) { profile = args; } }
    };
    try { const result = await work(tx); events.push("commit"); return result; }
    catch (error) { events.push("rollback"); throw error; }
  } };
  const repository = new PrismaCoachNotionSyncRepository();
  await repository.transaction(async tx => {
    assert.deepEqual(events, ["lock"]);
    await tx.lockCoaches([id.toUpperCase(), id]);
    await tx.patchCoach(id, { workType: "Synthetic" });
    await tx.upsertPrivateProfile(id, { employeeId: "create-only", phone: null, email: null, birthDate: null, affiliation: null }, { email: "synthetic@example.invalid" });
  });
  assert.equal(keys.length, 2); assert.notEqual(keys[0], keys[1]); assert.deepEqual(events, ["lock", "lock", "update", "commit"]);
  assert.deepEqual(profile, { where: { coachId: id }, create: { coachId: id, employeeId: "create-only", phone: null, email: null, birthDate: null, affiliation: null }, update: { email: "synthetic@example.invalid" } });
  await assert.rejects(repository.transaction(async () => { throw new Error("Synthetic failure"); }), /Synthetic failure/);
  assert.equal(events.at(-1), "rollback");
});

test("source pagination and errors are mocked; error responses are never surfaced", async () => {
  process.env.NOTION_TOKEN = "synthetic-token"; process.env.COACH_NOTION_DATABASE_ID = "synthetic-database";
  const fetchMock = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(request.start_cursor ? { results: [{ id: "second" }], has_more: false } : { results: [{ id: "first" }, null], has_more: true, next_cursor: "synthetic-cursor" }), { status: 200 });
  });
  try {
    assert.deepEqual(await readNotionCoachPages(), [{ id: "first" }, { id: "second" }]);
    fetchMock.mock.mockImplementation(async () => new Response("private token and customer response", { status: 403 }));
    await assert.rejects(readNotionCoachPages(), /^Error: COACH_NOTION_SOURCE_FAILED$/);
    fetchMock.mock.mockImplementation(async () => { throw new Error("private connection string"); });
    await assert.rejects(readNotionCoachPages(), /^Error: COACH_NOTION_SOURCE_FAILED$/);
  } finally { fetchMock.mock.restore(); delete process.env.NOTION_TOKEN; delete process.env.COACH_NOTION_DATABASE_ID; }
});

test("factory retains PG default; scoped source is explicit and missing services fail before fetch", async () => {
  assert.ok(getCoachNotionSyncRepository() instanceof PrismaCoachNotionSyncRepository);
  const repository: CoachNotionSyncRepository = { findByNotionNo: async () => null, listByNormalizedName: async () => [], transaction: async () => { throw new Error("Dry run wrote"); } };
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  try {
    const result = await runWithDataRepositories({ coachNotionSync: repository, coachNotionSource: { readPages: async () => [{ properties: { 이름: { type: "title", title: [{ plain_text: "Synthetic" }] } } }] } }, () => syncNotionCoaches(true));
    assert.equal(result.created, 1);
    await assert.rejects(runWithDataRepositories({}, () => syncNotionCoaches(true)), /DATA_REPOSITORY_NOT_CONFIGURED: coachNotionSync/);
    await assert.rejects(runWithDataRepositories({ coachNotionSync: repository }, () => syncNotionCoaches(true)), /DATA_REPOSITORY_NOT_CONFIGURED: coachNotionSource/);
    await assert.rejects(runWithDataRepositories({ coachNotionSync: repository, coachNotionSource: { readPages: async () => { throw new Error("synthetic-private-source-marker"); } } }, () => syncNotionCoaches(true)), /^Error: COACH_NOTION_SOURCE_FAILED$/);
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally { fetchMock.mock.restore(); }
});
