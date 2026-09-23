import { getPrismaClient } from "./prisma";
import type { CoachAdminRepository, CoachMasterKind } from "./coachAdminRepository";

/** Default PostgreSQL adapter: the previous route queries moved here unchanged. */
export class PrismaCoachAdminRepository implements CoachAdminRepository {
  async listMasters(kind: CoachMasterKind) {
    const prisma = getPrismaClient();
    return kind === "fields"
      ? prisma.coachFieldMaster.findMany({ orderBy: { name: "asc" } })
      : prisma.coachCurriculumMaster.findMany({ orderBy: { name: "asc" } });
  }
  async ensureMaster(kind: CoachMasterKind, name: string) {
    const prisma = getPrismaClient();
    return kind === "fields"
      ? prisma.coachFieldMaster.upsert({ where: { name }, create: { name }, update: {} })
      : prisma.coachCurriculumMaster.upsert({ where: { name }, create: { name }, update: {} });
  }
  listDeletedCoaches() {
    return getPrismaClient().coach.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: { id: true, name: true, workType: true, status: true, deletedAt: true, deletedBy: true }
    });
  }
  restoreCoach(id: string) {
    return getPrismaClient().coach.update({ where: { id }, data: { deletedAt: null, deletedBy: null }, select: { id: true, name: true } });
  }
  async purgeDeletedCoach(id: string) {
    const prisma = getPrismaClient();
    const coach = await prisma.coach.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!coach?.deletedAt) return false;
    await prisma.coach.delete({ where: { id } });
    return true;
  }
}
