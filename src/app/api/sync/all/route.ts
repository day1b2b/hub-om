import { NextResponse } from "next/server";
import { requireCoachSyncAccess } from "@/lib/coaches/syncAuth";
import { syncContractSheetEngagements } from "@/lib/coaches/contractSheetSync";
import { syncNotionCoaches } from "@/lib/coaches/notionCoachSync";
import { syncSamsungSchedule } from "@/lib/coaches/samsungScheduleSync";
import type { SyncResult } from "@/lib/coaches/syncTypes";
import { runCoachSyncWithLog } from "@/lib/coaches/syncLog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireCoachSyncAccess(request);
  const result = await runAll(true);
  return NextResponse.json({ ok: true, dryRun: true, result });
}

export async function POST(request: Request) {
  const triggeredBy = await requireCoachSyncAccess(request);
  const result = await runCoachSyncWithLog("all", triggeredBy, () => runAll(false));
  return NextResponse.json({ ok: true, result });
}

async function runAll(dryRun: boolean): Promise<SyncResult> {
  const notion = await syncNotionCoaches(dryRun);
  const engagements = await syncContractSheetEngagements(dryRun);
  const samsung = await syncSamsungSchedule(dryRun);
  return {
    totalRows: notion.totalRows + engagements.totalRows + samsung.totalRows,
    created: notion.created + engagements.created + samsung.created,
    updated: notion.updated + engagements.updated + samsung.updated,
    skipped: notion.skipped + engagements.skipped + samsung.skipped,
    errors: notion.errors + engagements.errors + samsung.errors,
    errorDetail: [...notion.errorDetail, ...engagements.errorDetail, ...samsung.errorDetail],
    changes: dryRun ? [...(notion.changes ?? []), ...(engagements.changes ?? []), ...(samsung.changes ?? [])] : undefined
  };
}
