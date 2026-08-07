import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { storeParsedImport } from "@/lib/data/importStagingWriter";
import { parseImportFile, parseXlsxImport } from "@/lib/data/importUploadParser";
import type { SourceTeam } from "@prisma/client";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await requireWorkspaceSession();
  const importedBy = session.user?.email ?? "";
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "업로드할 파일을 선택해 주세요." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "파일은 5MB 이하만 업로드할 수 있습니다." }, { status: 400 });
  }

  const sourceTeam = parseSourceTeam(formData.get("sourceTeam"));
  const sourceType = parseText(formData.get("sourceType")) || inferSourceType(file.name);
  const sourceName = parseText(formData.get("sourceName")) || file.name;
  const sourceSheet = parseText(formData.get("sourceSheet")) || "upload";
  const defaultYear = parseImportYear(parseText(formData.get("importYear")));

  try {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const parsed =
      extension === "xlsx" || extension === "xls"
        ? parseXlsxImport(await file.arrayBuffer(), { defaultYear })
        : parseImportFile(file.name, await file.text(), { defaultYear });

    if (parsed.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "저장할 row가 없습니다." }, { status: 400 });
    }

    const importRun = await storeParsedImport({
      fileName: file.name,
      importedBy,
      parsed,
      sourceName,
      sourceSheet,
      sourceTeam,
      sourceType,
      sourceWorkbook: file.name
    });

    return NextResponse.json({
      ok: true,
      importRunId: importRun.id,
      rowCount: parsed.rows.length,
      storedCount: importRun.storedCount,
      duplicateCount: importRun.duplicateCount,
      errorCount: importRun.errorCount,
      headerRowNumber: parsed.headerRowNumber
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "파일을 import staging에 저장하지 못했습니다."
      },
      { status: 400 }
    );
  }
}

function parseSourceTeam(value: FormDataEntryValue | null): SourceTeam {
  const text = parseText(value);

  if (text === "team_1" || text === "1팀") return "TEAM_1";
  if (text === "team_2" || text === "2팀") return "TEAM_2";
  return "UNKNOWN";
}

function parseText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseImportYear(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) return undefined;
  return parsed;
}

function inferSourceType(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "json") return "json";
  if (extension === "csv") return "csv";
  if (extension === "xlsx" || extension === "xls") return "spreadsheet";
  return "upload";
}
