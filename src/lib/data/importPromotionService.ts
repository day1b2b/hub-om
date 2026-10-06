import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { ImportPromotionRepository, ImportPromotionResult } from "./importPromotionContract";
import { PrismaImportPromotionRepository } from "./prismaImportPromotionRepository";

export type { ImportPromotionResult } from "./importPromotionContract";
export { buildOperationSessionValueData, stableOperationId } from "./importPromotionCore";

export function getImportPromotionRepository(): ImportPromotionRepository {
  return getDataRepositoryOverride("importPromotion") ?? new PrismaImportPromotionRepository();
}

export async function promoteReadyImportRows(importRunId: string): Promise<ImportPromotionResult> {
  return getImportPromotionRepository().promoteReadyImportRows(importRunId);
}
