import { NextResponse } from "next/server";
import { requireCoachSyncAccess } from "@/lib/coaches/syncAuth";
import { runCoachSyncWithLog } from "@/lib/coaches/syncLog";
import { syncContractSheetEngagements } from "@/lib/coaches/contractSheetSync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireCoachSyncAccess(request);
  const result = await syncContractSheetEngagements(true);
  return NextResponse.json({ ok: true, dryRun: true, result });
}

export async function POST(request: Request) {
  const triggeredBy = await requireCoachSyncAccess(request);
  const result = await runCoachSyncWithLog("engagements", triggeredBy, () => syncContractSheetEngagements(false));
  return NextResponse.json({ ok: true, result });
}
