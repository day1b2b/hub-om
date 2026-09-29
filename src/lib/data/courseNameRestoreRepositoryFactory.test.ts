import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { CourseNameRestoreRepository, CourseNameRestorePlan } from "./courseNameRestoreRepository";
import { getCourseNameRestoreRepository } from "./courseNameRestoreRepositoryFactory";
import { PrismaCourseNameRestoreRepository } from "./prismaCourseNameRestoreRepository";
import { applyCourseNameRestore, planCourseNameRestore } from "./courseNameRestore";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { getPrismaClient } from "./prisma";

test("course name restore preserves default PG and explicit client isolation across concurrent scopes", async () => {
  assert.ok(getCourseNameRestoreRepository() instanceof PrismaCourseNameRestoreRepository);
  const plan = { snapshot: "a".repeat(64), courseId: "123", companyNames: [], courses: [], rows: [] } satisfies CourseNameRestorePlan;
  const result = { moved: [], skipped: [] };
  const a: CourseNameRestoreRepository = { planCourseNameRestore: async () => plan, applyCourseNameRestore: async () => result };
  const b: CourseNameRestoreRepository = { ...a };
  await Promise.all([a, b].map(courseNameRestore => runWithDataRepositories({ courseNameRestore }, async () => {
    await Promise.resolve(); assert.equal(getCourseNameRestoreRepository(), courseNameRestore);
    assert.equal(await planCourseNameRestore("123"), plan);
    assert.equal(await applyCourseNameRestore("123", ["exact ID"], plan.snapshot, null), result);
    assert.throws(getPrismaClient, /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    await assert.rejects(planCourseNameRestore("123", {} as PrismaClient), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    await assert.rejects(applyCourseNameRestore("123", ["id"], plan.snapshot, null, {} as PrismaClient), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    await assert.rejects(runWithDataRepositories({}, () => planCourseNameRestore("123")), /DATA_REPOSITORY_NOT_CONFIGURED: courseNameRestore/);
    assert.equal(getCourseNameRestoreRepository(), courseNameRestore);
  })));
  assert.ok(getCourseNameRestoreRepository() instanceof PrismaCourseNameRestoreRepository);
});
