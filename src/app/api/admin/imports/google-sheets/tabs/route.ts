import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listGoogleSheetTabs, parseGoogleSpreadsheetUrl } from "@/lib/data/googleSheetsImport";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
    const tabs = await listGoogleSheetTabs(accessToken, spreadsheetId);

    return NextResponse.json({
      ok: true,
      selectedGid: gid,
      spreadsheetId,
      tabs
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "탭 목록을 불러오지 못했습니다." },
      { status: 400 }
    );
  }
}
