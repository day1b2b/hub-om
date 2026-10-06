import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachArchiveServiceBackfillRepository } from "./prismaCoachArchiveServiceBackfillRepository";
import type { CoachArchiveServiceBackfillRepository } from "./coachArchiveServiceBackfillRepository";

export function getCoachArchiveServiceBackfillRepository(): CoachArchiveServiceBackfillRepository {
  return getDataRepositoryOverride("coachArchiveServiceBackfill") ?? new PrismaCoachArchiveServiceBackfillRepository();
}
