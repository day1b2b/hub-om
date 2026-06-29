import { NextResponse } from "next/server";
import { requireCoachSyncAccess } from "@/lib/coaches/syncAuth";
import { runCoachSyncWithLog } from "@/lib/coaches/syncLog";
import { syncNotionCoaches } from "@/lib/coaches/notionCoachSync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireCoachSyncAccess(request);
  const result = await syncNotionCoaches(true);
  return NextResponse.json({ ok: true, dryRun: true, result });
}

export async function POST(request: Request) {
  const triggeredBy = await requireCoachSyncAccess(request);
  const result = await runCoachSyncWithLog("notion", triggeredBy, () => syncNotionCoaches(false));
  return NextResponse.json({ ok: true, result });
}
