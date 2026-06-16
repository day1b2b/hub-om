import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseGoogleSpreadsheetUrl, readGoogleSheetRows } from "@/lib/data/googleSheetsImport";
import { storeParsedImport } from "@/lib/data/importStagingWriter";
import { parseImportTable } from "@/lib/data/importUploadParser";
import type { SourceTeam } from "@prisma/client";

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
    const body = (await request.json()) as {
      headerRowNumber?: number;
      sourceName?: string;
      sourceTeam?: string;
      spreadsheetUrl?: string;
      tabTitle?: string;
    };
    const tabTitle = body.tabTitle?.trim();

    if (!tabTitle) {
      return NextResponse.json({ ok: false, error: "가져올 탭을 선택해 주세요." }, { status: 400 });
    }

    const { spreadsheetId } = parseGoogleSpreadsheetUrl(body.spreadsheetUrl ?? "");
    const rows = await readGoogleSheetRows(accessToken, spreadsheetId, tabTitle);
    const parsed = parseImportTable(rows, body.headerRowNumber || 1);

    if (parsed.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "저장할 행이 없습니다." }, { status: 400 });
    }

    const importRun = await storeParsedImport({
      importedBy: session.user?.email ?? "",
      parsed,
      sourceName: body.sourceName?.trim() || tabTitle,
      sourceSheet: tabTitle,
      sourceTeam: parseSourceTeam(body.sourceTeam),
      sourceType: "spreadsheet",
      sourceWorkbook: spreadsheetId
    });

    return NextResponse.json({
      ok: true,
      duplicateCount: importRun.duplicateCount,
      errorCount: importRun.errorCount,
      importRunId: importRun.id,
      rowCount: importRun.rowCount,
      storedCount: importRun.storedCount
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "스프레드시트를 가져오지 못했습니다." },
      { status: 400 }
    );
  }
}

function parseSourceTeam(value: string | undefined): SourceTeam {
  if (value === "team_1" || value === "1팀") return "TEAM_1";
  if (value === "team_2" || value === "2팀") return "TEAM_2";
  return "UNKNOWN";
}
