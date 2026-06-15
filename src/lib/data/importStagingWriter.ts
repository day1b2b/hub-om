import type { Prisma, SourceTeam } from "@prisma/client";
import type { ParsedImportFile } from "./importUploadParser";
import { getPrismaClient } from "./prisma";

export interface StoreImportInput {
  fileName?: string;
  importedBy: string;
  parsed: ParsedImportFile;
  sourceName: string;
  sourceSheet: string;
  sourceTeam: SourceTeam;
  sourceType: string;
  sourceWorkbook: string;
}

export interface StoreImportResult {
  duplicateCount: number;
  errorCount: number;
  id: string;
  rowCount: number;
  storedCount: number;
}

export async function storeParsedImport(input: StoreImportInput): Promise<StoreImportResult> {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const existingFingerprints = new Set(
      (
        await tx.operationSourceRecord.findMany({
          where: {
            sourceFingerprint: {
              in: input.parsed.rows.map((row) => row.sourceFingerprint)
            },
            sourceTeam: input.sourceTeam,
            importRun: {
              sourceName: input.sourceName,
              sourceType: input.sourceType
            }
          },
          select: {
            sourceFingerprint: true
          }
        })
      )
        .map((record) => record.sourceFingerprint)
        .filter((fingerprint): fingerprint is string => Boolean(fingerprint))
    );
    const seenInUpload = new Set<string>();
    const rowsToStore = input.parsed.rows.filter((row) => {
      if (existingFingerprints.has(row.sourceFingerprint) || seenInUpload.has(row.sourceFingerprint)) {
        return false;
      }

      seenInUpload.add(row.sourceFingerprint);
      return true;
    });
    const duplicateRows = input.parsed.rows.filter((row) => !rowsToStore.includes(row));
    const validationLogs = [
      ...buildValidationLogs(rowsToStore),
      ...duplicateRows.map((row) => ({
        rowNumber: row.rowNumber,
        errors: ["이미 같은 행이 저장되어 있어 중복 저장하지 않았습니다."]
      }))
    ];
    const errorCount = rowsToStore.filter((row) => row.validationErrors.length > 0).length + duplicateRows.length;
    const run = await tx.dataImportRun.create({
      data: {
        errorCount,
        fileName: input.fileName,
        finishedAt: new Date(),
        importedBy: input.importedBy,
        rowCount: input.parsed.rows.length,
        sourceName: input.sourceName,
        sourceTeam: input.sourceTeam,
        sourceType: input.sourceType,
        status: errorCount > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
        successCount: rowsToStore.length - rowsToStore.filter((row) => row.validationErrors.length > 0).length,
        validationLogs: validationLogs as Prisma.InputJsonValue,
        workbookName: input.sourceWorkbook
      },
      select: { id: true }
    });

    if (rowsToStore.length > 0) {
      await tx.operationSourceRecord.createMany({
        data: rowsToStore.map((row) => ({
          headerRowNumber: input.parsed.headerRowNumber,
          importRunId: run.id,
          mappedFields: row.mappedFields as Prisma.InputJsonValue,
          rowSnapshot: row.rowSnapshot as Prisma.InputJsonValue,
          sourceFingerprint: row.sourceFingerprint,
          sourceRowNumber: row.rowNumber,
          sourceSheet: input.sourceSheet,
          sourceTeam: input.sourceTeam,
          sourceWorkbook: input.sourceWorkbook,
          unmappedFields: row.unmappedFields as Prisma.InputJsonValue,
          validationErrors: row.validationErrors as Prisma.InputJsonValue
        }))
      });
    }

    return {
      ...run,
      duplicateCount: duplicateRows.length,
      errorCount,
      rowCount: input.parsed.rows.length,
      storedCount: rowsToStore.length
    };
  });
}

function buildValidationLogs(rows: Array<{ rowNumber: number; validationErrors: string[] }>) {
  return rows
    .filter((row) => row.validationErrors.length > 0)
    .map((row) => ({
      rowNumber: row.rowNumber,
      errors: row.validationErrors
    }));
}
