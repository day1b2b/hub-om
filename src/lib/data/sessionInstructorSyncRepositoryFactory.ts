import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getPrismaSessionInstructorSyncRepository } from "./prismaSessionInstructorSyncRepository";
import type { SessionInstructorSyncRepository } from "./sessionInstructorSyncRepository";

/** scoped override(Mongo 런타임이 주입)면 그걸, 아니면 기본 Postgres. runSessionInstructorSyncWriteRequest 안에서 호출하면 Mongo로 간다. */
export function getSessionInstructorSyncRepository(): SessionInstructorSyncRepository {
  return getDataRepositoryOverride("sessionInstructorSync") ?? getPrismaSessionInstructorSyncRepository();
}
