import type { CoachRepository } from "./coachRepository";
import { PrismaCoachRepository } from "./prismaCoachRepository";

export function getCoachRepository(): CoachRepository {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to access the coach repository.");
  }

  return new PrismaCoachRepository();
}
