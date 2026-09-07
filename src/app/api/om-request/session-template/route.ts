import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { buildSessionSheetWorkbook, SESSION_SHEET_FILE_NAME } from "@/lib/data/omRequest/omSessionSheet";

export const dynamic = "force-dynamic";

async function activityGET() {
  await requireWorkspaceSession();

  const workbook = buildSessionSheetWorkbook();
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(SESSION_SHEET_FILE_NAME)}`
    }
  });
}

export const GET = withActivity("/api/om-request/session-template", "GET", activityGET);
