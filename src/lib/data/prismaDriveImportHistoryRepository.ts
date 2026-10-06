import { getPrismaClient } from "./prisma";
import type { DriveImportHistoryRepository, StoredDriveImportCandidate, StoredDriveImportResult, StoredDriveImportRunView } from "./driveImportHistoryRepository";

/** Preserve the original PostgreSQL env/query/decode catch-to-null behavior. */
export class PrismaDriveImportHistoryRepository implements DriveImportHistoryRepository {
  readLatestDriveImportResult = readLatestDriveImportResult;
  readLatestDriveImportRun = readLatestDriveImportRun;
}

async function readLatestDriveImportResult(operationId: string): Promise<StoredDriveImportResult | null> {
  if (!process.env.DATABASE_URL) return null;

  try {
    const prisma = getPrismaClient();
    const result = await prisma.driveImportResult.findFirst({
      where: { operationId },
      include: { run: true },
      orderBy: [
        { run: { startedAt: "desc" } },
        { createdAt: "desc" }
      ]
    });

    if (!result) return null;

    return {
      candidateCount: result.candidateCount,
      createdAt: result.createdAt.toISOString(),
      fileCount: result.fileCount,
      folderCandidates: asCandidateList(result.folderCandidates),
      folderTitle: result.folderTitle ?? "",
      folderUrl: result.folderUrl ?? "",
      inputKind: result.inputKind,
      inputValue: result.inputValue ?? "",
      issues: asStringList(result.issues),
      keyCandidates: asCandidateList(result.keyCandidates),
      resultKind: result.resultKind,
      runId: result.runId,
      runStartedAt: result.run.startedAt.toISOString(),
      runStatus: result.run.status
    };
  } catch {
    return null;
  }
}

async function readLatestDriveImportRun(resultLimit = 250): Promise<StoredDriveImportRunView | null> {
  if (!process.env.DATABASE_URL) return null;

  try {
    const prisma = getPrismaClient();
    const run = await prisma.driveImportRun.findFirst({
      include: {
        results: {
          orderBy: [
            { candidateCount: "desc" },
            { companyName: "asc" },
            { courseName: "asc" }
          ],
          take: resultLimit
        }
      },
      orderBy: { startedAt: "desc" }
    });

    if (!run) return null;

    return {
      avgSatisfactionCandidateCount: run.avgSatisfactionCandidateCount,
      errorCount: run.errorCount,
      finishedAt: run.finishedAt?.toISOString() ?? "",
      folderSearchCount: run.folderSearchCount,
      folderSearchWithCandidatesCount: run.folderSearchWithCandidatesCount,
      id: run.id,
      instructorCandidateCount: run.instructorCandidateCount,
      instructorSatisfactionCandidateCount: run.instructorSatisfactionCandidateCount,
      mode: run.mode,
      operationCount: run.operationCount,
      results: run.results.map((result) => ({
        candidateCount: result.candidateCount,
        companyName: result.companyName,
        courseName: result.courseName,
        createdAt: result.createdAt.toISOString(),
        endDate: dateOnly(result.endDate),
        error: result.error ?? "",
        fileCount: result.fileCount,
        folderCandidates: asCandidateList(result.folderCandidates),
        folderTitle: result.folderTitle ?? "",
        folderUrl: result.folderUrl ?? "",
        inputKind: result.inputKind,
        inputValue: result.inputValue ?? "",
        issues: asStringList(result.issues),
        keyCandidates: asCandidateList(result.keyCandidates),
        operationId: result.operationId,
        resultKind: result.resultKind,
        startDate: dateOnly(result.startDate)
      })),
      scanFoundFolderCount: run.scanFoundFolderCount,
      scanIssueCount: run.scanIssueCount,
      scannedRefCount: run.scannedRefCount,
      startedAt: run.startedAt.toISOString(),
      status: run.status,
      suspiciousCandidateCount: run.suspiciousCandidateCount
    };
  } catch {
    return null;
  }
}

function asCandidateList(value: unknown): StoredDriveImportCandidate[] {
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is StoredDriveImportCandidate => Boolean(entry) && typeof entry === "object");
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is string => typeof entry === "string");
}

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}
