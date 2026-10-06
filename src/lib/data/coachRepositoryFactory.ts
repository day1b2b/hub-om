import type { CoachRepository } from "./coachRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaCoachRepository } from "./prismaCoachRepository";

export function getCoachRepository(): CoachRepository {
  const scoped = getDataRepositoryOverride("coach");
  if (scoped) return scoped;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to access the coach repository.");
  }

  return new PrismaCoachRepository();
}
