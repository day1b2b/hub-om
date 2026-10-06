import type { CoachPrivateRepository } from "./coachPrivateRepository";
import { PrismaCoachPrivateRepository } from "./prismaCoachPrivateRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

export function getCoachPrivateRepository(): CoachPrivateRepository {
  const override = getDataRepositoryOverride("coachPrivate");
  if (override) return override;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to access the coach private repository.");
  }

  return new PrismaCoachPrivateRepository();
}
