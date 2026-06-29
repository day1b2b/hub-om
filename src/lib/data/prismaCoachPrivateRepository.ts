import type { CoachEngagementFeedbackView, CoachPrivateProfileView } from "./coachTypes";
import type { CoachPrivateRepository } from "./coachPrivateRepository";
import { getPrismaClient } from "./prisma";

/**
 * 민감(PII) 데이터 조회 전용 Prisma 구현.
 * 이 계층만 employeeId/phone/email/birthDate/affiliation, feedback/hiredByText를 select한다.
 */
export class PrismaCoachPrivateRepository implements CoachPrivateRepository {
  async getPrivateProfile(coachId: string): Promise<CoachPrivateProfileView | null> {
    const prisma = getPrismaClient();
    const profile = await prisma.coachPrivateProfile.findUnique({
      where: { coachId },
      select: {
        coachId: true,
        employeeId: true,
        phone: true,
        email: true,
        birthDate: true,
        affiliation: true
      }
    });

    if (!profile) {
      return null;
    }

    return {
      coachId: profile.coachId,
      employeeId: profile.employeeId,
      phone: profile.phone,
      email: profile.email,
      birthDate: profile.birthDate ? toDateString(profile.birthDate) : null,
      affiliation: profile.affiliation
    };
  }

  async getEngagementFeedback(coachId: string): Promise<CoachEngagementFeedbackView[]> {
    const prisma = getPrismaClient();
    const engagements = await prisma.coachEngagement.findMany({
      where: { coachId },
      select: {
        id: true,
        feedback: true,
        hiredByText: true
      },
      orderBy: [{ startDate: "desc" }, { id: "asc" }]
    });

    return engagements.map((engagement) => ({
      engagementId: engagement.id,
      feedback: engagement.feedback,
      hiredByText: engagement.hiredByText
    }));
  }
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}
