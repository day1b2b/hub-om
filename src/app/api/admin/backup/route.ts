import { NextResponse } from "next/server";
import { assertCoachPiiAccess } from "@/lib/auth/requireAdminSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorizedBySecret = isAuthorizedBySecret(request);
  if (!authorizedBySecret) {
    await assertCoachPiiAccess();
  }

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

  const backup = {
    exportedAt: new Date().toISOString(),
    counts: {
      coaches: coaches.length,
      privateProfiles: privateProfiles.length,
      fields: fields.length,
      curriculums: curriculums.length,
      coachFields: coachFields.length,
      coachCurriculums: coachCurriculums.length,
      schedules: schedules.length,
      scheduleAccessLogs: scheduleAccessLogs.length,
      engagements: engagements.length,
      engagementSchedules: engagementSchedules.length,
      importRuns: importRuns.length,
      archiveSnapshots: archiveSnapshots.length
    },
    data: {
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
    }
  };

  return new NextResponse(JSON.stringify(backup), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="hub_om_coach_backup_${new Date().toISOString().slice(0, 10)}.json"`
    }
  });
}

function isAuthorizedBySecret(request: Request): boolean {
  const configured = process.env.BACKUP_API_SECRET;
  if (!configured) return false;
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${configured}`;
}
