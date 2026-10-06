import type { CoachTokenRepository } from "./coachTokenRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachTokenRepository } from "./prismaCoachTokenRepository";

export function getCoachTokenRepository(): CoachTokenRepository {
  return getDataRepositoryOverride("coachToken") ?? new PrismaCoachTokenRepository();
}
