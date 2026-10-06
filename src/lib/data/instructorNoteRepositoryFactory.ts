import type { InstructorNoteRepository } from "./instructorNoteRepository";
import { LocalJsonInstructorNoteRepository } from "./localJsonInstructorNoteRepository";
import { PrismaInstructorNoteRepository } from "./prismaInstructorNoteRepository";

// 운영 데이터와 같은 기준으로 분기한다(operationRepositoryFactory와 동일).
// 로컬 dev는 파일, 배포는 DB.
export function getInstructorNoteRepository(): InstructorNoteRepository {
  if (process.env.OPERATION_DATA_SOURCE === "local" || !process.env.DATABASE_URL) {
    return new LocalJsonInstructorNoteRepository();
  }

  return new PrismaInstructorNoteRepository();
}
