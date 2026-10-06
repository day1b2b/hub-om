import { PrismaImportPromotionRepository } from "./prismaImportPromotionRepository";

export function getSourceOnlyPromotionRepository() {
  return new PrismaImportPromotionRepository();
}
