import type { InstructorEngagementRepository } from "./instructorEngagementRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaInstructorEngagementRepository } from "./prismaInstructorEngagementRepository";

/** scoped override(Mongo 읽기 런타임이 주입)면 그걸, 아니면 기본 Postgres. 코치 getCoachRepository 미러. */
export function getInstructorEngagementRepository(): InstructorEngagementRepository {
  const scoped = getDataRepositoryOverride("instructorEngagement");
  if (scoped) return scoped;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to access the instructor engagement repository.");
  }

  return new PrismaInstructorEngagementRepository();
}
