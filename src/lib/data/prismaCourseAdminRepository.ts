import type { CourseAdminRepository } from "./courseAdminRepository";
import { formatProcessId } from "./operationCalculations";
import { getPrismaClient } from "./prisma";

/** Existing administrator queries, preserving the production PostgreSQL path. */
export class PrismaCourseAdminRepository implements CourseAdminRepository {
  async findCourse(processSeq: number) {
    const course = await getPrismaClient().course.findUnique({
      where: { processSeq },
      select: {
        id: true, processSeq: true, name: true,
        company: { select: { name: true } },
        sessions: { where: { deletedAt: null }, select: { id: true } }
      }
    });
    return course ? {
      courseRecordId: course.id, processId: formatProcessId(course.processSeq),
      companyName: course.company.name, courseName: course.name, activeSessionCount: course.sessions.length
    } : null;
  }
  async softDeleteCourseSessions(courseId: string, deletedBy: string | null) {
    const prisma = getPrismaClient();
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) return null;
    const result = await prisma.operationSession.updateMany({
      where: { courseRecordId: courseId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy }
    });
    return result.count;
  }
}
