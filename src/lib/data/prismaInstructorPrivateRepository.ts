import type { InstructorPrivateProfileView, InstructorPrivateRepository } from "./instructorPrivateRepository";
import { getPrismaClient } from "./prisma";

// 강사 민감(PII) 조회 전용 Prisma 구현. 이 계층만 contact/email/birthDate를 select한다(투명 복호화).
export class PrismaInstructorPrivateRepository implements InstructorPrivateRepository {
  async getPrivateProfile(instructorNoteId: string): Promise<InstructorPrivateProfileView | null> {
    const prisma = getPrismaClient();
    const profile = await prisma.instructorPrivateProfile.findUnique({
      where: { instructorNoteId },
      select: {
        instructorNoteId: true,
        contact: true,
        contact2: true,
        email: true,
        email2: true,
        birthDate: true
      }
    });

    if (!profile) {
      return null;
    }

    return {
      instructorNoteId: profile.instructorNoteId,
      contact: profile.contact,
      contact2: profile.contact2,
      email: profile.email,
      email2: profile.email2,
      birthDate: profile.birthDate ? toDateString(profile.birthDate) : null
    };
  }
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}
