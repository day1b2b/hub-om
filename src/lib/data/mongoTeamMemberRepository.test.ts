import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { MongoClient } from "mongodb";
import { DEFAULT_RESOURCE_OWNER_ROSTER, DEFAULT_TEAM_MEMBER_ROLE_ROSTER } from "./defaultTeamMemberRoster";
import type { TeamMemberRepository } from "./teamMemberRepository";
import { MongoOperationError, type MongoRow } from "./mongoOperationStore";

type RosterConstructor = { open(options: unknown): Promise<TeamMemberRepository> };
function load(name: string, modules: Record<string, unknown>): Record<string, unknown> {
  const source = readFileSync(new URL(name, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", javascript)((name: string) => { assert.ok(Object.hasOwn(modules, name), "unexpected reference import"); return modules[name]; }, exports);
  return exports;
}
async function mocked(members: MongoRow[], users: MongoRow[], failure?: string, readinessFailure = false) {
  const reads: { model: string; filter: unknown }[] = [];
  let readiness = 0;
  const { MongoTeamMemberRepository } = load("./mongoTeamMemberRepository.ts", {
    "./defaultTeamMemberRoster": { DEFAULT_RESOURCE_OWNER_ROSTER, DEFAULT_TEAM_MEMBER_ROLE_ROSTER },
    "./mongoOperationStore": { MongoOperationError, MongoOperationStore: class {
      constructor(_options: unknown, models: string[]) { assert.deepEqual(models, ["Member", "TeamUser"]); }
      async scan(model: string, filter: unknown) {
        reads.push({ model, filter });
        if (failure) throw failure === "SCAN_LIMIT_EXCEEDED" ? new MongoOperationError(failure) : new Error(failure);
        return structuredClone(model === "Member" ? members.filter(row => row.isActive && row.role === null) : users.filter(row => row.role !== null));
      }
    } },
    "./mongoReadStore": { TEAM_READ_MODELS: ["Member", "TeamUser"], async assertMongoReadStoreReady() { readiness++; if (failure === "NOT_READY") throw new MongoOperationError(failure); if (readinessFailure) throw new Error(failure); } },
  });
  const repository = await (MongoTeamMemberRepository as RosterConstructor).open({});
  return { repository, reads, readiness };
}
function member(name: string, patch: MongoRow = {}): MongoRow { return { name, sourceTeam: "TEAM_1", displayOrder: null, role: null, isActive: true, ...patch }; }
function user(name: string, patch: MongoRow = {}): MongoRow { return { name, team: "1팀", role: "OM", ...patch }; }

// Executes the existing Prisma repository with explicit ordered delegate results, not a real PG server.
test("Mongo roster output matches existing Prisma repository reference for ordered/null/enum fixtures", async () => {
  const orderedMembers = [member("가상가", { displayOrder: 1 }), member("가상나", { displayOrder: 1 }), member("가상가"), member("중복", { sourceTeam: "TEAM_2", displayOrder: 0 }), member("중복", { sourceTeam: "TEAM_2", displayOrder: 1 }), member("미분류", { sourceTeam: "UNKNOWN" }), member("생략", { sourceTeam: null })];
  const orderedUsers = [user("가상가"), user("가상나"), user("다른팀", { team: "2팀" }), user("파트", { team: "AX 1파트" }), user("빈팀", { team: null }), user("LD가상", { role: "LD" })];
  const queries: unknown[] = [];
  const { PrismaTeamMemberRepository } = load("./prismaTeamMemberRepository.ts", {
    "./prisma": { getPrismaClient: () => ({ member: { async findMany(args: unknown) { queries.push(args); return structuredClone(orderedMembers); } }, teamUser: { async findMany(args: unknown) { queries.push(args); return structuredClone(orderedUsers); } } }) },
    "./defaultTeamMemberRoster": { DEFAULT_RESOURCE_OWNER_ROSTER, DEFAULT_TEAM_MEMBER_ROLE_ROSTER },
  });
  const reference = new (PrismaTeamMemberRepository as new () => TeamMemberRepository)();
  const mongo = await mocked([...orderedMembers].reverse().concat(member("비활성", { isActive: false }), member("별도역할", { role: "LD" })), [...orderedUsers].reverse().concat(user("역할없음", { role: null })));
  assert.deepEqual(await mongo.repository.listResourceOwners(), await reference.listResourceOwners());
  assert.deepEqual(await mongo.repository.listRoleRosters(), await reference.listRoleRosters());
  assert.deepEqual(mongo.reads, [{ model: "Member", filter: { isActive: true, role: null } }, { model: "TeamUser", filter: { role: { $ne: null } } }]);
  assert.equal(mongo.readiness, 1);
  assert.deepEqual(queries, [{ where: { isActive: true, role: null }, orderBy: [{ sourceTeam: "asc" }, { displayOrder: "asc" }, { name: "asc" }] }, { where: { role: { not: null } }, orderBy: [{ role: "asc" }, { team: "asc" }, { name: "asc" }] }]);
});

test("empty, null-team-only, LD-only and OM-only keep separate fallback semantics", async () => {
  const empty = (await mocked([], [])).repository;
  assert.deepEqual(await empty.listResourceOwners(), DEFAULT_RESOURCE_OWNER_ROSTER);
  assert.deepEqual(await empty.listRoleRosters(), DEFAULT_TEAM_MEMBER_ROLE_ROSTER);
  assert.deepEqual(await (await mocked([member("생략", { sourceTeam: null })], [])).repository.listResourceOwners(), {});
  assert.deepEqual(await (await mocked([], [user("가상LD", { role: "LD", team: "" })])).repository.listRoleRosters(), { ld: { 미분류: ["가상LD"] }, om: DEFAULT_TEAM_MEMBER_ROLE_ROSTER.om });
  assert.deepEqual(await (await mocked([], [user("가상OM")])).repository.listRoleRosters(), { ld: {}, om: { "1팀": ["가상OM"] } });
});

test("readiness, decryption and scan errors propagate without default data masking", async () => {
  await assert.rejects(mocked([], [], "NOT_READY"), /NOT_READY/);
  for (const failure of ["AUTHENTICATION_FAILED", "SCAN_LIMIT_EXCEEDED"]) {
    const { repository } = await mocked([], [], failure);
    await assert.rejects(repository.listResourceOwners(), new RegExp(failure === "SCAN_LIMIT_EXCEEDED" ? failure : "TEAM_READ_FAILED"));
    await assert.rejects(repository.listRoleRosters(), new RegExp(failure === "SCAN_LIMIT_EXCEEDED" ? failure : "TEAM_READ_FAILED"));
  }
});


test("raw driver errors are sanitized during open and both reads without fallback", async () => {
  const secret = "synthetic-secret-driver-error";
  const safe = (error: unknown) => error instanceof MongoOperationError && error.code === "TEAM_READ_FAILED" && !error.message.includes(secret) && error.cause === undefined;
  await assert.rejects(mocked([], [], secret, true), safe);
  const { repository } = await mocked([], [], secret);
  await assert.rejects(repository.listResourceOwners(), safe);
  await assert.rejects(repository.listRoleRosters(), safe);
});

const uri = process.env.MONGODB_RUNTIME_TEST_URI;
test("TeamMember reads on a disposable loopback replica set", { skip: !uri, timeout: 120_000 }, async suite => {
  const address = new URL(uri!);
  assert.equal(address.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(address.hostname));
  assert.equal(address.username, ""); assert.equal(address.password, "");
  assert.ok(address.pathname === "" || address.pathname === "/"); assert.ok(address.port);
  const { MongoTeamMemberRepository } = await import("./mongoTeamMemberRepository");
  const { MongoOperationStore, completeMongoRow } = await import("./mongoOperationStore");
  const { prepareMongoReadStore, TEAM_READ_MODELS } = await import("./mongoReadStore");
  const { encodeMongoRuntimeDocument } = await import("./mongoRuntimeCodec");
  const databaseName = `hub_om_shadow_team_test_${randomBytes(12).toString("hex")}`;
  const keys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const previous = keys.map(key => process.env[key]);
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ synthetic: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "synthetic", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_team_${randomBytes(8).toString("hex")}` };
    await prepareMongoReadStore({ ...options, allowShadowWrites: true }, TEAM_READ_MODELS);
    return { store: new MongoOperationStore(options, TEAM_READ_MODELS), repository: await MongoTeamMemberRepository.open(options) };
  }
  async function insert(store: InstanceType<typeof MongoOperationStore>, model: string, input: MongoRow) {
    const fields = model === "Member" ? { normalizedName: input.name, isActive: true, createdAt: new Date(), updatedAt: new Date() } : { email: "synthetic@example.invalid", slackId: "synthetic", createdAt: new Date() };
    const id = randomUUID();
    await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...fields, ...input, id })));
    return id;
  }
  try {
    await client.connect();
    await suite.test("unprepared namespace rejects; team-only setup does not require operation collections", async () => {
      await assert.rejects(MongoTeamMemberRepository.open({ client, databaseName, namespace: "shadow_missing" }), /NOT_READY/);
      const { store, repository } = await fixture();
      assert.deepEqual(await repository.listResourceOwners(), DEFAULT_RESOURCE_OWNER_ROSTER);
      assert.deepEqual(await repository.listRoleRosters(), DEFAULT_TEAM_MEMBER_ROLE_ROSTER);
      assert.equal((await store.db.listCollections({ name: `${store.namespace}_OperationSession` }, { nameOnly: true }).toArray()).length, 0);
    });
    await suite.test("encrypted fixtures preserve ordering, filters, defaults, null and duplicate semantics", async () => {
      const { store, repository } = await fixture();
      for (const row of [member("가상나", { displayOrder: 2 }), member("가상가", { displayOrder: 2 }), member("첫째", { displayOrder: 1 }), member("마지막"), member("둘째팀", { sourceTeam: "TEAM_2" }), member("분류없음", { sourceTeam: "UNKNOWN" }), member("생략", { sourceTeam: null }), member("비활성", { isActive: false }), member("역할별도", { role: "LD" })]) await insert(store, "Member", row);
      assert.deepEqual(await repository.listResourceOwners(), { "1팀": ["첫째", "가상가", "가상나", "마지막"], "2팀": ["둘째팀"], 미분류: ["분류없음"] });
      await insert(store, "TeamUser", user("LD가상", { role: "LD", team: "AX 1파트" }));
      assert.deepEqual(await repository.listRoleRosters(), { ld: { 미분류: ["LD가상"] }, om: DEFAULT_TEAM_MEMBER_ROLE_ROSTER.om });
      for (const row of [user("가상나"), user("가상가"), user("가상가"), user("미분류", { team: null }), user("무역할", { role: null })]) await insert(store, "TeamUser", row);
      assert.deepEqual(await repository.listRoleRosters(), { ld: { 미분류: ["LD가상"] }, om: { "1팀": ["가상가", "가상가", "가상나"], 미분류: ["미분류"] } });
      const raw = await store.collection("Member").findOne({}); assert.ok(raw);
      assert.match(String(raw.name), /^pii:v1:/); assert.match(String(raw.namePiiIndex), /^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(raw).includes("가상"), false);
      // Valid-shaped but incorrect HMAC must fail authentication, never return the fallback roster.
      await store.collection("Member").updateOne({ _id: raw._id }, { $set: { namePiiIndex: "0".repeat(64) } });
      await assert.rejects(repository.listResourceOwners());
    });
    await suite.test("actual role-free rows with null source team return empty object, not defaults", async () => {
      const { store, repository } = await fixture();
      await insert(store, "Member", member("생략", { sourceTeam: null }));
      assert.deepEqual(await repository.listResourceOwners(), {});
    });
  } finally {
    await client.db(databaseName).dropDatabase(); await client.close();
    keys.forEach((key, index) => { const value = previous[index]; if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  }
});
