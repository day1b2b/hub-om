import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getPrismaSessionCoachSyncRepository } from "./prismaSessionCoachSyncRepository";
import type { SessionCoachSyncRepository } from "./sessionCoachSyncRepository";

/** scoped override(Mongo 런타임이 주입)면 그걸, 아니면 기본 Postgres. runSessionCoachSyncWriteRequest 안에서 호출하면 Mongo로 간다. */
export function getSessionCoachSyncRepository(): SessionCoachSyncRepository {
  return getDataRepositoryOverride("sessionCoachSync") ?? getPrismaSessionCoachSyncRepository();
}
