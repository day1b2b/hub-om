import type { DeletedOperationRepository } from "./deletedOperationRepository";
import { getPrismaClient } from "./prisma";

/** Preserve the original queries and timestamp behavior of the administrator route. */
export class PrismaDeletedOperationRepository implements DeletedOperationRepository {
  async listDeletedOperations() {
    const sessions = await getPrismaClient().operationSession.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      include: { course: { include: { company: true } } }
    });
    return sessions.map(session => ({
      operationId: session.operationId,
      companyName: session.course.company.name,
      courseName: session.course.name,
      roundNo: session.roundNo,
      startDate: session.startDate.toISOString().slice(0, 10),
      endDate: session.endDate.toISOString().slice(0, 10),
      deletedAt: session.deletedAt?.toISOString() ?? null,
      deletedBy: session.deletedBy
    }));
  }
  async restoreOperation(operationId: string) {
    return getPrismaClient().operationSession.update({
      where: { operationId },
      data: { deletedAt: null, deletedBy: null },
      select: { operationId: true }
    });
  }
}
