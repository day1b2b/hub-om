import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { OmRequestRepository } from "./omRequestRepository";
import type { OperationRepository } from "../operationRepository";
import { runWithDataRepositories } from "../dataRepositoryContext";

let pgCalls = 0;
mock.module("../prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL access"); } } });
const facade = await import("./omRequestLocalRepository");
const legacy = await import("./legacyOmRequestRepository");
const { getOmRequestRepository } = await import("./omRequestRepositoryFactory");
const { previewOmAssignment, assignOmRequestAtomically, OmAssignmentConflict } = await import("./omRequestAssignment");
const { syncAssignedOmToLinkedOperation } = await import("./omRequestOperationLink");
const tools = await import("./omCustomToolsLocalRepository");
const { getOperationRepository } = await import("../operationRepositoryFactory");
const { getTeamMemberRepository, getStoredTeamMemberRepository } = await import("../teamMemberRepositoryFactory");

function repository(label: string) {
  const calls: string[] = [];
  return { calls, value: new Proxy({}, { get(_target, method) { return async () => { calls.push(String(method)); await Promise.resolve(); return label; }; } }) as OmRequestRepository };
}
test("default OM adapter remains the exact legacy implementation", () => {
  assert.equal(getOmRequestRepository(), legacy); assert.equal(pgCalls, 0);
});
test("facades isolate concurrent and nested explicit scopes without PG fallback", async () => {
  const a = repository("A"), b = repository("B");
  const read = async (repo: OmRequestRepository) => runWithDataRepositories({ omRequests: repo }, async () => {
    await Promise.resolve(); return facade.getOmRequest("synthetic");
  });
  assert.deepEqual(await Promise.all([read(a.value), read(b.value)]), ["A", "B"]);
  await runWithDataRepositories({ omRequests: a.value }, async () => {
    assert.equal(await read(b.value), "B"); assert.equal(await facade.listOmRequests(), "A");
  });
  assert.equal(getOmRequestRepository(), legacy); assert.equal(pgCalls, 0);
});
test("missing scoped services fail before file/default access", async () => {
  await runWithDataRepositories({}, async () => {
    assert.throws(() => facade.listOmRequests(), /DATA_REPOSITORY_NOT_CONFIGURED/);
    assert.throws(() => tools.listCustomTools(), /DATA_REPOSITORY_NOT_CONFIGURED/);
    assert.throws(() => tools.addCustomTools(["Synthetic tool"]), /DATA_REPOSITORY_NOT_CONFIGURED/);
    assert.throws(() => getOperationRepository(), /DATA_REPOSITORY_NOT_CONFIGURED/);
    assert.throws(() => getTeamMemberRepository(), /DATA_REPOSITORY_NOT_CONFIGURED/);
  });
  assert.equal(pgCalls, 0);
});
test("custom tools and both roster factories use explicit ports", () => {
  const values = ["Synthetic initial tool"], roster = { listRoleRosters: async () => ({ ld: {}, om: {} }) };
  runWithDataRepositories({ omCustomTools: { list: () => [...values], add: names => { values.push(...names); } }, teamMembers: roster as never }, () => {
    assert.deepEqual(tools.listCustomTools(), values); tools.addCustomTools(["Synthetic extra tool"]);
    assert.deepEqual(tools.listCustomTools(), ["Synthetic initial tool", "Synthetic extra tool"]);
    assert.equal(getTeamMemberRepository(), roster); assert.equal(getStoredTeamMemberRepository(), roster);
  });
});
test("all four assignment entry points reject a shadow scope without writes", async () => {
  const repo = repository("unused"); let operationCalls = 0;
  const operations = new Proxy({}, { get() { return async () => { operationCalls++; throw new Error("Unexpected operation access"); }; } }) as OperationRepository;
  await runWithDataRepositories({ omRequests: repo.value, operations }, async () => {
    await assert.rejects(previewOmAssignment({} as never, "Synthetic assignee", "synthetic@example.invalid"), OmAssignmentConflict);
    await assert.rejects(assignOmRequestAtomically({} as never, null, "synthetic@example.invalid", "synthetic-token"), OmAssignmentConflict);
    await assert.rejects(facade.updateOmRequestAssignment("synthetic", null), /OM_ASSIGNMENT_MONGO_NOT_IMPLEMENTED/);
    await assert.rejects(syncAssignedOmToLinkedOperation("synthetic", "Synthetic assignee"), /OM_ASSIGNMENT_MONGO_NOT_IMPLEMENTED/);
  });
  assert.deepEqual(repo.calls, []); assert.equal(operationCalls, 0); assert.equal(pgCalls, 0);
});
