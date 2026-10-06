import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { CoachExportRepository } from "./coachExportRepository";
import { PrismaCoachExportRepository } from "./prismaCoachExportRepository";
export function createCoachExportRepository(): CoachExportRepository {
  return getDataRepositoryOverride("coachExport") ?? new PrismaCoachExportRepository();
}
