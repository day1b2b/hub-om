import type { CoachManagementRepository } from "./coachManagementRepository";
import { PrismaCoachManagementRepository } from "./prismaCoachManagementRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

export function getCoachManagementRepository(): CoachManagementRepository {
  const override = getDataRepositoryOverride("coachManagement");
  if (override) return override;
  return new PrismaCoachManagementRepository();
}
