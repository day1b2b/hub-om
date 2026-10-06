import assert from "node:assert/strict";
import { test } from "node:test";
import type { OperationBackfillRepository } from "./operationBackfillRepository";
import { getOperationBackfillRepository } from "./operationBackfillRepositoryFactory";
import { PrismaOperationBackfillRepository } from "./prismaOperationBackfillRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { getPrismaClient } from "./prisma";

test("operation backfills default to PG and isolate explicit scopes without fallback", async () => {
  assert.ok(getOperationBackfillRepository() instanceof PrismaOperationBackfillRepository);
  const a = {} as OperationBackfillRepository, b = {} as OperationBackfillRepository;
  await Promise.all([a, b].map(operationBackfill => runWithDataRepositories({ operationBackfill }, async () => {
    await Promise.resolve();
    assert.equal(getOperationBackfillRepository(), operationBackfill);
    assert.throws(getPrismaClient, /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    await assert.rejects(runWithDataRepositories({}, async () => getOperationBackfillRepository()), /DATA_REPOSITORY_NOT_CONFIGURED: operationBackfill/);
    assert.equal(getOperationBackfillRepository(), operationBackfill);
  })));
  assert.ok(getOperationBackfillRepository() instanceof PrismaOperationBackfillRepository);
});
