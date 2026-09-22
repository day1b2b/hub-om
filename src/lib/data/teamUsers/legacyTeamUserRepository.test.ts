import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import type { TeamUserInput } from "./teamUserTypes";

const previousDatabase = process.env.DATABASE_URL;
const previousSource = process.env.OPERATION_DATA_SOURCE;
process.env.DATABASE_URL = "postgresql://synthetic.invalid/never-connected";
process.env.OPERATION_DATA_SOURCE = "prisma";
after(() => {
  if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
  if (previousSource === undefined) delete process.env.OPERATION_DATA_SOURCE; else process.env.OPERATION_DATA_SOURCE = previousSource;
});
let rows = [{ id: "synthetic-1", name: "Synthetic member", email: " MEMBER@example.invalid ", slackId: "synthetic", team: null as string | null, role: null as "LD" | "OM" | null, createdAt: new Date("2026-01-01") }];
let updateFailure = false;
const calls: { method: string; args: unknown }[] = [];
mock.module("../prisma", { namedExports: { getPrismaClient: () => ({ teamUser: {
  async findMany(args: unknown) { calls.push({ method: "findMany", args }); return rows; },
  async create(args: { data: TeamUserInput }) { calls.push({ method: "create", args }); return { ...args.data, id: "synthetic-new", createdAt: new Date("2026-02-01") }; },
  async deleteMany(args: unknown) { calls.push({ method: "deleteMany", args }); return { count: 2 }; },
  async update(args: unknown) { calls.push({ method: "update", args }); if (updateFailure) throw new Error("Synthetic failure"); return { ...rows[0], team: "AX 2파트" }; },
  async updateMany(args: unknown) { calls.push({ method: "updateMany", args }); return { count: 3 }; }
} }) } });
const legacy = await import("./legacyTeamUserRepository");
const { DuplicateTeamUserEmailError } = await import("./teamUserErrors");

test("TeamUser legacy adapter preserves Prisma query, DTO and normalized duplicate behavior", async () => {
  assert.deepEqual(await legacy.listTeamUsers(), [{ id: "synthetic-1", name: "Synthetic member", email: " MEMBER@example.invalid ", slackId: "synthetic", team: undefined, role: undefined, createdAt: "2026-01-01T00:00:00.000Z" }]);
  assert.deepEqual(calls[0], { method: "findMany", args: { orderBy: { createdAt: "desc" } } });
  assert.equal((await legacy.findTeamUsersByEmail(" member@EXAMPLE.invalid ")).length, 1);
  const previous = calls.length; assert.deepEqual(await legacy.findTeamUsersByEmail(" "), []); assert.equal(calls.length, previous);
  await assert.rejects(legacy.createTeamUser({ name: "Duplicate", email: "member@example.invalid", slackId: "" }), error => {
    assert.ok(error instanceof DuplicateTeamUserEmailError); assert.deepEqual(error.existingNames, ["Synthetic member"]); return true;
  });
  assert.ok(!calls.some(call => call.method === "create"));
});
test("TeamUser legacy adapter preserves existing writes, role mapping, delete and update-failure semantics", async () => {
  rows = []; calls.length = 0;
  const user = await legacy.createTeamUser({ name: "New", email: "new@example.invalid", slackId: "", role: "ld" });
  assert.equal(user.role, "ld");
  assert.deepEqual(calls.at(-1), { method: "create", args: { data: { name: "New", email: "new@example.invalid", slackId: "", team: null, role: "LD" } } });
  assert.equal(await legacy.updateTeamUsersRole(["synthetic-1"], "om"), 3);
  assert.deepEqual(calls.at(-1), { method: "updateMany", args: { where: { id: { in: ["synthetic-1"] } }, data: { role: "OM" } } });
  assert.equal(await legacy.deleteTeamUsers(["synthetic-1"]), 2);
  assert.deepEqual(calls.at(-1), { method: "deleteMany", args: { where: { id: { in: ["synthetic-1"] } } } });
  updateFailure = true; assert.equal(await legacy.updateTeamUserTeam("synthetic-1", null), null);
});
