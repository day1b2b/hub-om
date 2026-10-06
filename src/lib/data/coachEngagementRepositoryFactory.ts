import type { CoachEngagementRepository } from "./coachEngagementRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachEngagementRepository } from "./prismaCoachEngagementRepository";

export function getCoachEngagementRepository(): CoachEngagementRepository {
  return getDataRepositoryOverride("coachEngagement") ?? new PrismaCoachEngagementRepository();
}
