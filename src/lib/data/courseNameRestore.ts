import type { PrismaClient } from "@prisma/client";
import { assertDefaultDatabaseAccess } from "./dataRepositoryContext";
import { getCourseNameRestoreRepository } from "./courseNameRestoreRepositoryFactory";
import { PrismaCourseNameRestoreRepository } from "./prismaCourseNameRestoreRepository";
import type { CourseNameRestorePlan, CourseNameRestoreResult } from "./courseNameRestoreRepository";
export { CourseNameRestoreConflict, type CourseNameRestoreRow, type CourseNameRestoreCourse,
  type CourseNameRestorePlan, type CourseNameRestoreResult } from "./courseNameRestoreRepository";

/** Legacy explicit-client injection remains available outside shadow request scopes. */
function repository(db?: PrismaClient) {
  if (!db) return getCourseNameRestoreRepository();
  assertDefaultDatabaseAccess();
  return new PrismaCourseNameRestoreRepository(db);
}

export async function planCourseNameRestore(rawCourseId: string, db?: PrismaClient): Promise<CourseNameRestorePlan> {
  return repository(db).planCourseNameRestore(rawCourseId);
}

export async function applyCourseNameRestore(rawCourseId: string, operationIds: string[], snapshot: string,
  actorEmail: string | null, db?: PrismaClient): Promise<CourseNameRestoreResult> {
  return repository(db).applyCourseNameRestore(rawCourseId, operationIds, snapshot, actorEmail);
}
