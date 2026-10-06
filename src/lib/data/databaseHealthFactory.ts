import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { DatabaseHealthRepository } from "./databaseHealthRepository";
import { PrismaDatabaseHealthRepository } from "./prismaDatabaseHealthRepository";

export function getDatabaseHealthRepository(): DatabaseHealthRepository {
  return getDataRepositoryOverride("databaseHealth") ?? new PrismaDatabaseHealthRepository();
}
