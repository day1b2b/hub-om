import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { TeamUserRepository } from "./teamUserRepositoryContract";
import type { TeamUser } from "./teamUserTypes";
import { runWithDataRepositories } from "../dataRepositoryContext";
import { omRequestManagerName } from "../omRequest/omRequestTypes";

let fallbackReads = 0;
mock.module("../prisma", { namedExports: { getPrismaClient: () => ({ teamUser: { async findMany() { fallbackReads++; return []; } } }) } });
const facade = await import("./teamUserRepository");
const { DuplicateTeamUserEmailError } = await import("./teamUserErrors");
const { canManageOmRequestAssignment } = await import("../../auth/omRequestAssignmentAccess");
const row: TeamUser = { id: "synthetic-id", name: "Synthetic manager", email: "synthetic@example.invalid", slackId: "synthetic-slack", createdAt: "2026-01-01T00:00:00.000Z" };
function repository(name = "Synthetic manager") {
  const calls: { method: string; args: unknown[] }[] = [];
  const user = { ...row, name };
  const value: TeamUserRepository = {
    async listTeamUsers() { calls.push({ method: "list", args: [] }); return [user]; },
    async findTeamUsersByEmail(email) { calls.push({ method: "find", args: [email] }); return [user]; },
    async createTeamUser(input) { calls.push({ method: "create", args: [input] }); return user; },
    async deleteTeamUsers(ids) { calls.push({ method: "delete", args: [ids] }); return 1; },
    async updateTeamUserTeam(id, team) { calls.push({ method: "team", args: [id, team] }); return user; },
    async updateTeamUsersRole(ids, role) { calls.push({ method: "role", args: [ids, role] }); return 1; }
  };
  return { value, calls, user };
}

test("TeamUser facade forwards all existing public methods to request-local repository without legacy access", async () => {
  const target = repository();
  const before = fallbackReads;
  await runWithDataRepositories({ teamUsers: target.value }, async () => {
    assert.deepEqual(await facade.listTeamUsers(), [target.user]);
    await facade.findTeamUsersByEmail(null);
    await facade.createTeamUser({ name: "Input", email: "input@example.invalid", slackId: "" });
    await facade.updateTeamUserTeam("synthetic-id", null);
    await facade.updateTeamUsersRole(["synthetic-id"], "ld");
    await facade.deleteTeamUsers(["synthetic-id"]);
  });
  assert.deepEqual(target.calls.map(call => call.method), ["list", "find", "create", "team", "role", "delete"]);
  assert.deepEqual(target.calls[1].args, [null]); assert.deepEqual(target.calls[3].args, ["synthetic-id", null]);
  assert.equal(fallbackReads, before); assert.equal(facade.DuplicateTeamUserEmailError, DuplicateTeamUserEmailError);
});
test("TeamUser facade isolates overlapping async scopes and refuses partial-context legacy fallback", async () => {
  const first = repository("First"), second = repository("Second");
  const results = await Promise.all([
    runWithDataRepositories({ teamUsers: first.value }, async () => { await new Promise(resolve => setImmediate(resolve)); return (await facade.listTeamUsers())[0].name; }),
    runWithDataRepositories({ teamUsers: second.value }, async () => { await Promise.resolve(); return (await facade.listTeamUsers())[0].name; })
  ]);
  assert.deepEqual(results, ["First", "Second"]);
  const before = fallbackReads;
  await assert.rejects(runWithDataRepositories({}, () => facade.listTeamUsers()), /DATA_REPOSITORY_NOT_CONFIGURED/);
  const failure = new Error("Synthetic repository failure");
  await assert.rejects(runWithDataRepositories({ teamUsers: { ...first.value, async listTeamUsers() { throw failure; } } }, () => facade.listTeamUsers()), error => error === failure);
  assert.equal(fallbackReads, before);
});
test("TeamUser facade with no context preserves existing Prisma selection", async () => {
  const savedSource = process.env.OPERATION_DATA_SOURCE, savedUrl = process.env.DATABASE_URL;
  try {
    process.env.OPERATION_DATA_SOURCE = "prisma"; process.env.DATABASE_URL = "postgresql://synthetic.invalid/no-connection";
    const before = fallbackReads; assert.deepEqual(await facade.listTeamUsers(), []); assert.equal(fallbackReads, before + 1);
  } finally {
    if (savedSource === undefined) delete process.env.OPERATION_DATA_SOURCE; else process.env.OPERATION_DATA_SOURCE = savedSource;
    if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
  }
});
test("Existing OM permission helper reads injected TeamUser roster and fails closed for missing or failed context", async () => {
  const manager = repository(omRequestManagerName("1파트")!);
  manager.user.email = "fixture.manager@day1company.co.kr";
  const before = fallbackReads;
  await runWithDataRepositories({ teamUsers: manager.value }, async () => {
    assert.equal(await canManageOmRequestAssignment("1파트", manager.user.email), true);
    assert.equal(await canManageOmRequestAssignment("1파트", "another@day1company.co.kr"), false);
    assert.equal(await canManageOmRequestAssignment("1파트", "outside@example.invalid"), false);
  });
  assert.equal(manager.calls.length, 2, "Invalid external email must be denied before reading the roster");
  assert.equal(await runWithDataRepositories({}, () => canManageOmRequestAssignment("1파트", manager.user.email)), false);
  assert.equal(await runWithDataRepositories({ teamUsers: { ...manager.value, async listTeamUsers() { throw new Error("Synthetic failure"); } } }, () => canManageOmRequestAssignment("1파트", manager.user.email)), false);
  assert.equal(fallbackReads, before);
});
