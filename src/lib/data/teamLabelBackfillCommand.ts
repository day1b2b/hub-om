import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { disconnectPrismaClient } from "./prisma";
import type { TeamUserRepository } from "./teamUsers/teamUserRepositoryContract";

export const TEAM_LABEL_RENAMES = [{ from: "1팀", to: "AX 1파트" }, { from: "2팀", to: "AX 2파트" }] as const;
export interface TeamLabelBackfillSummary { apply: boolean; rows: Array<{ from: string; to: string; targetCount: number; updatedCount: number }>; }
interface Dependencies { getDefaultRepository(): Promise<TeamUserRepository>; closeDefaultRepository(): Promise<void>; }
const defaults: Dependencies = { getDefaultRepository: () => import("./teamUsers/legacyTeamUserRepository"), closeDefaultRepository: disconnectPrismaClient };

export async function runTeamLabelBackfillCommand(args: string[], env: Record<string, string | undefined>, loadEnvironment: () => void, dependencies: Dependencies = defaults): Promise<TeamLabelBackfillSummary> {
  const apply = args.includes("--apply"), scoped = getDataRepositoryOverride("teamUsers");
  let result: TeamLabelBackfillSummary | undefined, failed = false;
  try {
    if (!scoped) {
      loadEnvironment();
      if (!env.DATABASE_URL?.trim() || env.OPERATION_DATA_SOURCE?.trim().toLowerCase() === "local") throw new Error("PG database required");
    }
    const repository = scoped ?? await dependencies.getDefaultRepository();
    if (typeof repository.countTeamUsersByTeam !== "function" || typeof repository.renameTeamUsers !== "function") throw new Error("unsupported repository");
    const rows: TeamLabelBackfillSummary["rows"] = [];
    for (const rename of TEAM_LABEL_RENAMES) {
      const targetCount = await repository.countTeamUsersByTeam(rename.from);
      const updatedCount = apply ? await repository.renameTeamUsers(rename.from, rename.to) : 0;
      rows.push({ ...rename, targetCount, updatedCount });
    }
    result = { apply, rows };
  } catch { failed = true; }
  finally { if (!scoped) { try { await dependencies.closeDefaultRepository(); } catch { failed = true; } } }
  if (failed || !result) throw new Error("TEAM_LABEL_BACKFILL_FAILED");
  return result;
}
