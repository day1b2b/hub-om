import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { DriveImportWriterRepository } from "./driveImportWriterRepository";
import { PrismaDriveImportWriterRepository } from "./prismaDriveImportWriterRepository";

export function getDriveImportWriterRepository(): DriveImportWriterRepository {
  return getDataRepositoryOverride("driveImportWriter") ?? new PrismaDriveImportWriterRepository();
}
