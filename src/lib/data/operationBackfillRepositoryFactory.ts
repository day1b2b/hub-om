import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { OperationBackfillRepository } from "./operationBackfillRepository";
import { PrismaOperationBackfillRepository } from "./prismaOperationBackfillRepository";

export function getOperationBackfillRepository(): OperationBackfillRepository {
  return getDataRepositoryOverride("operationBackfill") ?? new PrismaOperationBackfillRepository();
}
