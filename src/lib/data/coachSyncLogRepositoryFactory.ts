import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getPrismaClient } from "./prisma";
import type { CoachSyncLogRepository } from "./coachSyncLogRepository";
export function getCoachSyncLogRepository(): CoachSyncLogRepository {
  return getDataRepositoryOverride("coachSyncLog") ?? {
    start: (type, triggeredBy) => getPrismaClient().coachSyncLog.create({ data: { type, triggeredBy, status: "running" }, select: { id: true } }),
    finish: async (id, data) => { await getPrismaClient().coachSyncLog.update({ where: { id }, data }); }
  };
}
