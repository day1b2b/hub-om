import type { CoachContentRepository } from "./coachContentRepository";
import { PrismaCoachContentRepository } from "./prismaCoachContentRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

export function getCoachContentRepository(): CoachContentRepository {
  const override = getDataRepositoryOverride("coachContent");
  if (override) return override;
  return new PrismaCoachContentRepository();
}
