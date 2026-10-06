import type { CourseAdminRepository } from "./courseAdminRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCourseAdminRepository } from "./prismaCourseAdminRepository";

export function getCourseAdminRepository(): CourseAdminRepository {
  return getDataRepositoryOverride("courseAdmin") ?? new PrismaCourseAdminRepository();
}
