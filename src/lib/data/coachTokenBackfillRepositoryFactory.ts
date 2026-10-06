import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachTokenBackfillRepository } from "./prismaCoachTokenBackfillRepository";
import type { CoachTokenBackfillRepository } from "./coachTokenBackfillRepository";

export function getCoachTokenBackfillRepository(): CoachTokenBackfillRepository {
  return getDataRepositoryOverride("coachTokenBackfill") ?? new PrismaCoachTokenBackfillRepository();
}
