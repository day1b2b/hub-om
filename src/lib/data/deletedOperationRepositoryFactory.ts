import type { DeletedOperationRepository } from "./deletedOperationRepository";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaDeletedOperationRepository } from "./prismaDeletedOperationRepository";

export function getDeletedOperationRepository(): DeletedOperationRepository {
  return getDataRepositoryOverride("deletedOperations") ?? new PrismaDeletedOperationRepository();
}
