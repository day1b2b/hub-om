import { NextResponse } from "next/server";
import type { SourceTeam } from "@prisma/client";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { storeParsedImport } from "@/lib/data/importStagingWriter";
import { readNotionDatabaseImport } from "@/lib/data/notionImport";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireWorkspaceSession();
  const token = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;

  if (!token) {
    return NextResponse.json({ ok: false, error: "서버에 NOTION_TOKEN 설정이 필요합니다." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      databaseUrl?: string;
      notionUrl?: string;
      sourceName?: string;
      sourceTeam?: string;
    };
    const sourceTeam = parseSourceTeam(body.sourceTeam);
    const notionUrl =
      body.databaseUrl?.trim() ||
      body.notionUrl?.trim() ||
      getConfiguredNotionDatabase(sourceTeam) ||
      "";

    if (!notionUrl) {
      return NextResponse.json(
        { ok: false, error: "Notion 데이터베이스 URL을 입력하거나 담당 팀을 선택해 주세요." },
        { status: 400 }
      );
    }

    const result = await readNotionDatabaseImport({
      databaseUrlOrId: notionUrl,
      token
    });

    if (result.parsed.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "저장할 Notion 행이 없습니다." }, { status: 400 });
    }

    const sourceName = body.sourceName?.trim() || "Notion 운영 데이터";
    const importRun = await storeParsedImport({
      importedBy: session.user?.email ?? "",
      parsed: result.parsed,
      sourceName,
      sourceSheet: "Notion",
      sourceTeam,
      sourceType: "notion",
      sourceWorkbook: result.databaseId
    });

    return NextResponse.json({
      ok: true,
      duplicateCount: importRun.duplicateCount,
      errorCount: importRun.errorCount,
      importRunId: importRun.id,
      rowCount: result.rowCount,
      storedCount: importRun.storedCount
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Notion 데이터를 가져오지 못했습니다." },
      { status: 400 }
    );
  }
}

function parseSourceTeam(value: string | undefined): SourceTeam {
  if (value === "team_1" || value === "1팀") return "TEAM_1";
  if (value === "team_2" || value === "2팀") return "TEAM_2";
  return "UNKNOWN";
}

function getConfiguredNotionDatabase(sourceTeam: SourceTeam) {
  if (sourceTeam === "TEAM_1") {
    return process.env.NOTION_TEAM1_RESOURCE_DATABASE_ID || process.env.NOTION_TEAM1_RESOURCE_URL;
  }

  if (sourceTeam === "TEAM_2") {
    return process.env.NOTION_TEAM2_RESOURCE_DATABASE_ID || process.env.NOTION_TEAM2_RESOURCE_URL;
  }

  return process.env.NOTION_IMPORT_DATABASE_ID || process.env.NOTION_IMPORT_DATABASE_URL;
}
