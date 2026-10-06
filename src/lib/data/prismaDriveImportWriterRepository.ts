import { Prisma } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import { DRIVE_IMPORT_NOTES, DRIVE_IMPORT_WRITER_ERROR, driveImportCounts, driveImportJson, driveImportTake, legacyDriveDate,
  type DriveImportArgs, type DriveImportFinishedStatus, type DriveImportInput, type DriveImportOperation,
  type DriveImportResultInput, type DriveImportSummary, type DriveImportWriterRepository } from "./driveImportWriterRepository";

async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch { throw new Error(DRIVE_IMPORT_WRITER_ERROR); }
}
function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const result = driveImportJson(value);
  return result === null ? Prisma.JsonNull : result as Prisma.InputJsonValue;
}

/** Encrypted application client only; no legacy SQL guard exception. */
export class PrismaDriveImportWriterRepository implements DriveImportWriterRepository {
  loadOperations(limit: number): Promise<DriveImportOperation[]> {
    return safe(async () => {
      const take = driveImportTake(limit);
      return getPrismaClient().$transaction(async tx => {
        const rows = await tx.operationSession.findMany({
          where: { deletedAt: null }, orderBy: [{ startDate: "asc" }, { operationId: "asc" }],
          ...(take === undefined ? {} : { take }),
          select: { id: true, operationId: true, startDate: true, endDate: true, omName: true, ldName: true,
            driveLink: true, lectureManagementLink: true, course: { select: { name: true, company: { select: { name: true } } } } }
        });
        return rows.map(row => ({ id: row.id, operationId: row.operationId,
          companyName: row.course.company.name ?? "", courseName: row.course.name ?? "",
          startDate: legacyDriveDate(row.startDate), endDate: legacyDriveDate(row.endDate),
          om: row.omName ?? "", ld: row.ldName ?? "", driveLink: row.driveLink ?? "", lectureManagementLink: row.lectureManagementLink ?? "" }));
      }, { isolationLevel: "RepeatableRead", timeout: 60_000 });
    });
  }
  createRun(args: DriveImportArgs, operationCount: number): Promise<string> {
    return safe(async () => (await getPrismaClient().driveImportRun.create({
      data: { mode: args.mode, operationCount, notes: DRIVE_IMPORT_NOTES }, select: { id: true }
    })).id);
  }
  appendResult(runId: string, operation: DriveImportOperation, input: DriveImportInput, result: DriveImportResultInput): Promise<void> {
    return safe(async () => {
      await getPrismaClient().driveImportResult.create({ data: {
        runId, operationSessionId: operation.id, operationId: operation.operationId,
        companyName: operation.companyName, courseName: operation.courseName,
        startDate: operation.startDate ? new Date(`${operation.startDate}T00:00:00.000Z`) : null,
        endDate: operation.endDate ? new Date(`${operation.endDate}T00:00:00.000Z`) : null,
        inputKind: input.kind, inputValue: input.value, resultKind: result.resultKind,
        folderId: result.folderId ?? null, folderTitle: result.folderTitle ?? null, folderUrl: result.folderUrl ?? null,
        fileCount: result.fileCount ?? 0, candidateCount: result.candidateCount ?? 0,
        keyCandidates: json(result.keyCandidates ?? []), folderCandidates: json(result.folderCandidates ?? []),
        issues: json(result.issues ?? []), error: result.error ?? null
      } });
    });
  }
  finishRun(runId: string, summary: DriveImportSummary, status: DriveImportFinishedStatus): Promise<void> {
    return safe(async () => {
      // SQL UPDATE of a missing run succeeds; don't substitute Prisma update/P2025.
      await getPrismaClient().driveImportRun.updateMany({ where: { id: runId }, data: {
        ...driveImportCounts(summary), status: status === "completed" ? "COMPLETED" : "COMPLETED_WITH_ERRORS",
        summary: json(summary), finishedAt: new Date()
      } });
    });
  }
  close(): Promise<void> { return safe(() => getPrismaClient().$disconnect()); }
}
