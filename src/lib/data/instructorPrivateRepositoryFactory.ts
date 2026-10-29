import type { InstructorPrivateRepository } from "./instructorPrivateRepository";
import { PrismaInstructorPrivateRepository } from "./prismaInstructorPrivateRepository";

// 강사 민감정보 저장소. 현재 postgres(Prisma)만 — mongo 샤도우 override는 코치 전환과 함께 추후 연동.
export function getInstructorPrivateRepository(): InstructorPrivateRepository {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to access the instructor private repository.");
  }

  return new PrismaInstructorPrivateRepository();
}
