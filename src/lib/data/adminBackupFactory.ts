import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { AdminBackupRepository } from "./adminBackupRepository";
import { PrismaAdminBackupRepository } from "./prismaAdminBackupRepository";

export function getAdminBackupRepository(): AdminBackupRepository {
  return getDataRepositoryOverride("adminBackup") ?? new PrismaAdminBackupRepository();
}
