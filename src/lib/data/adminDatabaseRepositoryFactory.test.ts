import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { getAdminDatabaseRepository } from "./adminDatabaseRepositoryFactory";
import { PrismaAdminDatabaseRepository } from "./prismaAdminDatabaseRepository";
import type { AdminDatabaseRepository } from "./adminDatabaseRepository";
import type { TeamMemberRepository } from "./teamMemberRepository";
// The stored factory never reads Notion; forbid an accidental external-reader path.
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "./notionTeamMemberRepository") return { url: "data:text/javascript,export function getNotionTeamMemberRepository(){throw new Error('Unexpected external reader')}", shortCircuit: true };
  return next(specifier, context);
} });
const { getStoredTeamMemberRepository } = await import("./teamMemberRepositoryFactory");
hooks.deregister();
import { LocalJsonTeamMemberRepository } from "./localJsonTeamMemberRepository";
import { PrismaTeamMemberRepository } from "./prismaTeamMemberRepository";
import { readDatabaseDashboard } from "../admin/databaseDashboard";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { getPrismaClient } from "./prisma";

test("admin database and stored member factories preserve defaults and isolate nested concurrent scopes", async () => {
  const saved = { database: process.env.DATABASE_URL, source: process.env.OPERATION_DATA_SOURCE };
  try {
    delete process.env.DATABASE_URL;
    delete process.env.OPERATION_DATA_SOURCE;
    assert.ok(getAdminDatabaseRepository() instanceof PrismaAdminDatabaseRepository);
    assert.ok(getStoredTeamMemberRepository() instanceof LocalJsonTeamMemberRepository);
    process.env.DATABASE_URL = "postgresql://synthetic@127.0.0.1:1/unused";
    assert.ok(getStoredTeamMemberRepository() instanceof PrismaTeamMemberRepository);
    process.env.OPERATION_DATA_SOURCE = "local";
    assert.ok(getStoredTeamMemberRepository() instanceof LocalJsonTeamMemberRepository);
    const snapshots = ["a", "b"].map(generatedAt => ({ generatedAt, tables: [], totalRows: 0 }));
    const repositories = snapshots.map(snapshot => ({ readDashboard: async () => snapshot, updateCell: async () => {} }) satisfies AdminDatabaseRepository);
    const members: TeamMemberRepository = { listResourceOwners: async () => ({}), listRoleRosters: async () => ({ om: {}, ld: {} }) };
    await Promise.all(repositories.map((adminDatabase, index) => runWithDataRepositories({ adminDatabase, teamMembers: members }, async () => {
      await Promise.resolve();
      assert.equal(getAdminDatabaseRepository(), adminDatabase);
      assert.equal(getStoredTeamMemberRepository(), members);
      assert.equal(await readDatabaseDashboard(), snapshots[index]);
      assert.throws(getPrismaClient, /DEFAULT_DATABASE_ACCESS_BLOCKED/);
      await assert.rejects(new PrismaAdminDatabaseRepository().readDashboard(), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
      await assert.rejects(new PrismaAdminDatabaseRepository().updateCell({ table: "companies", field: "name", rowId: "synthetic", value: "Synthetic", updatedBy: null }), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
      runWithDataRepositories({}, () => {
        assert.throws(getAdminDatabaseRepository, /DATA_REPOSITORY_NOT_CONFIGURED: adminDatabase/);
        assert.throws(getStoredTeamMemberRepository, /DATA_REPOSITORY_NOT_CONFIGURED: teamMembers/);
      });
      assert.equal(getAdminDatabaseRepository(), adminDatabase);
    })));
    assert.ok(getAdminDatabaseRepository() instanceof PrismaAdminDatabaseRepository);
  } finally {
    for (const [key, value] of [["DATABASE_URL", saved.database], ["OPERATION_DATA_SOURCE", saved.source]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});
