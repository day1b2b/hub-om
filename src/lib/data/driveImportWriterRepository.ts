import type { OperationSession } from "./operationTypes";

export type DriveImportOperation = Pick<OperationSession, "operationId" | "companyName" | "courseName" | "startDate" | "endDate" | "om" | "ld" | "driveLink" | "lectureManagementLink"> & { id: string };
export interface DriveImportArgs { concurrency: number; limit: number; mode: string }
export interface DriveImportInput { kind: string; value: string }
export interface DriveImportResultInput {
  resultKind: string; folderId?: string | null; folderTitle?: string | null; folderUrl?: string | null;
  fileCount?: number | null; candidateCount?: number | null;
  keyCandidates?: unknown; folderCandidates?: unknown; issues?: unknown; error?: string | null;
}
export interface DriveImportSummary {
  avgSatisfactionCandidates: number; errors: number; folderSearches: number; folderSearchWithCandidates: number;
  instructorCandidates: number; instructorSatisfactionCandidates: number; scanFoundFolder: number;
  scanIssues: number; scannedRefs: number; suspiciousCandidateCount: number;
  suspicious: { badInstructorFragments: number; clockInstructorCandidates: number; zeroSatisfactionCandidates: number };
}
export type DriveImportFinishedStatus = "completed" | "completed_with_errors";
export interface DriveImportWriterRepository {
  loadOperations(limit: number): Promise<DriveImportOperation[]>;
  createRun(args: DriveImportArgs, operationCount: number): Promise<string>;
  appendResult(runId: string, operation: DriveImportOperation, input: DriveImportInput, result: DriveImportResultInput): Promise<void>;
  finishRun(runId: string, summary: DriveImportSummary, status: DriveImportFinishedStatus): Promise<void>;
  /** Direct CLI owns its default PG connection; borrowed native clients stay open. */
  close(): Promise<void>;
}
export const DRIVE_IMPORT_NOTES = "Read-only Drive import dry run. Operation data is not modified.";
export const DRIVE_IMPORT_WRITER_ERROR = "DRIVE_IMPORT_WRITER_FAILED";

/** PostgreSQL LIMIT accepts signed bigint; Prisma take only safe JS integers.
 * A JS result array cannot approach MAX_SAFE_INTEGER, so larger legal SQL limits
 * impose no further restriction on the materialized result. Reject SQL overflow. */
export function driveImportTake(limit: number): number | undefined {
  if (limit <= 0) return undefined;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit >= 2 ** 63) throw new Error(DRIVE_IMPORT_WRITER_ERROR);
  return limit <= Number.MAX_SAFE_INTEGER ? limit : undefined;
}

/** node-pg's DATE parser constructs local midnight before the original CLI's
 * toISOString().slice(0, 10). Preserve that legacy TZ-dependent date contract.
 * Prisma/native store civil DATE values at UTC midnight instead. */
export function legacyDriveDate(value: Date | null | undefined): string {
  if (!value) return "";
  const local = new Date(0);
  local.setFullYear(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  local.setHours(0, 0, 0, 0);
  return local.toISOString().slice(0, 10);
}
/** The old SQL parameters used JSON.stringify, including its omissions/errors. */
export function driveImportJson(value: unknown): unknown { return JSON.parse(JSON.stringify(value)); }
export function driveImportCounts(summary: DriveImportSummary) {
  return {
    scannedRefCount: summary.scannedRefs, scanFoundFolderCount: summary.scanFoundFolder,
    scanIssueCount: summary.scanIssues, folderSearchCount: summary.folderSearches,
    folderSearchWithCandidatesCount: summary.folderSearchWithCandidates,
    avgSatisfactionCandidateCount: summary.avgSatisfactionCandidates,
    instructorSatisfactionCandidateCount: summary.instructorSatisfactionCandidates,
    instructorCandidateCount: summary.instructorCandidates,
    suspiciousCandidateCount: summary.suspiciousCandidateCount, errorCount: summary.errors
  };
}
