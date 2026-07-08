import { getPrismaClient } from "@/lib/data/prisma";
import type { SyncResult } from "./syncTypes";

export async function runCoachSyncWithLog(
  type: string,
  triggeredBy: string,
  sync: () => Promise<SyncResult>
): Promise<SyncResult> {
  const prisma = getPrismaClient();
  const log = await prisma.coachSyncLog.create({
    data: {
      type,
      status: "running",
      triggeredBy
    }
  });

  try {
    const result = await sync();
    await prisma.coachSyncLog.update({
      where: { id: log.id },
      data: {
        status: result.errors > 0 ? "completed_with_errors" : "completed",
        totalRows: result.totalRows,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        errorDetail: result.errorDetail.slice(0, 20).join("\n") || null,
        finishedAt: new Date()
      }
    });
    return result;
  } catch (error) {
    await prisma.coachSyncLog.update({
      where: { id: log.id },
      data: {
        status: "failed",
        errors: 1,
        errorDetail: error instanceof Error ? error.message : String(error),
        finishedAt: new Date()
      }
    });
    throw error;
  }
}
