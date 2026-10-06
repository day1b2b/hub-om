import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import type { CoachDataVerificationRepository, VerificationCount } from "./coachDataVerificationRepository";

export class PrismaCoachDataVerificationRepository implements CoachDataVerificationRepository {
  private readonly client: PrismaClient;
  constructor(client: PrismaClient = getPrismaClient()) { this.client = client; }
  async readReport() {
    try {
      return await this.client.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const [coachesTotal, coachesVisible, coachesDeleted, privateProfiles, engagements, schedules, engagementSchedules,
          matchedEngagements, unmatchedEngagements, latestImport, latestArchive] = await Promise.all([
          tx.coach.count(), tx.coach.count({ where: { deletedAt: null } }), tx.coach.count({ where: { deletedAt: { not: null } } }),
          tx.coachPrivateProfile.count(), tx.coachEngagement.count(), tx.coachSchedule.count(), tx.coachEngagementSchedule.count(),
          tx.coachEngagement.count({ where: { operationSessionId: { not: null } } }), tx.coachEngagement.count({ where: { operationSessionId: null } }),
          tx.coachImportRun.findFirst({ orderBy: [{ startedAt: "desc" }, { id: "desc" }], select: { mode: true, status: true, coachCount: true,
            engagementCount: true, scheduleCount: true, matchedOperationCount: true, errorCount: true, finishedAt: true } }),
          tx.coachdbArchiveSnapshot.findFirst({ orderBy: [{ startedAt: "desc" }, { id: "desc" }], select: { id: true, tableCount: true,
            rowCount: true, status: true, finishedAt: true } }),
        ]);
        const archiveCounts: VerificationCount[] = latestArchive ? (await tx.coachdbArchiveRow.groupBy({
          by: ["tableName"], where: { snapshotId: latestArchive.id, tableName: { in: ["coaches", "coach_private_profiles", "engagements", "coach_schedules", "engagement_schedules"] } },
          _count: { _all: true }, orderBy: { tableName: "asc" },
        })).map(row => ({ label: row.tableName, count: row._count._all })) : [];
        return { serviceCounts: [
          ["coaches_total", coachesTotal], ["coaches_visible", coachesVisible], ["coaches_deleted", coachesDeleted],
          ["private_profiles", privateProfiles], ["engagements", engagements], ["schedules", schedules],
          ["engagement_schedules", engagementSchedules], ["matched_engagements", matchedEngagements], ["unmatched_engagements", unmatchedEngagements],
        ].map(([label, count]) => ({ label: String(label), count: Number(count) })), latestImport, latestArchive, archiveCounts };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 30_000 });
    } catch { throw new Error("COACH_DATA_VERIFICATION_FAILED"); }
  }
}
