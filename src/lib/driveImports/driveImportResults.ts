import { getDataRepositoryOverride } from "../data/dataRepositoryContext";
import { PrismaDriveImportHistoryRepository } from "../data/prismaDriveImportHistoryRepository";
import type { DriveImportHistoryRepository } from "../data/driveImportHistoryRepository";
export type { StoredDriveImportCandidate, StoredDriveImportResult, StoredDriveImportRunResult, StoredDriveImportRunView } from "../data/driveImportHistoryRepository";

/** Resolve before any default-backend env check or catch-to-null handling. */
export function getDriveImportHistoryRepository(): DriveImportHistoryRepository {
  return getDataRepositoryOverride("driveImportHistory") ?? new PrismaDriveImportHistoryRepository();
}
export async function readLatestDriveImportResult(operationId: string) {
  return getDriveImportHistoryRepository().readLatestDriveImportResult(operationId);
}
export async function readLatestDriveImportRun(resultLimit = 250) {
  return getDriveImportHistoryRepository().readLatestDriveImportRun(resultLimit);
}
