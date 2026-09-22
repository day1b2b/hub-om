import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDefaultDatabaseAccess, getDataRepositoryOverride, runWithDataRepositories } from "./dataRepositoryContext";
import type { InstructorNoteRepository } from "./instructorNoteRepository";
import { getPrismaClient } from "./prisma";

test("repository scope isolates concurrent/nested requests and restores after failures", async () => {
  const a = { getNote: async () => ({ notes: "synthetic A" }) } as unknown as InstructorNoteRepository;
  const b = { getNote: async () => ({ notes: "synthetic B" }) } as unknown as InstructorNoteRepository;
  assert.equal(getDataRepositoryOverride("instructorNote"), undefined);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const first = runWithDataRepositories({ instructorNote: a }, async () => {
    await barrier;
    assert.equal(getDataRepositoryOverride("instructorNote"), a);
    assert.throws(() => getDataRepositoryOverride("teamUsers"), /DATA_REPOSITORY_NOT_CONFIGURED/);
    await assert.rejects(runWithDataRepositories({ instructorNote: b }, async () => {
      assert.equal(getDataRepositoryOverride("instructorNote"), b); throw new Error("synthetic failure");
    }));
    assert.equal(getDataRepositoryOverride("instructorNote"), a);
  });
  await runWithDataRepositories({ instructorNote: b }, async () => {
    assert.equal(getDataRepositoryOverride("instructorNote"), b); release(); await first;
    assert.equal(getDataRepositoryOverride("instructorNote"), b);
  });
  assert.equal(getDataRepositoryOverride("instructorNote"), undefined);
  assert.doesNotThrow(assertDefaultDatabaseAccess);
});

test("shadow blocks PostgreSQL before configuration or cached client use", () => {
  runWithDataRepositories({}, () => assert.throws(getPrismaClient, /DEFAULT_DATABASE_ACCESS_BLOCKED/));
  const globalCache = globalThis as unknown as { prisma?: unknown };
  const previous = globalCache.prisma;
  globalCache.prisma = { syntheticCachedClient: true };
  try {
    runWithDataRepositories({}, () => assert.throws(getPrismaClient, /DEFAULT_DATABASE_ACCESS_BLOCKED/));
  } finally { globalCache.prisma = previous; }
});

test("repository scope takes a stable copy rather than retaining the caller's mutable map", () => {
  const a = {} as InstructorNoteRepository, b = {} as InstructorNoteRepository;
  const repositories = { instructorNote: a };
  runWithDataRepositories(repositories, () => {
    repositories.instructorNote = b;
    assert.equal(getDataRepositoryOverride("instructorNote"), a);
  });
});
