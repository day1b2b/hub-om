import type { ImportRepository } from "./importRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaImportRepository } from "./prismaImportRepository";

export function getImportRepository(): ImportRepository {
  return getDataRepositoryOverride("imports") ?? new PrismaImportRepository();
}
