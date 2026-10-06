import type { CoachAdminRepository } from "./coachAdminRepository";
import { PrismaCoachAdminRepository } from "./prismaCoachAdminRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

export function getCoachAdminRepository(): CoachAdminRepository {
  const override = getDataRepositoryOverride("coachAdmin");
  if (override) return override;
  return new PrismaCoachAdminRepository();
}
