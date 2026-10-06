import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { InstructorNotionSource, InstructorNotionSyncRepository } from "./instructorNotionSyncRepository";
import { PrismaInstructorNotionSyncRepository } from "./prismaInstructorNotionSyncRepository";

export function getInstructorNotionSyncRepository(): InstructorNotionSyncRepository {
  return getDataRepositoryOverride("instructorNotionSync") ?? new PrismaInstructorNotionSyncRepository();
}
export function getInstructorNotionSource(): InstructorNotionSource {
  return getDataRepositoryOverride("instructorNotionSource") ?? {
    async readPages() { return (await import("../instructors/notionInstructorSync")).readNotionInstructorPages(); }
  };
}
