import { getDataRepositoryOverride } from "../dataRepositoryContext";
import { PrismaActivityReadRepository } from "./prismaActivityReadRepository";
import type { ActivityReadRepository } from "./activityReadRepository";
export function getActivityReadRepository(): ActivityReadRepository {
  return getDataRepositoryOverride("activityReads") ?? new PrismaActivityReadRepository();
}
