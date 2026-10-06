import type { CoachTokenRotationRepository } from "./coachTokenRotationRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachTokenRotationRepository } from "./prismaCoachTokenRotationRepository";

export function getCoachTokenRotationRepository(): CoachTokenRotationRepository {
  return getDataRepositoryOverride("coachTokenRotation") ?? new PrismaCoachTokenRotationRepository();
}
