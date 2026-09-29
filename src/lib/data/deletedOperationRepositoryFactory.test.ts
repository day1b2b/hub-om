import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeletedOperationRepository } from "./deletedOperationRepository";
import { getDeletedOperationRepository } from "./deletedOperationRepositoryFactory";
import { PrismaDeletedOperationRepository } from "./prismaDeletedOperationRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { getPrismaClient } from "./prisma";

test("deleted operations default to PG and isolate explicit scopes without fallback", async () => {
  assert.ok(getDeletedOperationRepository() instanceof PrismaDeletedOperationRepository);
  const a = {} as DeletedOperationRepository, b = {} as DeletedOperationRepository;
  await Promise.all([a, b].map(deletedOperations => runWithDataRepositories({ deletedOperations }, async () => {
    await Promise.resolve();
    assert.equal(getDeletedOperationRepository(), deletedOperations);
    assert.throws(getPrismaClient, /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    await assert.rejects(runWithDataRepositories({}, async () => getDeletedOperationRepository()), /DATA_REPOSITORY_NOT_CONFIGURED: deletedOperations/);
    assert.equal(getDeletedOperationRepository(), deletedOperations);
  })));
  assert.ok(getDeletedOperationRepository() instanceof PrismaDeletedOperationRepository);
});
