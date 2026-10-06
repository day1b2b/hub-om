import assert from "node:assert/strict";
import { test } from "node:test";
import { getCoachContentRepository } from "./coachContentRepositoryFactory";
import { PrismaCoachContentRepository } from "./prismaCoachContentRepository";
import type { CoachContentRepository } from "./coachContentRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { getPrismaClient } from "./prisma";

test("content factory defaults to PG and isolates nested/concurrent explicit scopes", async () => {
  assert.ok(getCoachContentRepository() instanceof PrismaCoachContentRepository);
  const a = {} as CoachContentRepository, b = {} as CoachContentRepository;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const first = runWithDataRepositories({ coachContent: a }, async () => {
    await barrier;
    assert.equal(getCoachContentRepository(), a);
    assert.throws(getPrismaClient, /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    await assert.rejects(runWithDataRepositories({ coachContent: b }, async () => {
      assert.equal(getCoachContentRepository(), b); throw new Error("Synthetic nested failure");
    }));
    assert.equal(getCoachContentRepository(), a);
  });
  await runWithDataRepositories({ coachContent: b }, async () => { release(); await first; assert.equal(getCoachContentRepository(), b); });
  runWithDataRepositories({}, () => assert.throws(getCoachContentRepository, /DATA_REPOSITORY_NOT_CONFIGURED: coachContent/));
  assert.ok(getCoachContentRepository() instanceof PrismaCoachContentRepository);
});
