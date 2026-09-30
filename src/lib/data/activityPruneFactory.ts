import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { ActivityPruneRepository } from "./activityPruneRepository";
import { PrismaActivityPruneRepository } from "./prismaActivityPruneRepository";

export function getActivityPruneRepository(): ActivityPruneRepository {
  return getDataRepositoryOverride("activityPrune") ?? new PrismaActivityPruneRepository();
}
