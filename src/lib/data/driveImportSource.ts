import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { OperationSession } from "./operationTypes";
import type { DriveImportOperation } from "./driveImportWriterRepository";
import type { DriveImportScanResult, DriveFolderSearchResult } from "../driveImports/driveImportTypes";
import { scanOperationDriveFolder, searchOperationDriveFolders } from "../driveImports/googleDriveOperationScanner";

export interface DriveImportSource {
  scan(value: string): Promise<DriveImportScanResult>;
  search(operation: DriveImportOperation): Promise<DriveFolderSearchResult>;
}
const defaultSource: DriveImportSource = Object.freeze({
  scan: scanOperationDriveFolder,
  // The legacy CLI supplied this same narrow snapshot to the existing scanner.
  search: (operation: DriveImportOperation) => searchOperationDriveFolders(operation as OperationSession)
});
export function getDriveImportSource(): DriveImportSource {
  return getDataRepositoryOverride("driveImportSource") ?? defaultSource;
}
