import type { CoachExportRepository, CoachExportType } from "./coachExportRepository";
import { getPrismaClient } from "./prisma";
export class PrismaCoachExportRepository implements CoachExportRepository {
  async exportCoaches(ids: string[], type: CoachExportType, actorEmail: string) {
    return getPrismaClient().$transaction(async tx => {
      const coaches = await tx.coach.findMany({
        where: { id: { in: [...new Set(ids)] }, deletedAt: null },
        select: { id: true, name: true, accessToken: true, privateProfile: { select: { phone: true, email: true } } },
        orderBy: { normalizedName: "asc" }
      });
      if (coaches.length) await tx.coachPrivateAccessLog.createMany({
        data: coaches.map(coach => ({ coachId: coach.id, accessedByEmail: actorEmail, context: `coach_export:${type}` }))
      });
      return coaches;
    }, { isolationLevel: "RepeatableRead" });
  }
}
