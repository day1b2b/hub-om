import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseGoogleSpreadsheetUrl } from "@/lib/data/googleSheetsImport";
import { getGoogleSheetsImportSource, googleSheetsImportError } from "@/lib/data/googleSheetsImportSource";
import { runGoogleSheetsImportRequest } from "@/lib/data/googleSheetsImportComposition";

export const dynamic = "force-dynamic";

async function activityPOST(request: Request) {
  const session = await requireWorkspaceSession();
  const accessToken = session.googleAccessToken;

  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: "Google 스프레드시트 읽기 권한이 필요합니다.", reauthRequired: true },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json()) as { spreadsheetUrl?: string };
    const { gid, spreadsheetId } = parseGoogleSpreadsheetUrl(body.spreadsheetUrl ?? "");
    const source = getGoogleSheetsImportSource();
    const tabs = await source.listTabs(accessToken, spreadsheetId);

    return NextResponse.json({
      ok: true,
      selectedGid: gid,
      spreadsheetId,
      tabs
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: googleSheetsImportError(error, "tabs") },
      { status: 400 }
    );
  }
}

export const POST = withActivity("/api/admin/imports/google-sheets/tabs", "POST", activityPOST, work => runGoogleSheetsImportRequest("tabs", work));
