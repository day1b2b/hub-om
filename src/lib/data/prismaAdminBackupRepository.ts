import type { AdminBackupData, AdminBackupRepository } from "./adminBackupRepository";
import { getPrismaClient } from "./prisma";

export class PrismaAdminBackupRepository implements AdminBackupRepository {
  async read(): Promise<AdminBackupData> {
    try {
      const prisma = getPrismaClient();
      const [
        coaches,
        privateProfiles,
        fields,
        curriculums,
        coachFields,
        coachCurriculums,
        schedules,
        scheduleAccessLogs,
        engagements,
        engagementSchedules,
        importRuns,
        archiveSnapshots
      ] = await Promise.all([
        prisma.coach.findMany(),
        prisma.coachPrivateProfile.findMany(),
        prisma.coachFieldMaster.findMany(),
        prisma.coachCurriculumMaster.findMany(),
        prisma.coachField.findMany(),
        prisma.coachCurriculum.findMany(),
        prisma.coachSchedule.findMany(),
        prisma.coachScheduleAccessLog.findMany(),
        prisma.coachEngagement.findMany(),
        prisma.coachEngagementSchedule.findMany(),
        prisma.coachImportRun.findMany(),
        prisma.$queryRaw<Array<{ id: string; table_count: number; row_count: number; status: string; started_at: Date; finished_at: Date | null }>>`
          SELECT id, table_count, row_count, status, started_at, finished_at
          FROM coachdb_archive_snapshots
          ORDER BY started_at DESC
          LIMIT 20
        `
      ]);
      return { coaches, privateProfiles, fields, curriculums, coachFields, coachCurriculums, schedules, scheduleAccessLogs, engagements, engagementSchedules, importRuns, archiveSnapshots };
    } catch {
      throw new Error("ADMIN_BACKUP_READ_FAILED");
    }
  }
}
