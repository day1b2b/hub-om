import type { CoachPrivateRepository } from "./coachPrivateRepository";
import { PrismaCoachPrivateRepository } from "./prismaCoachPrivateRepository";

export function getCoachPrivateRepository(): CoachPrivateRepository {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to access the coach private repository.");
  }

  return new PrismaCoachPrivateRepository();
}
