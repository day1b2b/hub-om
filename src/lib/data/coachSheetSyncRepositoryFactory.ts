import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { CoachSheetSource, CoachSheetSyncRepository } from "./coachSheetSyncRepository";
import { PrismaCoachSheetSyncRepository } from "./prismaCoachSheetSyncRepository";
export function getCoachSheetSyncRepository(): CoachSheetSyncRepository {
  return getDataRepositoryOverride("coachSheetSync") ?? new PrismaCoachSheetSyncRepository();
}
export function getCoachSheetSource(): CoachSheetSource {
  return getDataRepositoryOverride("coachSheetSource") ?? {
    async readContract() { return (await import("../coaches/contractSheetSync")).readContractSheetSource(); },
    async readSamsung() { return (await import("../coaches/samsungScheduleSync")).readSamsungSheetSource(); }
  };
}
