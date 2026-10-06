import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaAdminDatabaseRepository } from "./prismaAdminDatabaseRepository";
import type { AdminDatabaseRepository } from "./adminDatabaseRepository";
export function getAdminDatabaseRepository(): AdminDatabaseRepository {
  return getDataRepositoryOverride("adminDatabase") ?? new PrismaAdminDatabaseRepository();
}
