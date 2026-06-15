import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseImportFile } from "@/lib/data/importUploadParser";
import { getPrismaClient } from "@/lib/data/prisma";
import type { Prisma, SourceTeam } from "@prisma/client";

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

  try {
    const content = await file.text();
    const parsed = parseImportFile(file.name, content);

    if (parsed.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "저장할 row가 없습니다." }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const importRun = await prisma.$transaction(async (tx) => {
      const existingFingerprints = new Set(
        (await tx.operationSourceRecord.findMany({
          where: {
            sourceFingerprint: {
              in: parsed.rows.map((row) => row.sourceFingerprint)
            },
            sourceTeam,
            importRun: {
              sourceName,
              sourceType
            }
          },
          select: {
            sourceFingerprint: true
          }
        }))
          .map((record) => record.sourceFingerprint)
          .filter((fingerprint): fingerprint is string => Boolean(fingerprint))
      );
      const seenInUpload = new Set<string>();
      const rowsToStore = parsed.rows.filter((row) => {
        if (existingFingerprints.has(row.sourceFingerprint) || seenInUpload.has(row.sourceFingerprint)) {
          return false;
        }

        seenInUpload.add(row.sourceFingerprint);
        return true;
      });
      const duplicateRows = parsed.rows.filter((row) => !rowsToStore.includes(row));
      const validationLogs = [
        ...buildValidationLogs(rowsToStore),
        ...duplicateRows.map((row) => ({
          rowNumber: row.rowNumber,
          errors: ["이미 같은 원천 row fingerprint가 저장되어 있어 중복 저장하지 않았습니다."]
        }))
      ];
      const errorCount = rowsToStore.filter((row) => row.validationErrors.length > 0).length + duplicateRows.length;
      const run = await tx.dataImportRun.create({
        data: {
          errorCount,
          fileName: file.name,
          finishedAt: new Date(),
          importedBy,
          rowCount: parsed.rows.length,
          sourceName,
          sourceTeam,
          sourceType,
          status: errorCount > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
          successCount: rowsToStore.length - rowsToStore.filter((row) => row.validationErrors.length > 0).length,
          validationLogs: validationLogs as Prisma.InputJsonValue,
          workbookName: file.name
        },
        select: { id: true }
      });

      if (rowsToStore.length > 0) {
        await tx.operationSourceRecord.createMany({
          data: rowsToStore.map((row) => ({
            headerRowNumber: parsed.headerRowNumber,
            importRunId: run.id,
            mappedFields: row.mappedFields as Prisma.InputJsonValue,
            rowSnapshot: row.rowSnapshot as Prisma.InputJsonValue,
            sourceFingerprint: row.sourceFingerprint,
            sourceRowNumber: row.rowNumber,
            sourceSheet,
            sourceTeam,
            sourceWorkbook: file.name,
            unmappedFields: row.unmappedFields as Prisma.InputJsonValue,
            validationErrors: row.validationErrors as Prisma.InputJsonValue
          }))
        });
      }

      return { ...run, duplicateCount: duplicateRows.length, errorCount, storedCount: rowsToStore.length };
    });

    return NextResponse.json({
      ok: true,
      importRunId: importRun.id,
      rowCount: parsed.rows.length,
      storedCount: importRun.storedCount,
      duplicateCount: importRun.duplicateCount,
      errorCount: importRun.errorCount
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

function inferSourceType(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "json") return "json";
  if (extension === "csv") return "csv";
  return "upload";
}

function buildValidationLogs(rows: Array<{ rowNumber: number; validationErrors: string[] }>) {
  return rows
    .filter((row) => row.validationErrors.length > 0)
    .map((row) => ({
      rowNumber: row.rowNumber,
      errors: row.validationErrors
    }));
}
