import type { CoachManagerMyPageRepository } from "./coachManagerMyPageRepository";
import { PrismaCoachManagerMyPageRepository } from "./prismaCoachManagerMyPageRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

export function getCoachManagerMyPageRepository(): CoachManagerMyPageRepository {
  const override = getDataRepositoryOverride("coachManagerMyPage");
  if (override) return override;
  return new PrismaCoachManagerMyPageRepository();
}
