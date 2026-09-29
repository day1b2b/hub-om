import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { CourseNameRestoreRepository } from "./courseNameRestoreRepository";
import { PrismaCourseNameRestoreRepository } from "./prismaCourseNameRestoreRepository";

export function getCourseNameRestoreRepository(): CourseNameRestoreRepository {
  return getDataRepositoryOverride("courseNameRestore") ?? new PrismaCourseNameRestoreRepository();
}
