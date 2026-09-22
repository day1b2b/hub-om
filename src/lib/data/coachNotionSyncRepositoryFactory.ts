import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { CoachNotionSource, CoachNotionSyncRepository } from "./coachNotionSyncRepository";
import { PrismaCoachNotionSyncRepository } from "./prismaCoachNotionSyncRepository";
export function getCoachNotionSyncRepository(): CoachNotionSyncRepository {
  return getDataRepositoryOverride("coachNotionSync") ?? new PrismaCoachNotionSyncRepository();
}
export function getCoachNotionSource(): CoachNotionSource {
  return getDataRepositoryOverride("coachNotionSource") ?? {
    async readPages() { return (await import("../coaches/notionCoachSync")).readNotionCoachPages(); }
  };
}
