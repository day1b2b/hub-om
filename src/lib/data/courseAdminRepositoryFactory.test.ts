import assert from "node:assert/strict";
import { test } from "node:test";
import type { CourseAdminRepository } from "./courseAdminRepository";
import { getCourseAdminRepository } from "./courseAdminRepositoryFactory";
import { PrismaCourseAdminRepository } from "./prismaCourseAdminRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { getPrismaClient } from "./prisma";

test("course admin defaults to PG, isolates scopes and never falls back from an incomplete scope", async () => {
  assert.ok(getCourseAdminRepository() instanceof PrismaCourseAdminRepository);
  const first = {} as CourseAdminRepository, second = {} as CourseAdminRepository;
  await Promise.all([first, second].map(courseAdmin => runWithDataRepositories({ courseAdmin }, async () => {
    await Promise.resolve();
    assert.equal(getCourseAdminRepository(), courseAdmin);
    assert.throws(getPrismaClient, /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    await assert.rejects(runWithDataRepositories({}, async () => getCourseAdminRepository()), /DATA_REPOSITORY_NOT_CONFIGURED: courseAdmin/);
    assert.equal(getCourseAdminRepository(), courseAdmin);
  })));
  assert.ok(getCourseAdminRepository() instanceof PrismaCourseAdminRepository);
});
