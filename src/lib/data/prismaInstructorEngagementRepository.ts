// InstructorEngagementRepository의 기본(Postgres) 구현. 코치 prismaCoachRepository.listEngagements 미러(강사판, 평가필드 없음).
import { getPrismaClient } from "./prisma";
import { isOperationBackedSourceId } from "../coaches/operationBacked";
import { coachLinkedSession } from "./coachLinkedSession";
import type { CoachEngagementStatusValue } from "./coachTypes";
import type { InstructorEngagementRepository, InstructorEngagementView } from "./instructorEngagementRepository";

const INSTRUCTOR_ENGAGEMENT_STATUS: Record<string, CoachEngagementStatusValue> = {
  SCHEDULED: "scheduled", IN_PROGRESS: "in_progress", COMPLETED: "completed", CANCELLED: "cancelled"
};
const toDateString = (value: Date) => value.toISOString().slice(0, 10);

export class PrismaInstructorEngagementRepository implements InstructorEngagementRepository {
  async listEngagements(instructorNoteId: string): Promise<InstructorEngagementView[]> {
    const prisma = getPrismaClient();
    const engagements = await prisma.instructorEngagement.findMany({
      where: { instructorNoteId },
      select: {
        id: true,
        courseName: true,
        operationSessionId: true,
        status: true,
        source: true,
        startDate: true,
        endDate: true,
        startTime: true,
        endTime: true,
        sourceEngagementId: true,
        operationSession: { select: { educationFormat: true, timeText: true, deletedAt: true } }
      },
      orderBy: [{ startDate: "desc" }, { id: "asc" }]
    });

    return engagements.map((engagement) => ({
      id: engagement.id,
      courseName: engagement.courseName,
      operationSessionId: engagement.operationSessionId,
      status: INSTRUCTOR_ENGAGEMENT_STATUS[engagement.status],
      source: engagement.source.toLowerCase(),
      startDate: toDateString(engagement.startDate),
      endDate: toDateString(engagement.endDate),
      startTime: engagement.startTime,
      endTime: engagement.endTime,
      rating: null,
      rehire: null,
      feedback: null,
      linkedSession: coachLinkedSession(engagement.operationSession),
      operationBacked: isOperationBackedSourceId(engagement.sourceEngagementId)
    }));
  }
}
